/**
 * Scorecard Generator
 *
 * Generates a 4-slide Craft Ventures ITM (Investment Team Meeting) deck
 * using OpenAI. Takes deal context, meeting notes, uploaded files, and user
 * notes as input, produces structured JSON output for all 4 slides.
 */
import OpenAI from 'openai'
import path from 'path'
import fs from 'fs'
import { getDb } from '../db/database'

const SCORECARD_SYSTEM_PROMPT = `You are a senior investment analyst at Craft Ventures preparing an Investment Team Meeting (ITM) deck. Generate a complete 4-slide ITM scorecard based on the materials provided.

Return a JSON object with exactly these 4 keys:

{
  "slide_1_executive_summary": "markdown string",
  "slide_2_highlights_risks": "markdown string",
  "slide_3_scorecard_table": { "categories": [...] },
  "slide_4_hypothesis_framework": "markdown string"
}

## SLIDE 1: Executive Summary
Format as markdown with:
- **Header**: "Executive Summary: Opportunity to invest in [Company]'s [Round] at [Valuation]"
- Two main bullet points:
  1. Deal overview: what the company does, round details, use of funds (~50 words)
     - Sub-bullet: management projections for runway/growth (~35 words)
  2. Investment recommendation: pro-rata or new investment amount, last round context (~25 words)
     - Sub-bullet: recommendation (bold), conviction level, return estimates
- If financial data available, include a returns table in markdown format

## SLIDE 2: Investment Highlights & Considerations
Format as markdown with two clearly labeled sections:
- **## HIGHLIGHTS** — 4 bullets, each with bold category header + specific evidence (~75-100 words each)
  Standard categories: Market & Best Company Thesis, Leadership & Team, Financial Performance, GTM & Distribution
- **## RISKS & CONSIDERATIONS** — 3 bullets, each with bold category header + risk + mitigation (~50-75 words each)
- **## KEY AREAS TO OPTIMIZE** — 2 short bullets (~15-25 words each)

## SLIDE 3: Deal Summary Scorecard
Return as JSON object with "categories" array. Each category:
{
  "name": "Market" | "Product" | "Category Winner" | "Founders & Team" | "Metrics" | "Returns",
  "sub_label": "optional descriptor",
  "rating": "Strong" | "Strong / Neutral" | "Neutral" | "Neutral / Weak" | "Weak",
  "bullets": ["assessment point 1", "assessment point 2", ...]
}

Rating guidelines:
- **Strong**: Clear evidence of excellence from source materials
- **Neutral**: Mixed signals or limited data
- **Weak**: Concerning evidence or major gaps
- If data for a category is not available, rate "Neutral" and note "Limited data provided"

Word count targets per category:
- Market: 150-200 words (5 bullets: TAM/SAM, future TAM, why now, competitive dynamics, data moat)
- Product: 100-150 words (3 bullets: ROI/distribution, mission criticality, expansion)
- Category Winner: 50-75 words (2 bullets)
- Founders & Team: 75-100 words (4 bullets)
- Metrics: 75-100 words (4 bullets with specific numbers)
- Returns: 100-125 words (4 bullets with calculations)

## SLIDE 4: Hypothesis Framework
Format as markdown table or sections with 3-5 rows:
- **Hypothesis**: Key investment thesis to validate (~10-15 words)
- **Diligence & Findings**: Evidence gathered, including direct quotes if available (~40-60 words)
- **Assessment**: POSITIVE, NEUTRAL, or NEGATIVE

CRITICAL RULES:
- ONLY use facts, metrics, and quotes explicitly stated in the provided materials.
- NEVER fabricate, estimate, or infer numbers that are not in the source material.
- If a metric is not available, write "Not provided" or "TBD" — do NOT make up numbers.
- If there is insufficient data for a section, note what's missing rather than inventing content.
- Use the direct, analytical Craft Ventures VC voice.
- Use double hyphens -- not emdashes.
- Format numbers precisely: $9.7M not ~$10M.
- Abbreviations: ARR, NRR, GRR, GM, YoY, QoQ, ACV, ASP, CAC, LTV.`

