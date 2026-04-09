import { IpcMain } from 'electron'
import { getDb } from '../db/database'
import { v4 as uuid } from 'uuid'
import { generateBoardQuestions, generateBoardSummary } from '../services/board-summary'
import { runBoardDetection } from '../services/board-detector'
import { processReadyBoardPreps, searchBoardDocs, collectBoardMeetingNotes } from '../services/board-meeting-workflow'

export function registerBoardPrepHandlers(ipcMain: IpcMain) {
  // Get all board preps (optionally filtered by company)
  ipcMain.handle('boardPrep:getAll', (_event, companyId?: string) => {
    const db = getDb()
    if (companyId) {
      return db.prepare(`
        SELECT bp.*, c.name as company_name
        FROM board_prep bp
        JOIN companies c ON bp.company_id = c.id
        WHERE bp.company_id = ?
        ORDER BY bp.meeting_date DESC
      `).all(companyId)
    }
    return db.prepare(`
      SELECT bp.*, c.name as company_name
      FROM board_prep bp
      JOIN companies c ON bp.company_id = c.id
      ORDER BY bp.meeting_date DESC
    `).all()
  })

  // Get a single board prep by ID
  ipcMain.handle('boardPrep:get', (_event, id: string) => {
    const db = getDb()
    return db.prepare(`
      SELECT bp.*, c.name as company_name
      FROM board_prep bp
      JOIN companies c ON bp.company_id = c.id
      WHERE bp.id = ?
    `).get(id)
  })

  // Get the latest board prep for a company
  ipcMain.handle('boardPrep:getLatest', (_event, companyId: string) => {
    const db = getDb()
    return db.prepare(`
      SELECT bp.*, c.name as company_name
      FROM board_prep bp
      JOIN companies c ON bp.company_id = c.id
      WHERE bp.company_id = ?
      ORDER BY bp.meeting_date DESC
      LIMIT 1
    `).get(companyId)
  })

  // Create a board prep record
  ipcMain.handle('boardPrep:create', (_event, data: any) => {
    const db = getDb()
    const id = uuid()
    db.prepare(`
      INSERT INTO board_prep (id, company_id, meeting_date, deck_source, deck_path, questions)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      id,
      data.company_id,
      data.meeting_date || null,
      data.deck_source || null,
      data.deck_path || null,
      JSON.stringify(data.questions || [])
    )

    return db.prepare(`
      SELECT bp.*, c.name as company_name
      FROM board_prep bp
      JOIN companies c ON bp.company_id = c.id
      WHERE bp.id = ?
    `).get(id)
  })

  // Update questions (toggle checked, add, edit)
  ipcMain.handle('boardPrep:updateQuestions', (_event, id: string, questions: any[]) => {
    const db = getDb()
    db.prepare('UPDATE board_prep SET questions = ? WHERE id = ?')
      .run(JSON.stringify(questions), id)
    return { success: true }
  })

  // Generate AI questions from meeting content
  ipcMain.handle('boardPrep:generateQuestions', async (_event, boardPrepId: string) => {
    const db = getDb()
    const prep = db.prepare(`
      SELECT bp.*, c.name as company_name
      FROM board_prep bp
      JOIN companies c ON bp.company_id = c.id
      WHERE bp.id = ?
    `).get(boardPrepId) as any

    if (!prep) return { success: false, error: 'Board prep not found' }

    // Gather content: recent meetings for this company
    const meetings = db.prepare(`
      SELECT title, summary, transcript
      FROM meetings
      WHERE company_id = ?
      ORDER BY date DESC
      LIMIT 5
    `).all(prep.company_id) as any[]

    const content = meetings
      .map(m => `### ${m.title}\n${m.summary || m.transcript || '(no content)'}`)
      .join('\n\n')

    if (!content.trim() || content === '') {
      return { success: false, error: 'No meeting content available to generate questions' }
    }

    try {
      const questions = await generateBoardQuestions(prep.company_name, content)
      // Merge with existing questions (keep existing, add new)
      const existing = JSON.parse(prep.questions || '[]')
      const merged = [...existing, ...questions]

      db.prepare('UPDATE board_prep SET questions = ? WHERE id = ?')
        .run(JSON.stringify(merged), boardPrepId)

      return { success: true, questions: merged }
    } catch (err: any) {
      console.error('[BoardPrep] Question generation error:', err)
      return { success: false, error: err.message }
    }
  })

  // Auto-draft board summary using full workflow (email search + meeting notes + AI)
  ipcMain.handle('boardPrep:draftSummary', async (_event, boardPrepId: string) => {
    const db = getDb()
    const prep = db.prepare(`
      SELECT bp.*, c.name as company_name
      FROM board_prep bp
      JOIN companies c ON bp.company_id = c.id
      WHERE bp.id = ?
    `).get(boardPrepId) as any

    if (!prep) return { success: false, error: 'Board prep not found' }

    try {
      // Step 1: Search Gmail for board docs
      console.log(`[BoardPrep] Drafting summary for ${prep.company_name}...`)
      let deckContent = ''
      try {
        deckContent = await searchBoardDocs(prep.company_id, prep.meeting_date)
        if (deckContent) console.log(`[BoardPrep] Found board docs in email`)
      } catch (err: any) {
        console.error('[BoardPrep] Email search error:', err.message)
      }

      // Step 2: Collect meeting notes from Granola + Fellow
      const meetingContent = await collectBoardMeetingNotes(prep.company_id, prep.meeting_date)

      // Need at least one source of content
      if (!meetingContent.trim() && !deckContent.trim()) {
        return { success: false, error: 'No content found. Check that meeting notes exist in Granola/Fellow or that board docs were sent via email.' }
      }

      // Step 3: Generate summary with both sources
      const content = meetingContent.trim() || '(No meeting notes available -- summarize from board deck materials only)'
      const summary = await generateBoardSummary(
        prep.company_name,
        content,
        deckContent || undefined
      )

      // Save draft
      db.prepare('UPDATE board_prep SET summary_draft = ? WHERE id = ?').run(summary, boardPrepId)
      console.log(`[BoardPrep] Summary drafted for ${prep.company_name}`)

      return { success: true, summary }
    } catch (err: any) {
      console.error('[BoardPrep] Summary draft error:', err)
      return { success: false, error: err.message }
    }
  })

  // Save final summary
  ipcMain.handle('boardPrep:saveSummary', (_event, id: string, summary: string, isFinal: boolean) => {
    const db = getDb()
    if (isFinal) {
      db.prepare('UPDATE board_prep SET summary_final = ? WHERE id = ?').run(summary, id)
    } else {
      db.prepare('UPDATE board_prep SET summary_draft = ? WHERE id = ?').run(summary, id)
    }
    return { success: true }
  })

  // Mark as posted to Glue
  ipcMain.handle('boardPrep:markGluePosted', (_event, id: string) => {
    const db = getDb()
    db.prepare('UPDATE board_prep SET glue_posted = 1 WHERE id = ?').run(id)

    // Also mark the glue_post todo as done if exists
    const prep = db.prepare('SELECT company_id, meeting_date FROM board_prep WHERE id = ?').get(id) as any
    if (prep) {
      db.prepare(`
        UPDATE todos SET status = 'done', completed_at = datetime('now')
        WHERE company_id = ? AND type = 'glue_post' AND status = 'open'
      `).run(prep.company_id)
    }

    return { success: true }
  })

  // Run board detection scan
  ipcMain.handle('boardPrep:detectBoardMeetings', () => {
    try {
      const result = runBoardDetection()
      return { success: true, ...result }
    } catch (err: any) {
      console.error('[BoardPrep] Detection error:', err)
      return { success: false, error: err.message }
    }
  })

  // Run full board meeting workflow (doc search + auto-draft)
  ipcMain.handle('boardPrep:runWorkflow', async () => {
    try {
      const result = await processReadyBoardPreps()
      return { success: true, ...result }
    } catch (err: any) {
      console.error('[BoardPrep] Workflow error:', err)
      return { success: false, error: err.message }
    }
  })

  // Search Gmail for board docs for a specific board prep
  ipcMain.handle('boardPrep:searchDocs', async (_event, boardPrepId: string) => {
    const db = getDb()
    const prep = db.prepare('SELECT company_id, meeting_date FROM board_prep WHERE id = ?').get(boardPrepId) as any
    if (!prep) return { success: false, error: 'Board prep not found' }

    try {
      const deckContent = await searchBoardDocs(prep.company_id, prep.meeting_date)
      return { success: true, found: deckContent.length > 0, deckContent }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })
}
