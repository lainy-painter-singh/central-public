/**
 * Deal Overview Generator
 *
 * Combines all meeting transcripts/summaries for a deal's company and runs them
 * through structured prompts to generate a VC-focused overview with sections:
 * Team, Problem, Product, Go-to-market, Traction, Funding, Agreed next steps.
 */
import OpenAI from 'openai'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { getDb } from '../db/database'
import { getVaultMeetingContent } from './vault-reader'

const SECTIONS = [
  {
    key: 'team',
    title: 'Team',
    prompt: 'Detail the background of the team members and their previous experience. Include names, titles, and relevant past roles.',
  },
  {
    key: 'problem',
    title: 'Problem',
    prompt: 'What problem is the startup trying to solve? Who has this problem? How many people or businesses have this problem? Why is it a problem?',
  },
  {
    key: 'product',
    title: 'Product',
    prompt: 'What product is the startup building? How does the product work? How does it solve the user\'s problem? Any specific details about the product.',
  },
  {
    key: 'gtm',
    title: 'Go-to-market',
    prompt: 'How will they sell the product? Have they started selling it yet? How are they reaching customers? How much will it cost? How will they get lots of customers?',
  },
  {
    key: 'traction',
    title: 'Traction',
    prompt: 'What has the startup achieved so far? How many users do they have? How much money are they making? What other progress or traction do they have?',
  },
  {
    key: 'funding',
    title: 'Funding',
    prompt: 'Is the startup currently fundraising? If so, how much are they looking to raise and under what terms? Has the startup raised money in the past? If so, how much did they raise, from whom, and on what terms.',
  },
  {
    key: 'next_steps',
    title: 'Agreed next steps',
    prompt: 'What are the important dates or deadlines mentioned? What is the timeline for getting back to them? What follow-up actions were discussed?',
  },
]

export interface DealOverview {
  sections: Array<{
    key: string
    title: string
    content: string
  }>
  generatedAt: string
  meetingCount: number
}

function getSearchTerms(companyName: string): string[] {
  const full = companyName.toLowerCase().trim()
  const terms = [full]
  const genericWords = ['health', 'labs', 'care', 'tech', 'technologies', 'inc', 'ai', 'io', 'app',
    'the', 'and', 'for', 'flow', 'ventures', 'capital', 'partners', 'group', 'digital',
    'solutions', 'services', 'systems', 'global', 'data', 'cloud', 'software', 'platform']
  const words = full.split(/[\s\-_]+/).filter(w => w.length >= 3)
  if (words.length > 1) {
    for (const w of words) {
      if (w.length >= 4 && !terms.includes(w) && !genericWords.includes(w)) {
        terms.push(w)
      }
    }
  }
  return terms
}

function getOpenAIKey(): string | null {
  const envPath = path.join(os.homedir(), '.granola-archivist', '.env')
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8')
    const match = envContent.match(/OPENAI_API_KEY=(.+)/)
    if (match) return match[1].trim()
  }
  const db = getDb()
  const setting = db.prepare("SELECT value FROM settings WHERE key = 'openai_api_key'").get() as any
  if (setting?.value) return setting.value
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY
  return null
}

/**
 * Generate a structured overview for a deal by analyzing all linked meeting content.
 */
