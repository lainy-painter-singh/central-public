/**
 * Board Meeting Workflow
 *
 * Automates the full board meeting lifecycle:
 * 1. Pre-meeting: Search Gmail for board decks/documents from the company
 * 2. Post-meeting: Collect notes from Granola + Fellow
 * 3. Auto-draft board summary using meeting content + deck content
 *
 * Runs on startup after board detection and calendar sync complete.
 */
import { google } from 'googleapis'
import { getAuthenticatedClient, isGoogleConnected } from './google-auth'
import { getDb } from '../db/database'
import { syncGranolaMeetings } from './granola'
import { syncFellowMeetings, getFellowTranscript, getFellowSummary, isFellowConfigured } from './fellow'
import { generateBoardSummary } from './board-summary'

const DOC_DOMAINS = [
  'docsend.com', 'docs.google.com', 'drive.google.com',
  'dropbox.com', 'box.com', 'notion.so', 'pitch.com',
]

/**
 * Extract document-sharing URLs from a Gmail message payload.
 * Walks MIME parts, Base64-decodes bodies, and filters for known doc platforms.
 */
function extractEmailBodyLinks(payload: any): string[] {
  const links: string[] = []

  function extractFromData(data: string) {
    try {
      const decoded = Buffer.from(data, 'base64url').toString('utf-8')
      const urls = decoded.match(/https?:\/\/[^\s<>"')\]]+/g) || []
      for (const url of urls) {
        if (DOC_DOMAINS.some(d => url.includes(d))) {
          links.push(url)
        }
      }
    } catch { /* skip malformed data */ }
  }

  function walkParts(parts: any[]) {
    for (const part of parts) {
      if (part.parts) walkParts(part.parts)
      if (part.body?.data && (part.mimeType === 'text/plain' || part.mimeType === 'text/html')) {
        extractFromData(part.body.data)
      }
    }
  }

  if (payload.parts) {
    walkParts(payload.parts)
  } else if (payload.body?.data) {
    extractFromData(payload.body.data)
  }

  return [...new Set(links)]
}

/**
 * Format a Date as YYYY/MM/DD for Gmail search queries.
 */
function gmailDateFormat(d: Date): string {
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Search Gmail for board-related documents from a company's domain
 * in the 7-day window before the meeting date.
 *
 * Returns a text summary of found documents (subjects, snippets, links)
 * that can be passed as deckContent to generateBoardSummary.
 */
export async function searchBoardDocs(companyId: string, meetingDate: string): Promise<string> {
  if (!isGoogleConnected()) return ''

  const db = getDb()
  const company = db.prepare('SELECT domain, name FROM companies WHERE id = ?').get(companyId) as any
  if (!company?.domain) return ''

  const domains = company.domain.split(',').map((d: string) => d.trim().toLowerCase()).filter(Boolean)
  if (domains.length === 0) return ''

  let auth
  try {
    auth = await getAuthenticatedClient()
  } catch {
    console.log('[BoardWorkflow] Not authenticated with Google, skipping doc search')
    return ''
  }

  const gmail = google.gmail({ version: 'v1', auth })

  // Build date range: 7 days before meeting to 1 day after
  const meetingD = new Date(meetingDate + 'T12:00:00')
  const afterDate = new Date(meetingD)
  afterDate.setDate(afterDate.getDate() - 7)
  const beforeDate = new Date(meetingD)
  beforeDate.setDate(beforeDate.getDate() + 1)

  const domainQuery = domains.map((d: string) => `from:${d}`).join(' OR ')
  const query = `(${domainQuery}) (board deck OR board materials OR board summary OR pre-read OR board package OR board update) after:${gmailDateFormat(afterDate)} before:${gmailDateFormat(beforeDate)}`

  let messages: any[] = []
  try {
    const response = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: 10,
    })
    messages = response.data.messages || []
  } catch (err: any) {
    console.error('[BoardWorkflow] Gmail search error:', err.message)
    return ''
  }

  if (messages.length === 0) {
    console.log(`[BoardWorkflow] No board docs found in Gmail for ${company.name}`)
    return ''
  }

  const foundDocs: { subject: string; snippet: string; links: string[] }[] = []

  for (const msg of messages) {
    try {
      const full = await gmail.users.messages.get({
        userId: 'me',
        id: msg.id,
        format: 'full',
      })

      const headers = full.data.payload?.headers || []
      const subject = headers.find((h: any) => h.name === 'Subject')?.value || '(no subject)'
      const snippet = full.data.snippet || ''
      const links = extractEmailBodyLinks(full.data.payload)

      foundDocs.push({ subject, snippet, links })
    } catch {
      continue
    }

    // Rate limit
    await new Promise(resolve => setTimeout(resolve, 300))
  }

  if (foundDocs.length === 0) return ''

  // Collect all links for storage
  const allLinks = foundDocs.flatMap(d => d.links)

  // Update board_prep with deck info
  if (allLinks.length > 0) {
    db.prepare(`
      UPDATE board_prep SET deck_source = 'email', deck_path = ?
      WHERE company_id = ? AND meeting_date = ?
    `).run(JSON.stringify(allLinks), companyId, meetingDate)
  }

  console.log(`[BoardWorkflow] Found ${foundDocs.length} board doc emails for ${company.name} (${allLinks.length} links)`)

  // Build text summary for the AI
  return foundDocs.map(doc =>
    `**${doc.subject}**\n${doc.snippet}${doc.links.length > 0 ? '\nLinks: ' + doc.links.join(', ') : ''}`
  ).join('\n\n')
}

/**
 * Sync and collect meeting notes from both Granola and Fellow
 * for a specific company around a board meeting date.
 */
export async function collectBoardMeetingNotes(companyId: string, meetingDate: string): Promise<string> {
  // Re-sync to catch recent additions
  try {
    await syncGranolaMeetings(30)
  } catch (err: any) {
    console.error('[BoardWorkflow] Granola re-sync error:', err.message)
  }

  if (isFellowConfigured()) {
    try {
      await syncFellowMeetings(30)
    } catch (err: any) {
      console.error('[BoardWorkflow] Fellow re-sync error:', err.message)
    }
  }

  const db = getDb()

  // Find meetings for this company around the board meeting date
  const meetings = db.prepare(`
    SELECT id, source, title, summary, transcript
    FROM meetings
    WHERE company_id = ?
    AND date >= date(?, '-7 days')
    AND date <= date(?, '+1 day')
    ORDER BY date DESC
    LIMIT 5
  `).all(companyId, meetingDate, meetingDate) as any[]

  // For Fellow meetings missing content, fetch on-demand
  for (const meeting of meetings) {
    if (meeting.source === 'fellow' && !meeting.summary && !meeting.transcript) {
      console.log(`[BoardWorkflow] Fetching Fellow content for "${meeting.title}"`)
      try {
        const [transcript, summary] = await Promise.all([
          getFellowTranscript(meeting.id),
          getFellowSummary(meeting.id),
        ])
        if (summary || transcript) {
          db.prepare('UPDATE meetings SET summary = ?, transcript = ? WHERE id = ?')
            .run(summary || null, transcript || null, meeting.id)
          meeting.summary = summary
          meeting.transcript = transcript
        }
      } catch (err: any) {
        console.error(`[BoardWorkflow] Fellow fetch error for "${meeting.title}":`, err.message)
      }
      await new Promise(resolve => setTimeout(resolve, 300))
    }
  }

  const MIN_CONTENT_LENGTH = 100 // Require at least 100 chars of real content
  const meetingContent = meetings
    .map(m => {
      const content = m.summary || m.transcript || ''
      // Skip meetings with no substantive content
      return content.trim().length >= MIN_CONTENT_LENGTH ? `### ${m.title}\n${content}` : ''
    })
    .filter(Boolean)
    .join('\n\n')

  if (meetings.length > 0) {
    console.log(`[BoardWorkflow] Collected notes from ${meetings.length} meetings for company ${companyId}`)
  }

  return meetingContent
}

/**
 * Main orchestrator: find board_preps ready for processing and execute the full workflow.
 *
 * Phase 1: Past meetings (need auto-draft) — search docs + collect notes + generate summary
 * Phase 2: Upcoming meetings (need deck search) — search docs only
 */
export async function processReadyBoardPreps(): Promise<{ drafted: number; docsFound: number }> {
  const db = getDb()
  let drafted = 0
  let docsFound = 0

  // Phase 1: Past board meetings that need summary drafting
  const pastPreps = db.prepare(`
    SELECT bp.id, bp.company_id, bp.meeting_date, c.name as company_name
    FROM board_prep bp
    JOIN companies c ON bp.company_id = c.id
    WHERE bp.summary_draft IS NULL
      AND bp.meeting_date <= date('now')
      AND bp.meeting_date >= date('now', '-14 days')
    ORDER BY bp.meeting_date DESC
  `).all() as any[]

  for (const prep of pastPreps) {
    try {
      // Search Gmail for board docs
      const deckContent = await searchBoardDocs(prep.company_id, prep.meeting_date)
      if (deckContent) docsFound++

      // Collect meeting notes from Granola + Fellow
      const meetingContent = await collectBoardMeetingNotes(prep.company_id, prep.meeting_date)

      if (!meetingContent.trim()) {
        console.log(`[BoardWorkflow] No meeting content yet for ${prep.company_name} (${prep.meeting_date}), skipping draft`)
        continue
      }

      // Generate board summary with both meeting content and deck content
      const summary = await generateBoardSummary(
        prep.company_name,
        meetingContent,
        deckContent || undefined
      )

      // Save the draft
      db.prepare('UPDATE board_prep SET summary_draft = ? WHERE id = ?').run(summary, prep.id)
      console.log(`[BoardWorkflow] Auto-drafted summary for ${prep.company_name} (${prep.meeting_date})`)
      drafted++
    } catch (err: any) {
      console.error(`[BoardWorkflow] Error processing ${prep.company_name}:`, err.message)
    }
  }

  // Phase 2: Upcoming board meetings that need deck search
  const upcomingPreps = db.prepare(`
    SELECT bp.id, bp.company_id, bp.meeting_date, c.name as company_name
    FROM board_prep bp
    JOIN companies c ON bp.company_id = c.id
    WHERE bp.deck_source IS NULL
      AND bp.meeting_date > date('now')
      AND bp.meeting_date <= date('now', '+7 days')
    ORDER BY bp.meeting_date ASC
  `).all() as any[]

  for (const prep of upcomingPreps) {
    try {
      const deckContent = await searchBoardDocs(prep.company_id, prep.meeting_date)
      if (deckContent) {
        console.log(`[BoardWorkflow] Pre-meeting docs found for ${prep.company_name} (${prep.meeting_date})`)
        docsFound++
      }
    } catch (err: any) {
      console.error(`[BoardWorkflow] Doc search error for ${prep.company_name}:`, err.message)
    }
  }

  if (drafted + docsFound > 0) {
    console.log(`[BoardWorkflow] Done: ${drafted} summaries drafted, ${docsFound} doc searches found results`)
  }

  return { drafted, docsFound }
}
