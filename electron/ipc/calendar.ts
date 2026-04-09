import { IpcMain } from 'electron'
import { getDb } from '../db/database'
import { isGoogleConnected, connectGoogle } from '../services/google-auth'
import { syncCalendarEvents } from '../services/google-calendar'

export function registerCalendarHandlers(ipcMain: IpcMain) {
  ipcMain.handle('calendar:getToday', () => {
    const db = getDb()
    const today = new Date().toISOString().split('T')[0]
    return db.prepare(`
      SELECT ce.*, c.name as company_name, c.relationship
      FROM calendar_events ce
      LEFT JOIN companies c ON ce.company_id = c.id
      WHERE ce.date = ?
      ORDER BY ce.start_time ASC
    `).all(today)
  })

  // Get events for today + upcoming days (for Granola-style day switching)
  ipcMain.handle('calendar:getUpcoming', (_event, daysAhead: number = 7) => {
    const db = getDb()
    const today = new Date().toISOString().split('T')[0]
    const endDate = new Date()
    endDate.setDate(endDate.getDate() + daysAhead)
    const endStr = endDate.toISOString().split('T')[0]

    return db.prepare(`
      SELECT ce.*, c.name as company_name, c.relationship
      FROM calendar_events ce
      LEFT JOIN companies c ON ce.company_id = c.id
      WHERE ce.date >= ? AND ce.date <= ?
      ORDER BY ce.date ASC, ce.start_time ASC
    `).all(today, endStr)
  })

  // Get past calendar events for "Recent Meetings" — excludes noise
  ipcMain.handle('calendar:getRecent', (_event, daysBack: number = 5) => {
    const db = getDb()
    const today = new Date().toISOString().split('T')[0]
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - daysBack)
    const startStr = startDate.toISOString().split('T')[0]

    const events = db.prepare(`
      SELECT ce.*, c.name as company_name, c.relationship
      FROM calendar_events ce
      LEFT JOIN companies c ON ce.company_id = c.id
      WHERE ce.date >= ? AND ce.date <= ?
      ORDER BY ce.date DESC, ce.start_time DESC
    `).all(startStr, today) as any[]

    // Filter out noise
    const NOISE_PATTERNS = [
      /^DNS$/i,
      /break.*clockwise/i,
      /busy.*clockwise/i,
      /travel\s*time.*clockwise/i,
      /^\s*$/,
      /^busy$/i,
      /babysit/i,
    ]

    return events.filter(e => {
      const title = e.title || ''

      // Skip noise titles
      if (NOISE_PATTERNS.some(p => p.test(title))) return false

      // Skip all-day events (no time component in start_time)
      if (e.start_time && !e.start_time.includes('T')) return false

      // Skip events with no other attendees (personal blocks)
      try {
        const attendees = JSON.parse(e.attendees || '[]')
        const external = attendees.filter((a: any) => !a.self)
        if (external.length === 0) return false
      } catch {
        return false
      }

      return true
    })
  })

  ipcMain.handle('calendar:sync', async () => {
    try {
      const count = await syncCalendarEvents()
      return { success: true, count }
    } catch (err: any) {
      console.error('[Calendar] Sync error:', err.message)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('calendar:isConnected', () => {
    try {
      return isGoogleConnected()
    } catch {
      return false
    }
  })

  ipcMain.handle('calendar:connect', async () => {
    try {
      const success = await connectGoogle()
      if (success) {
        await syncCalendarEvents()
      }
      return { success }
    } catch (err: any) {
      console.error('[Calendar] Connect error:', err.message)
      return { success: false, error: err.message }
    }
  })
}