function getOpenAIKey(): string | null {
  const envPath = path.join(process.env.HOME || '', '.granola-archivist', '.env')
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8')
    const match = envContent.match(/OPENAI_API_KEY=(.+)/)
    if (match) return match[1].trim()
  }
  try {
    const db = getDb()
    const setting = db.prepare("SELECT value FROM settings WHERE key = 'openai_api_key'").get() as any
    if (setting?.value) return setting.value
  } catch { }
  return null
}

const MAX_INPUT_CHARS = 200_000 // ~80K tokens for GPT-4o-mini

export interface ScorecardOutput {
  slide_executive_summary: string
  slide_highlights_risks: string
  slide_scorecard_table: string
  slide_hypothesis_framework: string
  tokens_used: number
}

export async function generateScorecard(
  dealContext: any,
  meetingContents: { title: string; content: string }[],
  fileContents: { filename: string; content: string }[],
  additionalNotes: string | null
): Promise<ScorecardOutput> {
  const apiKey = getOpenAIKey()
  if (!apiKey) {
    throw new Error('OpenAI API key not configured. Add it to ~/.granola-archivist/.env or the Settings table.')
  }

  const openai = new OpenAI({ apiKey })

  let userPrompt = `Generate a 4-slide ITM scorecard for **${dealContext.company_name}**.\n\n`

  userPrompt += `## Deal Context\n`
  userPrompt += `- Company: ${dealContext.company_name}\n`
  if (dealContext.description) userPrompt += `- Description: ${dealContext.description}\n`
  if (dealContext.revenue) userPrompt += `- Revenue: ${dealContext.revenue}\n`
  if (dealContext.round_size) userPrompt += `- Round: ${dealContext.round_size}\n`
  if (dealContext.source) userPrompt += `- Source: ${dealContext.source}\n`
  if (dealContext.contact_name) userPrompt += `- Contact: ${dealContext.contact_name} (${dealContext.contact_email || 'no email'})\n`
  if (dealContext.notes) userPrompt += `- Notes: ${dealContext.notes}\n`
  userPrompt += '\n'

  if (meetingContents.length > 0) {
    userPrompt += `## Meeting Notes (${meetingContents.length} meetings)\n`
    for (const m of meetingContents) {
      userPrompt += `### ${m.title}\n${m.content}\n\n`
    }
  }

  if (fileContents.length > 0) {
    userPrompt += `## Uploaded Documents (${fileContents.length} files)\n`
    for (const f of fileContents) {
      userPrompt += `### File: ${f.filename}\n${f.content}\n\n`
    }
  }

  if (additionalNotes) {
    userPrompt += `## Additional Analyst Notes\n${additionalNotes}\n`
  }

  // Truncate if too long
  if (userPrompt.length > MAX_INPUT_CHARS) {
    console.warn(`[Scorecard] Input truncated from ${userPrompt.length} to ${MAX_INPUT_CHARS} chars`)
    userPrompt = userPrompt.slice(0, MAX_INPUT_CHARS) + '\n\n[Content truncated due to length...]'
  }

  console.log(`[Scorecard] Generating for ${dealContext.company_name} (${userPrompt.length} chars input)`)

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: SCORECARD_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.3,
    max_tokens: 4000,
    response_format: { type: 'json_object' },
  })

  const raw = response.choices[0]?.message?.content?.trim() || '{}'
  let parsed: any
  try {
    parsed = JSON.parse(raw)
  } catch {
    console.error('[Scorecard] Failed to parse JSON response:', raw.slice(0, 200))
    throw new Error('AI returned invalid JSON. Please try again.')
  }

  return {
    slide_executive_summary: parsed.slide_1_executive_summary || '',
    slide_highlights_risks: parsed.slide_2_highlights_risks || '',
    slide_scorecard_table: JSON.stringify(parsed.slide_3_scorecard_table || { categories: [] }),
    slide_hypothesis_framework: parsed.slide_4_hypothesis_framework || '',
    tokens_used: response.usage?.total_tokens || 0,
  }
}
