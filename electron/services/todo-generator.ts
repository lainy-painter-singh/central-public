import OpenAI from 'openai'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { getDb } from '../db/database'
import { isPortfolioCompany } from '../utils/portfolio'
import { SKIP_DOMAINS } from '../utils/skip-domains'
import { v4 as uuid } from 'uuid'

interface ExtractedTodo {
  title: string
  company: string | null
  priority: 'high' | 'medium' | 'low'
  deadline: string | null
  context: string
}

/**
 * Meeting title patterns that should NEVER generate todos.
 * Expert network / research calls are informational only.
 */
const SKIP_TITLE_PATTERNS = [
  /alphasights/i,
  /tegus/i,
  /third\s*bridge/i,
  /glg\b/i,
  /guidepoint/i,
  /expert\s*(network|call|interview)/i,
]

function shouldSkipMeeting(title: string): boolean {
  return SKIP_TITLE_PATTERNS.some(p => p.test(title))
}

function getOpenAIKey(): string | null {
  // Check the Granola archivist .env file first
  const envPath = path.join(os.homedir(), '.granola-archivist', '.env')
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8')
    const match = envContent.match(/OPENAI_API_KEY=(.+)/)
    if (match) return match[1].trim()
  }

  // Check app settings
  const db = getDb()
  const setting = db.prepare("SELECT value FROM settings WHERE key = 'openai_api_key'").get() as any
  if (setting?.value) return setting.value

  // Check environment variable
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY

  return null
}

const SYSTEM_PROMPT = `You extract action items from a VC investor's meeting notes. Be EXTREMELY conservative. 95%+ of meetings should produce ZERO action items. Return an empty array unless you are highly confident.

ONLY extract a todo if ALL of these are true:
1. Lainy used VERBATIM commitment language in the transcript: "I will...", "I'll...", "Let me...", "I'll send...", "I'll email..."
2. You can point to the EXACT quote where she made the commitment
3. The action is a specific, concrete, one-time task with a clear deliverable
4. It is HER personal responsibility, not the company's, a colleague's, or a team task

NEVER extract any of these — they are the most common false positives:
- Introductions: NEVER extract intros unless Lainy said the EXACT words "I will introduce" or "I'll make that intro" AND named BOTH specific people. If notes just mention people who could be connected, that is NOT a commitment.
- Connecting people: "Connect X with Y", "Put X in touch with Y", "Reintroduce X to Y" — these are almost always brainstorming, not commitments. Skip them.
- Internal Craft tasks: Anything involving Craft colleagues (Aaron, Sara Blanchard, Kevin, Jeff, etc.) is internal and should NEVER be extracted.
- Things discussed: If the notes describe a topic that was discussed (hiring, intros, strategy), that does NOT mean Lainy committed to act on it.
- Advice given: Suggestions or recommendations Lainy offered are not her action items.
- Vague follow-ups: "follow up", "circle back", "stay in touch", "keep an eye on"
- Company tasks: Things the founder/company will do
- Expert/research calls: Never extract from AlphaSights, Tegus, etc.
- Board meeting items: These belong to the company, not Lainy
- Reviews: Unless Lainy specifically said "I will review [specific document]"

VALID (notice these require VERBATIM commitment in the transcript):
- "Send the competitive analysis to [specific founder]" — she literally said "I'll send it over"
- "Give feedback on the term sheet by Friday" — she was directly asked and said "yes, I'll get you feedback"

INVALID — DO NOT extract:
- "Make intro: X to Y" ← intros discussed in conversation, not explicitly committed
- "Connect X with Y for hiring" ← discussed a connection, didn't firmly commit
- "Reintroduce X to Y" ← mentioned a past relationship, not a new commitment
- "Share candidates" ← topic discussed, not a commitment to source candidates
- "Sign up for enterprise plan" ← product discussed
- "Schedule check-ins" ← vague/ongoing
- Any action involving Craft Ventures team members ← internal, not a todo

CRITICAL: When in doubt, return an empty array. The user adds items manually and STRONGLY prefers no false positives. An empty result is the EXPECTED and CORRECT output for nearly every meeting.

Every todo MUST have a company name (the startup, NEVER "Craft Ventures"). No company = skip.

Return JSON: { "todos": [...] }
Each todo: { "title": string, "company": string, "priority": "high"|"medium"|"low", "deadline": string|null, "context": string }
Default to { "todos": [] }.`

