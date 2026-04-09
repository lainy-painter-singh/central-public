import { IpcMain } from 'electron'
import { getDb } from '../db/database'
import { v4 as uuid } from 'uuid'
import { extractFileText } from '../services/file-reader'
import { generateScorecard } from '../services/scorecard-generator'

export function registerScorecardHandlers(ipcMain: IpcMain) {
  // Create a new scorecard from a deal (pre-fills deal context)
  ipcMain.handle('scorecard:create', (_event, dealId: string) => {
    const db = getDb()
    const deal = db.prepare(`
      SELECT d.*, c.name as company_name
      FROM deals d JOIN companies c ON d.company_id = c.id
      WHERE d.id = ?
    `).get(dealId) as any

    if (!deal) return null

    const id = uuid()
    const dealContext = JSON.stringify({
      company_name: deal.company_name,
      description: deal.description,
      revenue: deal.revenue,
      round_size: deal.round_size,
      contact_name: deal.contact_name,
      contact_email: deal.contact_email,
      notes: deal.notes,
      source: deal.source,
    })

    db.prepare(`
      INSERT INTO scorecards (id, deal_id, company_id, deal_context)
      VALUES (?, ?, ?, ?)
    `).run(id, dealId, deal.company_id, dealContext)

    return db.prepare(`
      SELECT s.*, c.name as company_name
      FROM scorecards s JOIN companies c ON s.company_id = c.id
      WHERE s.id = ?
    `).get(id)
  })

  // Get a single scorecard
  ipcMain.handle('scorecard:get', (_event, id: string) => {
    const db = getDb()
    return db.prepare(`
      SELECT s.*, c.name as company_name
      FROM scorecards s JOIN companies c ON s.company_id = c.id
      WHERE s.id = ?
    `).get(id) || null
  })

  // Get all scorecards for a deal
  ipcMain.handle('scorecard:getByDeal', (_event, dealId: string) => {
    const db = getDb()
    return db.prepare(`
      SELECT s.*, c.name as company_name
      FROM scorecards s JOIN companies c ON s.company_id = c.id
      WHERE s.deal_id = ?
      ORDER BY s.created_at DESC
    `).all(dealId)
  })

  // Update a scorecard
  ipcMain.handle('scorecard:update', (_event, id: string, updates: any) => {
    const db = getDb()
    const allowed = ['meeting_ids', 'file_contents', 'additional_notes', 'status',
                     'slide_executive_summary', 'slide_highlights_risks',
                     'slide_scorecard_table', 'slide_hypothesis_framework']

    const setClauses: string[] = ["updated_at = datetime('now')"]
    const params: any[] = []

    for (const key of allowed) {
      if (key in updates) {
        setClauses.push(`${key} = ?`)
        params.push(updates[key])
      }
    }

    params.push(id)
    db.prepare(`UPDATE scorecards SET ${setClauses.join(', ')} WHERE id = ?`).run(...params)

    return db.prepare(`
      SELECT s.*, c.name as company_name
      FROM scorecards s JOIN companies c ON s.company_id = c.id
      WHERE s.id = ?
    `).get(id)
  })

  // Delete a scorecard
  ipcMain.handle('scorecard:delete', (_event, id: string) => {
    const db = getDb()
    db.prepare('DELETE FROM scorecards WHERE id = ?').run(id)
    return { success: true }
  })

  // Suggest meetings for a company (for the meeting selector)
  // Matches by company_id OR by company name appearing in the meeting title
  ipcMain.handle('scorecard:suggestMeetings', (_event, companyId: string) => {
    const db = getDb()

    // Get the company name for title-based matching
    const company = db.prepare('SELECT name FROM companies WHERE id = ?').get(companyId) as any
    const companyName = company?.name || ''

    // Use a UNION to find meetings linked by company_id OR by title match
    // This catches meetings that weren't auto-linked by the deal detector
    return db.prepare(`
      SELECT DISTINCT m.id, m.source, m.title, m.date, m.company_id, m.summary,
             COALESCE(c.name, '') as company_name
      FROM meetings m
      LEFT JOIN companies c ON m.company_id = c.id
      WHERE (m.company_id = ? OR (? <> '' AND LOWER(m.title) LIKE '%' || LOWER(?) || '%'))
      AND (m.summary IS NOT NULL OR m.transcript IS NOT NULL)
      ORDER BY m.date DESC
      LIMIT 20
    `).all(companyId, companyName, companyName)
  })

  // Read a file and extract text content
  ipcMain.handle('scorecard:readFile', async (_event, filePath: string) => {
    try {
      const result = await extractFileText(filePath)
      return { success: true, content: result.content, filename: result.filename }
    } catch (err: any) {
      console.error('[Scorecard] File read error:', err.message)
      return { success: false, error: err.message }
    }
  })

  // Generate the full 4-slide scorecard using AI
  ipcMain.handle('scorecard:generate', async (_event, id: string) => {
    const db = getDb()
    const scorecard = db.prepare(`
      SELECT s.*, c.name as company_name
      FROM scorecards s JOIN companies c ON s.company_id = c.id
      WHERE s.id = ?
    `).get(id) as any

    if (!scorecard) return { success: false, error: 'Scorecard not found' }

    // Mark as generating
    db.prepare("UPDATE scorecards SET status = 'generating', error_message = NULL WHERE id = ?").run(id)

    try {
      // Parse deal context
      const dealContext = JSON.parse(scorecard.deal_context || '{}')

      // Gather meeting contents
      const meetingIds: string[] = JSON.parse(scorecard.meeting_ids || '[]')
      const meetingContents: { title: string; content: string }[] = []

      if (meetingIds.length > 0) {
        const placeholders = meetingIds.map(() => '?').join(',')
        const meetings = db.prepare(`
          SELECT title, summary, transcript FROM meetings WHERE id IN (${placeholders})
        `).all(...meetingIds) as any[]

        for (const m of meetings) {
          const content = m.summary || m.transcript || ''
          if (content.trim()) {
            meetingContents.push({ title: m.title || 'Untitled', content })
          }
        }
      }

      // Parse file contents
      const fileContents: { filename: string; content: string }[] = JSON.parse(scorecard.file_contents || '[]')

      // Check we have at least some content
      if (meetingContents.length === 0 && fileContents.length === 0 && !scorecard.additional_notes?.trim()) {
        // Still allow generation with just deal context — but warn
        console.log('[Scorecard] Generating with deal context only (no files/meetings/notes)')
      }

      // Generate
      const result = await generateScorecard(
        dealContext,
        meetingContents,
        fileContents,
        scorecard.additional_notes
      )

      // Save results
      db.prepare(`
        UPDATE scorecards SET
          status = 'complete',
          slide_executive_summary = ?,
          slide_highlights_risks = ?,
          slide_scorecard_table = ?,
          slide_hypothesis_framework = ?,
          tokens_used = ?,
          updated_at = datetime('now')
        WHERE id = ?
      `).run(
        result.slide_executive_summary,
        result.slide_highlights_risks,
        result.slide_scorecard_table,
        result.slide_hypothesis_framework,
        result.tokens_used,
        id
      )

      console.log(`[Scorecard] Generated for ${dealContext.company_name} (${result.tokens_used} tokens)`)
      return { success: true }
    } catch (err: any) {
      console.error('[Scorecard] Generation error:', err)
      db.prepare("UPDATE scorecards SET status = 'error', error_message = ? WHERE id = ?")
        .run(err.message, id)
      return { success: false, error: err.message }
    }
  })
}
