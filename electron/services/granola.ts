import fs from 'fs'
import path from 'path'
import os from 'os'
import { getDb } from '../db/database'
import { matchCompany } from '../utils/portfolio'

// Try v6 first (current), then fall back to v4 (legacy)
const GRANOLA_CACHE_V6 = path.join(
  os.homedir(),
  'Library/Application Support/Granola/cache-v6.json'
)
const GRANOLA_CACHE_V4 = path.join(
  os.homedir(),
  'Library/Application Support/Granola/cache-v4.json'
)

const GRANOLA_OUTPUT_DIR = path.join(
  os.homedir(),
  '.granola-archivist/output'
)

interface GranolaMeeting {
  id: string
  title: string
  created_at: string
  participants?: Array<{ name: string; email?: string }>
  notes?: string
  ai_summary?: string
  transcript?: string
}

/**
 * Read meetings from the v6 cache format.
 * v6 stores documents as a dict keyed by UUID with notes_plain field.
 */
function readCacheV6(): GranolaMeeting[] {
  if (!fs.existsSync(GRANOLA_CACHE_V6)) return []

  try {
    const raw = JSON.parse(fs.readFileSync(GRANOLA_CACHE_V6, 'utf-8'))
    const docs = raw?.cache?.state?.documents
    if (!docs || typeof docs !== 'object') return []

    const meetings: GranolaMeeting[] = []
    for (const [id, doc] of Object.entries(docs)) {
      const d = doc as any
      if (!d.title || !d.created_at) continue

      // Extract participants from google_calendar_event if available
      const participants: Array<{ name: string; email?: string }> = []
      const calEvent = d.google_calendar_event
      if (calEvent?.attendees && Array.isArray(calEvent.attendees)) {
        for (const a of calEvent.attendees) {
          if (a.email && !a.self) {
            participants.push({ name: a.displayName || a.email, email: a.email })
          }
        }
      }

      // Use notes_plain as the summary (richest text content in v6)
      const summary = d.notes_plain || d.ai_summary || ''

      meetings.push({
        id,
        title: d.title,
        created_at: d.created_at,
        participants,
        notes: summary,
        ai_summary: d.ai_summary || undefined,
      })
    }

    console.log(`[Granola] Read ${meetings.length} documents from cache-v6`)
    return meetings
  } catch (err) {
    console.error('[Granola] Failed to read cache-v6:', err)
    return []
  }
}

/**
 * Read meetings from the legacy v4 cache format.
 */
function readCacheV4(): GranolaMeeting[] {
  if (!fs.existsSync(GRANOLA_CACHE_V4)) return []

  try {
    const cacheData = JSON.parse(fs.readFileSync(GRANOLA_CACHE_V4, 'utf-8'))
    if (Array.isArray(cacheData)) return cacheData
    if (cacheData.meetings) return cacheData.meetings
    if (cacheData.documents) return cacheData.documents
    return []
  } catch (err) {
    console.error('[Granola] Failed to read cache-v4:', err)
    return []
  }
}

export async function syncGranolaMeetings(daysBack: number = 90): Promise<number> {
  const db = getDb()

  // Try v6 first, then v4, then markdown fallback
  let meetings = readCacheV6()
  if (meetings.length === 0) meetings = readCacheV4()
  if (meetings.length === 0 && fs.existsSync(GRANOLA_OUTPUT_DIR)) {
    meetings = readGranolaMarkdownFiles(daysBack)
  }

  // Filter to recent meetings
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - daysBack)

  const recentMeetings = meetings.filter(m => {
    const meetingDate = new Date(m.created_at)
    return meetingDate >= cutoffDate
  })

  // Upsert into database — preserve todos_extracted flag on re-sync
  const upsert = db.prepare(`
    INSERT INTO meetings (id, source, title, date, attendees, company_id, summary, raw_path)
    VALUES (?, 'granola', ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      date = excluded.date,
      attendees = excluded.attendees,
      company_id = excluded.company_id,
      summary = CASE
        WHEN LENGTH(excluded.summary) > LENGTH(COALESCE(meetings.summary, ''))
        THEN excluded.summary
        ELSE meetings.summary
      END
  `)

  let count = 0
  const transaction = db.transaction(() => {
    for (const meeting of recentMeetings) {
      const attendees = meeting.participants || []
      const attendeeEmails = attendees
        .map(a => a.email)
        .filter(Boolean) as string[]

      // Try to match to a portfolio company
      const companyMatch = matchCompany(attendeeEmails, meeting.title)

      const date = meeting.created_at
        ? new Date(meeting.created_at).toISOString().split('T')[0]
        : null

      const summary = meeting.ai_summary || meeting.notes || null

      upsert.run(
        `granola-${meeting.id}`,
        meeting.title || 'Untitled Meeting',
        date,
        JSON.stringify(attendees),
        companyMatch?.id || null,
        summary,
        null
      )
      count++
    }
  })

  transaction()
  console.log(`[Granola] Synced ${count} meetings`)
  return count
}

function readGranolaMarkdownFiles(daysBack: number): GranolaMeeting[] {
  const meetings: GranolaMeeting[] = []
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - daysBack)

  try {
    const files = fs.readdirSync(GRANOLA_OUTPUT_DIR)
      .filter(f => f.endsWith('.md'))
      .sort()
      .reverse()

    for (const file of files) {
      // Extract date from filename: YYYY-MM-DD-...
      const dateMatch = file.match(/^(\d{4}-\d{2}-\d{2})/)
      if (!dateMatch) continue

      const fileDate = new Date(dateMatch[1])
      if (fileDate < cutoff) continue

      const filePath = path.join(GRANOLA_OUTPUT_DIR, file)
      const content = fs.readFileSync(filePath, 'utf-8')

      // Parse the markdown file
      const titleMatch = content.match(/^# Meeting: (.+)$/m)
      const attendeesMatch = content.match(/^Attendees: (.+)$/m)
      const summaryMatch = content.match(/## AI Summary\n([\s\S]*?)(?=\n## |$)/)
      const notesMatch = content.match(/## Your Notes\n([\s\S]*?)(?=\n## |$)/)

      const attendees = attendeesMatch
        ? attendeesMatch[1].split(',').map(a => {
            const emailMatch = a.match(/\(([^)]+)\)/)
            return {
              name: a.replace(/\([^)]+\)/, '').trim(),
              email: emailMatch ? emailMatch[1] : undefined,
            }
          })
        : []

      meetings.push({
        id: file.replace('.md', ''),
        title: titleMatch ? titleMatch[1] : file.replace('.md', ''),
        created_at: dateMatch[1],
        participants: attendees,
        notes: notesMatch ? notesMatch[1].trim() : undefined,
        ai_summary: summaryMatch ? summaryMatch[1].trim() : undefined,
      })
    }
  } catch (err) {
    console.error('[Granola] Failed to read markdown files:', err)
  }

  return meetings
}