export async function extractTodosFromMeeting(
  meetingId: string,
  meetingTitle: string,
  content: string,
  companyId: string | null
): Promise<number> {
  const db = getDb()

  // Skip expert network calls entirely
  if (shouldSkipMeeting(meetingTitle)) {
    console.log(`[TodoGen] Skipping expert call: "${meetingTitle}"`)
    db.prepare('UPDATE meetings SET todos_extracted = 1 WHERE id = ?').run(meetingId)
    return 0
  }

  const apiKey = getOpenAIKey()
  if (!apiKey) {
    console.error('[TodoGen] No OpenAI API key found')
    return 0
  }

  const openai = new OpenAI({ apiKey })

  // Provide meeting type context to the model
  let meetingType = 'unknown'
  if (companyId && isPortfolioCompany(companyId)) {
    meetingType = 'portfolio company meeting'
  } else if (/craft/i.test(meetingTitle) && !/\<\>/.test(meetingTitle)) {
    meetingType = 'internal team meeting'
  } else {
    meetingType = 'pipeline/prospect meeting'
  }

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Meeting type: ${meetingType}\nMeeting: "${meetingTitle}"\n\nContent:\n${content.slice(0, 8000)}\n\nExtract action items. Return JSON: { "todos": [...] }`,
        },
      ],
    })

    const result = JSON.parse(response.choices[0]?.message?.content || '{"todos":[]}')
    const todos: ExtractedTodo[] = result.todos || []

    if (todos.length === 0) {
      console.log(`[TodoGen] No action items found for "${meetingTitle}"`)
      db.prepare('UPDATE meetings SET todos_extracted = 1 WHERE id = ?').run(meetingId)
      return 0
    }

    // Determine todo type based on company
    const todoType = companyId && isPortfolioCompany(companyId)
      ? 'portfolio_followup'
      : 'deal_followup'

    // Resolve company name → company_id. Auto-creates if needed.
    const resolveCompanyId = (companyName: string | null): string | null => {
      if (companyId) return companyId
      if (!companyName) return null

      const nameLower = companyName.toLowerCase()
      const firstWord = nameLower.split(/[\s,]+/)[0]

      // Try exact-ish match first
      const match = db.prepare(
        "SELECT id FROM companies WHERE LOWER(name) = ? OR LOWER(name) LIKE ?"
      ).get(nameLower, `${firstWord}%`) as any
      if (match?.id) return match.id

      // Auto-create as a deal/prospect company so the todo has a tag
      const slug = nameLower.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      db.prepare(
        "INSERT OR IGNORE INTO companies (id, name, relationship) VALUES (?, ?, 'deal')"
      ).run(slug, companyName)
      console.log(`[TodoGen] Auto-created company: ${companyName} (${slug})`)
      return slug
    }

    const insert = db.prepare(`
      INSERT OR IGNORE INTO todos (id, title, company_id, type, priority, source, source_meeting_id, source_meeting_title, deadline, context)
      VALUES (?, ?, ?, ?, ?, 'ai', ?, ?, ?, ?)
    `)

    let count = 0
    const transaction = db.transaction(() => {
      for (const todo of todos) {
        // Every todo MUST have a company — skip if none
        if (!todo.company) {
          console.log(`[TodoGen] Skipping todo without company: "${todo.title}"`)
          continue
        }

        const resolvedCompanyId = resolveCompanyId(todo.company)
        if (!resolvedCompanyId) {
          console.log(`[TodoGen] Skipping todo, couldn't resolve company "${todo.company}": "${todo.title}"`)
          continue
        }

        const resolvedType = resolvedCompanyId && isPortfolioCompany(resolvedCompanyId)
          ? 'portfolio_followup'
          : todoType

        insert.run(
          uuid(),
          todo.title,
          resolvedCompanyId,
          resolvedType,
          todo.priority || 'medium',
          meetingId,
          meetingTitle,
          todo.deadline,
          todo.context || null
        )
        count++
      }

      // Mark meeting as processed
      db.prepare('UPDATE meetings SET todos_extracted = 1 WHERE id = ?').run(meetingId)
    })

    transaction()
    console.log(`[TodoGen] Extracted ${count} action items from "${meetingTitle}"`)
    return count
  } catch (err: any) {
    console.error(`[TodoGen] Error processing "${meetingTitle}":`, err.message)
    return 0
  }
}

