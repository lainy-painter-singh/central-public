import { getDb } from '../db/database'
import { matchCompany } from '../utils/portfolio'

const FELLOW_API_BASE = 'https://api.fellow.app/v2'

function getApiKey(): string | null {
  const db = getDb()
  const setting = db.prepare("SELECT value FROM settings WHERE key = 'fellow_api_key'").get() as any
  return setting?.value || null
}

interface FellowMeeting {
  id: string
  title: string
  start_time: string
  end_time: string
  attendees: Array<{ name: string; email: string }>
}

async function fellowFetch(endpoint: string): Promise<any> {
  const apiKey = getApiKey()
  if (!apiKey) {
    throw new Error('Fellow API key not configured. Add it in app settings.')
  }

  const response = await fetch(`${FELLOW_API_BASE}${endpoint}`, {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error(`Fellow API error: ${response.status} ${response.statusText}`)
  }

  return response.json()
}

export async function syncFellowMeetings(daysBack: number = 30): Promise<number> {
  const db = getDb()

  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - daysBack)

  try {
    // Fetch meetings from Fellow API
    const data = await fellowFetch(`/meetings?start_after=${cutoffDate.toISOString()}&limit=50`)
    const meetings: FellowMeeting[] = data.results || data.meetings || data || []

    const upsert = db.prepare(`
      INSERT OR REPLACE INTO meetings (id, source, title, date, attendees, company_id, summary, raw_path)
      VALUES (?, 'fellow', ?, ?, ?, ?, ?, NULL)
    `)

    let count = 0
    const transaction = db.transaction(() => {
      for (const meeting of meetings) {
        const attendeeEmails = (meeting.attendees || [])
          .map(a => a.email)
          .filter(Boolean)

        const companyMatch = matchCompany(attendeeEmails, meeting.title)
        const date = meeting.start_time
          ? new Date(meeting.start_time).toISOString().split('T')[0]
          : null

        upsert.run(
          `fellow-${meeting.id}`,
          meeting.title || 'Untitled Meeting',
          date,
          JSON.stringify(meeting.attendees || []),
          companyMatch?.id || null,
          null, // Summary fetched separately
        )
        count++
      }
    })

    transaction()
    console.log(`[Fellow] Synced ${count} meetings`)
    return count
  } catch (err: any) {
    console.error('[Fellow] Sync error:', err.message)
    throw err
  }
}

export async function getFellowTranscript(meetingId: string): Promise<string | null> {
  try {
    // Strip the 'fellow-' prefix if present
    const id = meetingId.replace('fellow-', '')
    const data = await fellowFetch(`/meetings/${id}/transcript`)
    return data.transcript || data.text || null
  } catch (err: any) {
    console.error(`[Fellow] Transcript error for ${meetingId}:`, err.message)
    return null
  }
}

export async function getFellowSummary(meetingId: string): Promise<string | null> {
  try {
    const id = meetingId.replace('fellow-', '')
    const data = await fellowFetch(`/meetings/${id}/summary`)
    return data.summary || data.text || null
  } catch (err: any) {
    console.error(`[Fellow] Summary error for ${meetingId}:`, err.message)
    return null
  }
}

export function isFellowConfigured(): boolean {
  return !!getApiKey()
}
