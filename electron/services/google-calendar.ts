import { google } from 'googleapis'
import { getAuthenticatedClient } from './google-auth'
import { getDb } from '../db/database'
import { matchCompany } from '../utils/portfolio'

/**
 * Sync calendar events for a range around today.
 * daysBehind: how many past days to fetch (for Recent Meetings)
 * daysAhead: how many future days to fetch (for Your Day)
 */
export async function syncCalendarEvents(daysAhead: number = 7, daysBehind: number = 5): Promise<number> {
  const auth = await getAuthenticatedClient()
  const calendar = google.calendar({ version: 'v3', auth })
  const db = getDb()

  const today = new Date()
  const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() - daysBehind)
  const endRange = new Date(today.getFullYear(), today.getMonth(), today.getDate() + daysAhead + 1)

  try {
    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: startOfDay.toISOString(),
      timeMax: endRange.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    })

    const events = response.data.items || []

    const upsert = db.prepare(`
      INSERT OR REPLACE INTO calendar_events (id, title, start_time, end_time, attendees, location, meeting_link, company_id, date, synced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `)

    let count = 0

    // Collect all dates in the range for cleanup (past + future)
    const dateStrs = new Set<string>()
    for (let i = -daysBehind; i <= daysAhead; i++) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i)
      dateStrs.add(d.toISOString().split('T')[0])
    }

    const transaction = db.transaction(() => {
      // Clear old events for the range
      for (const ds of dateStrs) {
        db.prepare("DELETE FROM calendar_events WHERE date = ?").run(ds)
      }

      for (const event of events) {
        if (!event.id) continue

        const attendees = (event.attendees || []).map(a => ({
          email: a.email,
          name: a.displayName || a.email,
          self: a.self || false,
          responseStatus: a.responseStatus,
        }))

        const attendeeEmails = attendees
          .filter(a => !a.self)
          .map(a => a.email)
          .filter(Boolean) as string[]

        // Try to match to a portfolio company
        const companyMatch = matchCompany(attendeeEmails, event.summary || '')

        // Extract meeting link
        let meetingLink = event.hangoutLink || null
        if (!meetingLink && event.location) {
          const zoomMatch = event.location.match(/(https:\/\/[^\s]*zoom\.us[^\s]*)/i)
          if (zoomMatch) meetingLink = zoomMatch[1]
        }
        if (!meetingLink && event.conferenceData?.entryPoints) {
          const videoEntry = event.conferenceData.entryPoints.find(e => e.entryPointType === 'video')
          if (videoEntry) meetingLink = videoEntry.uri || null
        }

        // Determine the date for this event
        const eventStart = event.start?.dateTime || event.start?.date || ''
        const eventDateStr = eventStart ? eventStart.split('T')[0] : startOfDay.toISOString().split('T')[0]

        upsert.run(
          event.id,
          event.summary || 'Untitled',
          event.start?.dateTime || event.start?.date || null,
          event.end?.dateTime || event.end?.date || null,
          JSON.stringify(attendees),
          event.location || null,
          meetingLink,
          companyMatch?.id || null,
          eventDateStr,
        )
        count++
      }
    })

    transaction()
    console.log(`[Calendar] Synced ${count} events (${daysBehind}d back, ${daysAhead}d ahead)`)
    return count
  } catch (err: any) {
    console.error('[Calendar] Sync error:', err.message)
    throw err
  }
}