/**
 * Safety cap: if we already have this many open AI-generated todos,
 * stop processing more meetings. Prevents runaway todo generation
 * when DB flags get reset or migrated.
 */
const MAX_OPEN_AI_TODOS = 10

/**
 * Process all unprocessed meetings and extract todos.
 */
export async function processUnextractedMeetings(): Promise<number> {
  const db = getDb()

  // Safety check: how many open AI-generated todos already exist?
  const existing = db.prepare(`
    SELECT count(*) as c FROM todos
    WHERE status = 'open' AND source = 'ai'
  `).get() as any
  if (existing.c >= MAX_OPEN_AI_TODOS) {
    console.log(`[TodoGen] Skipping: already ${existing.c} open AI todos (cap: ${MAX_OPEN_AI_TODOS})`)
    return 0
  }

  const unprocessed = db.prepare(`
    SELECT id, title, summary, company_id FROM meetings
    WHERE todos_extracted = 0 AND (summary IS NOT NULL AND summary != '')
    ORDER BY date DESC
    LIMIT 20
  `).all() as any[]

  let totalTodos = 0

  for (const meeting of unprocessed) {
    // Re-check cap during processing
    const current = db.prepare(`SELECT count(*) as c FROM todos WHERE status = 'open' AND source = 'ai'`).get() as any
    if (current.c >= MAX_OPEN_AI_TODOS) {
      console.log(`[TodoGen] Hit cap of ${MAX_OPEN_AI_TODOS} open AI todos, stopping`)
      break
    }

    const count = await extractTodosFromMeeting(
      meeting.id,
      meeting.title,
      meeting.summary,
      meeting.company_id
    )
    totalTodos += count

    // Small delay to respect rate limits
    await new Promise(resolve => setTimeout(resolve, 200))
  }

  console.log(`[TodoGen] Processed ${unprocessed.length} meetings, extracted ${totalTodos} todos`)
  return totalTodos
}

/**
 * Title patterns that indicate a pitch / intro meeting with a non-portfolio company.
 * These get an auto-created "Review fundraising materials" todo.
 */
