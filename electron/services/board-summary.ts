/**
 * Board Summary Generator
 *
 * Auto-drafts ~200-word board summaries in the Craft Ventures VC voice,
 * using meeting notes/transcripts and optionally deck content.
 *
 * Based on the board-summary skill format:
 * - Narrative (2-4 sentences): headline performance, what stands out, honest assessment
 * - Key Metrics (bulleted): financials first, then qualitative
 * - Under 200 words total
 * - Direct VC voice, specific numbers, no hedging
 */
import OpenAI from 'openai'
import { getDb } from '../db/database'
import path from 'path'
import fs from 'fs'

const BOARD_SUMMARY_SYSTEM_PROMPT = `You are a VC investor at Craft Ventures writing an internal board summary for your partners.

Your job is to write a concise (~200 word) summary of a portfolio company's board meeting. The summary has two parts:

1. **Narrative** (2-4 sentences):
   - Lead with headline performance (ARR/revenue + growth rate)
   - What stands out this quarter (big deal, pivot, concerning trend)
   - Honest assessment -- be direct, not hedged
   - Board-level context if relevant (strategic discussions, fundraising, team)

2. **Key Metrics** (bulleted list):
   - Financial metrics first: ARR, Cash, Burn, Runway, Net New ARR, Retention, Gross Margin
   - Then qualitative context and forward-looking items
   - Format numbers precisely: \$9.7M not ~\$10M, use \$XM for >$1M, \$XXK for <$1M
   - Inline context when relevant

CRITICAL RULES:
- ONLY include metrics and facts that are EXPLICITLY stated in the provided content.
- NEVER fabricate, estimate, or infer numbers that are not in the source material.
- If a metric (ARR, burn, runway, etc.) is not mentioned in the content, DO NOT include it.
- If the content does not contain enough substance to write a meaningful summary, respond with exactly: "INSUFFICIENT_CONTENT"
- Only include Key Metrics that have specific numbers from the source material.

Style rules:
- Use double hyphens -- not emdashes
- Direct, conversational VC voice (first person "I" or "we")
- Abbreviations fine: ARR, NRR, GRR, GM, YoY, QoQ, ACV, ASP
- Keep under 200 words total
- Be honest and direct -- if things are bad, say so
- Cut ruthlessly

Return ONLY the summary text, no preamble or explanation.`

function getOpenAIKey(): string | null {
  // Try env file first
  const envPath = path.join(process.env.HOME || '', '.granola-archivist', '.env')
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8')
    const match = envContent.match(/OPENAI_API_KEY=(.+)/)
    if (match) return match[1].trim()
  }

  // Try settings
  try {
    const db = getDb()
    const setting = db.prepare("SELECT value FROM settings WHERE key = 'openai_api_key'").get() as any
    if (setting?.value) return setting.value
  } catch { }

  return null
}

/**
 * Generate a board summary from meeting content
 */
export async function generateBoardSummary(
  companyName: string,
  meetingContent: string,
  deckContent?: string
): Promise<string> {
  const apiKey = getOpenAIKey()
  if (!apiKey) {
    throw new Error('OpenAI API key not configured')
  }

  const openai = new OpenAI({ apiKey })

  let userPrompt = `Write a board summary for ${companyName}.\n\n`

  if (deckContent) {
    userPrompt += `## Board Deck Content\n${deckContent}\n\n`
  }

  userPrompt += `## Meeting Notes / Transcript\n${meetingContent}`

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: BOARD_SUMMARY_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.3,
    max_tokens: 600,
  })

  const result = response.choices[0]?.message?.content?.trim() || ''

  if (!result || result === 'INSUFFICIENT_CONTENT') {
    throw new Error('Not enough substantive content to generate a board summary. Need meeting notes with specific metrics or board deck materials.')
  }

  return result
}

/**
 * Generate themed board prep questions from deck content or meeting context
 */
export async function generateBoardQuestions(
  companyName: string,
  content: string
): Promise<{ theme: string; question: string; checked: boolean }[]> {
  const apiKey = getOpenAIKey()
  if (!apiKey) {
    throw new Error('OpenAI API key not configured')
  }

  const openai = new OpenAI({ apiKey })

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `You are a VC investor preparing for a board meeting. Generate 6-9 key questions to ask during the ${companyName} board meeting, organized by theme.

Return a JSON array of objects with: {"theme": string, "question": string, "checked": false}

Themes should be from: "Financial", "Product", "GTM" (Go-To-Market), "Team", "Strategy"

Focus on:
- Financial: runway, burn rate trends, revenue trajectory, unit economics
- Product: roadmap progress, key launches, customer feedback
- GTM: pipeline, win rates, churn, expansion revenue
- Team: key hires/departures, org health, capacity
- Strategy: competitive landscape, market shifts, fundraising timing

Be specific based on the content provided. Ask pointed, board-level questions -- not generic ones.
Return ONLY the JSON array, no other text.`,
      },
      {
        role: 'user',
        content: `Generate board prep questions for ${companyName} based on:\n\n${content}`,
      },
    ],
    temperature: 0.7,
    max_tokens: 1000,
    response_format: { type: 'json_object' },
  })

  const raw = response.choices[0]?.message?.content?.trim() || '[]'
  try {
    const parsed = JSON.parse(raw)
    // Handle both {questions: [...]} and direct array
    const questions = Array.isArray(parsed) ? parsed : (parsed.questions || [])
    return questions.map((q: any) => ({
      theme: q.theme || 'General',
      question: q.question || q.text || '',
      checked: false,
    }))
  } catch {
    console.error('[BoardSummary] Failed to parse questions:', raw)
    return []
  }
}

/**
 * Auto-draft a board summary for a specific board_prep record
 */
export async function autoDraftBoardSummary(boardPrepId: string): Promise<string> {
  const db = getDb()

  const prep = db.prepare(`
    SELECT bp.*, c.name as company_name
    FROM board_prep bp
    JOIN companies c ON bp.company_id = c.id
    WHERE bp.id = ?
  `).get(boardPrepId) as any

  if (!prep) throw new Error('Board prep not found')

  // Find meeting content for this company around this date
  const meetings = db.prepare(`
    SELECT title, summary, transcript
    FROM meetings
    WHERE company_id = ?
    AND date >= date(?, '-7 days')
    AND date <= date(?, '+1 day')
    ORDER BY date DESC
    LIMIT 3
  `).all(prep.company_id, prep.meeting_date, prep.meeting_date) as any[]

  const meetingContent = meetings
    .map(m => {
      const content = m.summary || m.transcript || ''
      return `### ${m.title}\n${content}`
    })
    .join('\n\n')

  if (!meetingContent.trim()) {
    throw new Error('No meeting content available for this board meeting')
  }

  const summary = await generateBoardSummary(prep.company_name, meetingContent)

  // Save draft
  db.prepare('UPDATE board_prep SET summary_draft = ? WHERE id = ?').run(summary, boardPrepId)

  return summary
}
