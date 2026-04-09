import { IpcMain } from 'electron'
import { getDb } from '../db/database'
import { syncGranolaMeetings } from '../services/granola'
import { syncFellowMeetings, isFellowConfigured } from '../services/fellow'
import { extractTodosFromMeeting, processUnextractedMeetings } from '../services/todo-generator'
import { exportRecentMeetings, exportAllMeetings } from '../services/markdown-exporter'

export function registerMeetingHandlers(ipcMain: IpcMain) {
  ipcMain.handle('meetings:syncGranola', async () => {
    try {
      const count = await syncGranolaMeetings()
      const todoCount = await processUnextractedMeetings()
      // Auto-export to Obsidian vault after sync
      const exported = exportRecentMeetings()
      return { success: true, count, todosGenerated: todoCount, exported }
    } catch (err: any) {
      console.error('[Meetings] Granola sync error:', err)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('meetings:syncFellow', async () => {
    if (!isFellowConfigured()) {
      return { success: false, error: 'Fellow API key not configured' }
    }
    try {
      const count = await syncFellowMeetings()
      const todoCount = await processUnextractedMeetings()
      // Auto-export to Obsidian vault after sync
      const exported = exportRecentMeetings()
      return { success: true, count, todosGenerated: todoCount, exported }
    } catch (err: any) {
      console.error('[Meetings] Fellow sync error:', err)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('meetings:exportAll', async () => {
    try {
      const count = exportAllMeetings(true)
      return { success: true, count }
    } catch (err: any) {
      console.error('[Meetings] Export error:', err)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('meetings:getRecent', (_event, days: number = 90) => {
    const db = getDb()
    return db.prepare(`
      SELECT m.*, c.name as company_name
      FROM meetings m
      LEFT JOIN companies c ON m.company_id = c.id
      WHERE m.date >= date('now', '-' || ? || ' days')
      ORDER BY m.date DESC
      LIMIT 50
    `).all(days)
  })

  ipcMain.handle('meetings:generateTodos', async (_event, meetingId: string) => {
    const db = getDb()
    const meeting = db.prepare('SELECT * FROM meetings WHERE id = ?').get(meetingId) as any
    if (!meeting) {
      return { success: false, error: 'Meeting not found' }
    }

    const content = meeting.summary || meeting.transcript
    if (!content) {
      return { success: false, error: 'No content available for this meeting' }
    }

    try {
      const count = await extractTodosFromMeeting(
        meeting.id,
        meeting.title,
        content,
        meeting.company_id
      )
      return { success: true, count }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })
}