const PITCH_TITLE_PATTERNS = [
  /craft\s*(?:ventures?\s*)?<-?>/i,          // "Craft <> CompanyName" or "Craft <-> X"
  /<-?>\s*craft/i,                           // "CompanyName <> Craft" or "X <-> Craft"
  /\(craft\)\s*<-?>/i,                       // "(Craft) <-> X"
  /<-?>\s*\(craft/i,                         // "X <-> (Craft)"
  /\bintro\b/i,                              // "Intro: X meets Y"
  /\bintroduction\b/i,                       // "Introduction to..."
  /\bpitch\b/i,                              // Explicit pitch
  /\bfirst\s*(?:call|meeting|chat)\b/i,      // "First call with..."
]

function isPitchTitle(title: string): boolean {
  return PITCH_TITLE_PATTERNS.some(p => p.test(title))
}

/**
 * Detect pitch meetings from calendar events and create "Review fundraising materials" todos.
 *
 * A pitch meeting is identified when:
 *   1. Calendar event occurred in the past 7 days
 *   2. Title contains pitch signals (Craft <>, intro, etc.)
 *   3. Has external attendees (not all from skip-domains)
 *   4. Not already associated with a portfolio/board company
 *   5. No existing "review materials" todo for this company
 */
export function detectPitchMeetingTodos(): number {
  const db = getDb()
  let created = 0

  // Get recent past calendar events (last 7 days)
  const events = db.prepare(`
    SELECT ce.id, ce.title, ce.date, ce.attendees, ce.company_id, c.name as company_name, c.relationship
    FROM calendar_events ce
    LEFT JOIN companies c ON ce.company_id = c.id
    WHERE ce.date >= date('now', '-7 days') AND ce.date <= date('now')
    ORDER BY ce.date DESC
  `).all() as any[]

  for (const event of events) {
    if (!event.title) continue

    // Skip if not a pitch-like title
    if (!isPitchTitle(event.title)) continue

    // Skip expert calls
    if (shouldSkipMeeting(event.title)) continue

    // Skip portfolio/board companies
    if (event.relationship === 'board_seat' || event.relationship === 'board_observer' || event.relationship === 'portfolio') continue

    // Must have external attendees
    let hasExternal = false
    let prospectDomain: string | null = null
    try {
      const attendees = JSON.parse(event.attendees || '[]')
      for (const a of attendees) {
        const email = a.email || ''
        const atIdx = email.lastIndexOf('@')
        if (atIdx > 0) {
          const domain = email.slice(atIdx + 1).toLowerCase().trim()
          if (domain && !SKIP_DOMAINS.has(domain)) {
            hasExternal = true
            if (!prospectDomain) prospectDomain = domain
          }
        }
      }
    } catch { /* ignore */ }

    if (!hasExternal) continue

    // Determine company name
    let companyName = event.company_name
    let companyId = event.company_id

    if (!companyName && prospectDomain) {
      // Try to find company by domain
      const match = db.prepare("SELECT id, name FROM companies WHERE domain LIKE ?").get(`%${prospectDomain}%`) as any
      if (match) {
        companyId = match.id
        companyName = match.name
      } else {
        // Extract from title — look for the non-Craft side of "Craft <> X" or "Craft <-> X" pattern
        const craftPattern = event.title.match(/(?:craft\s*(?:ventures?\s*)?<-?>\s*(.+)|(.+?)\s*<-?>\s*craft)/i)
        if (craftPattern) {
          companyName = (craftPattern[1] || craftPattern[2]).trim()
        }

        // Try "Person (Company) <-> Person (Company)" pattern — extract non-Craft parenthetical
        if (!companyName || /craft/i.test(companyName)) {
          const parens = event.title.match(/\(([^)]+)\)/g)
          if (parens) {
            for (const p of parens) {
              const inner = p.slice(1, -1).trim()
              if (!/craft/i.test(inner)) {
                companyName = inner
                break
              }
            }
          }
        }

        if (!companyName) {
          // Use domain root as company name
          companyName = prospectDomain.split('.')[0]
          companyName = companyName.charAt(0).toUpperCase() + companyName.slice(1)
        }
      }
    }

    if (!companyName) continue

    // Check if we already have a review materials todo for this company (by name match or company_id)
    const existingTodo = companyId
      ? db.prepare("SELECT id FROM todos WHERE company_id = ? AND title LIKE '%Review%materials%' AND status = 'open'").get(companyId)
      : db.prepare("SELECT id FROM todos WHERE title LIKE ? AND status = 'open'").get(`%Review%${companyName}%`)

    if (existingTodo) continue

    // Create the todo
    const todoId = uuid()
    if (!companyId) {
      // Auto-create company as deal
      companyId = companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      db.prepare("INSERT OR IGNORE INTO companies (id, name, relationship, domain) VALUES (?, ?, 'deal', ?)").run(
        companyId, companyName, prospectDomain
      )
    }

    db.prepare(`
      INSERT INTO todos (id, title, company_id, type, priority, status, source, source_meeting_title, context)
      VALUES (?, ?, ?, 'deal_followup', 'high', 'open', 'auto', ?, ?)
    `).run(
      todoId,
      `Review fundraising materials - ${companyName}`,
      companyId,
      event.title,
      `Auto-created: pitch meeting detected from "${event.title}" on ${event.date}`
    )

    console.log(`[TodoGen] Created review materials todo for ${companyName} (from "${event.title}")`)
    created++
  }

  if (created > 0) {
    console.log(`[TodoGen] Created ${created} pitch meeting review todos`)
  }
  return created
}