export async function generateDealOverview(
  companyId: string,
  companyName: string
): Promise<DealOverview> {
  const apiKey = getOpenAIKey()
  if (!apiKey) {
    throw new Error('OpenAI API key not configured')
  }

  // Primary source: Obsidian vault meeting files (richest content)
  const vault = getVaultMeetingContent(companyName)
  console.log(`[DealOverview] Vault files for ${companyName}: ${vault.count}`)

  // Secondary source: DB meetings (may have transcripts/summaries)
  const db = getDb()
  const searchTerms = getSearchTerms(companyName)
  type MeetingRow = { title: string; date: string; summary: string | null; transcript: string | null; source: string }
  const dbMeetings: MeetingRow[] = []

  const byId = db.prepare(`
    SELECT title, date, summary, transcript, source FROM meetings
    WHERE company_id = ? ORDER BY date DESC LIMIT 20
  `).all(companyId) as MeetingRow[]
  dbMeetings.push(...byId)

  for (const term of searchTerms) {
    const results = db.prepare(`
      SELECT title, date, summary, transcript, source FROM meetings
      WHERE LOWER(title) LIKE '%' || ? || '%' ORDER BY date DESC LIMIT 20
    `).all(term) as MeetingRow[]
    for (const m of results) {
      if (!dbMeetings.some(x => x.title === m.title && x.date === m.date)) dbMeetings.push(m)
    }
  }

  // Build DB meeting context (only if they have actual content not in vault)
  const dbContext = dbMeetings
    .filter(m => m.transcript || m.summary)
    .map(m => {
      const content = m.transcript || m.summary || ''
      return `--- Meeting: ${m.title} (${m.date}, ${m.source}) ---\n${content}`
    }).join('\n\n')

  // Combine: vault content first (primary), then DB content for anything extra
  const meetingContext = [vault.content, dbContext].filter(Boolean).join('\n\n')
  const totalMeetings = vault.count + dbMeetings.length

  if (!meetingContext.trim()) {
    return {
      sections: SECTIONS.map(s => ({ key: s.key, title: s.title, content: 'No meeting data available.' })),
      generatedAt: new Date().toISOString(),
      meetingCount: 0,
    }
  }

  console.log(`[DealOverview] Total content for ${companyName}: ${meetingContext.length} chars from ${vault.count} vault + ${dbMeetings.length} DB meetings`)

  // Truncate to ~60k chars to stay within context limits
  const truncatedContext = meetingContext.slice(0, 60000)

  const openai = new OpenAI({ apiKey })

  const sectionPrompts = SECTIONS.map(s => `- ${s.key}: ${s.prompt}`).join('\n')

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `You are a VC analyst at Craft Ventures summarizing meeting notes about a startup called "${companyName}".

Extract information from the meeting transcripts/notes below and organize it into these sections. For each section, provide a concise but thorough summary based ONLY on what was discussed in the meetings. If a section has no relevant information from the meetings, write "Not discussed in meetings."

Be factual and specific — include names, numbers, and concrete details when available. Write in a professional, direct style appropriate for an internal VC memo.

Sections:
${sectionPrompts}

Return your response as JSON with this exact structure:
{
  "team": "...",
  "problem": "...",
  "product": "...",
  "gtm": "...",
  "traction": "...",
  "funding": "...",
  "next_steps": "..."
}

Return ONLY the JSON object, no markdown fences or other text.`,
      },
      {
        role: 'user',
        content: truncatedContext,
      },
    ],
    temperature: 0.3,
    max_tokens: 3000,
  })

  const raw = response.choices[0]?.message?.content || '{}'
  let parsed: Record<string, string>
  try {
    // Strip markdown fences if present
    const cleaned = raw.replace(/^```json?\s*\n?/m, '').replace(/\n?```\s*$/m, '')
    parsed = JSON.parse(cleaned)
  } catch {
    console.error('[DealOverview] Failed to parse response:', raw)
    parsed = {}
  }

  const overview: DealOverview = {
    sections: SECTIONS.map(s => ({
      key: s.key,
      title: s.title,
      content: parsed[s.key] || 'Not discussed in meetings.',
    })),
    generatedAt: new Date().toISOString(),
    meetingCount: totalMeetings,
  }

  // Cache the overview in the DB
  db.prepare(`
    INSERT OR REPLACE INTO settings (key, value)
    VALUES ('deal_overview_' || ?, ?)
  `).run(companyId, JSON.stringify(overview))

  console.log(`[DealOverview] Generated overview for ${companyName} from ${totalMeetings} meetings (${vault.count} vault + ${dbMeetings.length} DB)`)
  return overview
}

/**
 * Get cached overview if available.
 */
export function getCachedOverview(companyId: string): DealOverview | null {
  const db = getDb()
  const row = db.prepare("SELECT value FROM settings WHERE key = 'deal_overview_' || ?").get(companyId) as any
  if (!row?.value) return null
  try {
    return JSON.parse(row.value)
  } catch {
    return null
  }
}
