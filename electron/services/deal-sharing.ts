/**
 * Deal Sharing Summary Generator
 *
 * Generates deal summaries for sharing with friends/colleagues.
 * Uses meeting notes + Gmail + deal data + GPT-4o to produce concise blurbs.
 *
 * Output format: CompanyName — Description with metrics inline. Round info.
 * See DEAL_SHARING_FORMAT.md for style guide and examples.
 */
import OpenAI from 'openai'
import { google } from 'googleapis'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { getDb } from '../db/database'
import { getVaultMeetingContent } from './vault-reader'
import { getAuthenticatedClient } from './google-auth'

export interface DealShareInfo {
  companyId: string
  companyName: string
  companyUrl: string
  summary: string
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

/**
 * Get meeting content for a company from DB + vault.
 */
function getMeetingContent(companyId: string, companyName: string): string {
  const db = getDb()
  const searchTerms = getSearchTerms(companyName)

  // DB meetings
  const dbMeetings: string[] = []
  for (const term of searchTerms) {
    const rows = db.prepare(`
      SELECT title, date, summary, transcript FROM meetings
      WHERE (LOWER(title) LIKE ? OR company_id = ?)
      AND (summary IS NOT NULL OR transcript IS NOT NULL)
      ORDER BY date DESC LIMIT 5
    `).all(`%${term}%`, companyId) as any[]
    for (const r of rows) {
      dbMeetings.push(`[${r.date}] ${r.title}\n${r.summary || r.transcript || ''}`)
    }
  }

  // Vault content
  const vault = getVaultMeetingContent(companyName)

  // Combine, truncate to 3000 chars per deal to keep prompt manageable
  const combined = [...new Set(dbMeetings)].join('\n\n') + '\n\n' + vault.content
  return combined.slice(0, 3000)
}

/**
 * Search Gmail for recent emails mentioning the company — looking for fundraise details, metrics, decks.
 */
async function getGmailContext(companyName: string, contactEmail: string | null): Promise<string> {
  try {
    const auth = await getAuthenticatedClient()
    const gmail = google.gmail({ version: 'v1', auth })

    // Search by contact email and/or company name in subject
    const queries: string[] = []
    if (contactEmail) {
      queries.push(`from:${contactEmail}`)
      queries.push(`to:${contactEmail}`)
    }
    queries.push(`subject:${companyName}`)
    const query = queries.join(' OR ')

    const response = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: 10,
    })

    const messages = response.data.messages || []
    if (messages.length === 0) return ''

    const snippets: string[] = []
    for (const msg of messages.slice(0, 5)) {
      try {
        const detail = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id!,
          format: 'metadata',
          metadataHeaders: ['Subject', 'From', 'Date'],
        })
        const headers = detail.data.payload?.headers || []
        const subject = headers.find(h => h.name === 'Subject')?.value || ''
        const from = headers.find(h => h.name === 'From')?.value || ''
        const date = headers.find(h => h.name === 'Date')?.value || ''
        const snippet = detail.data.snippet || ''
        snippets.push(`[Email ${date}] From: ${from} Subject: ${subject}\n${snippet}`)
      } catch { /* skip */ }
    }

    return snippets.join('\n\n').slice(0, 2000)
  } catch (err) {
    console.error(`[DealSharing] Gmail search failed for ${companyName}:`, err)
    return ''
  }
}

/**
 * Generate sharing summaries for multiple deals, batching into groups to avoid GPT timeouts.
 */
export async function generateShareSummaries(
  deals: Array<{ companyId: string; companyName: string; contactName?: string }>
): Promise<DealShareInfo[]> {
  const apiKey = getOpenAIKey()
  if (!apiKey) throw new Error('OpenAI API key not configured')

  const db = getDb()

  // Gather all context for each deal: meetings + deal record + Gmail
  const dealContents: Array<{
    companyId: string; companyName: string; companyUrl: string;
    contactName: string; content: string
  }>[] = []

  const enrichedDeals: Array<{
    companyId: string; companyName: string; companyUrl: string;
    contactName: string; content: string
  }> = []

  for (const deal of deals) {
    const meetingContent = getMeetingContent(deal.companyId, deal.companyName)

    // Get deal record for description, revenue, domain
    const dealRow = db.prepare(
      'SELECT description, revenue, round_size, contact_email FROM deals WHERE company_id = ?'
    ).get(deal.companyId) as any

    // Get company domain for URL
    const companyRow = db.prepare(
      'SELECT domain FROM companies WHERE id = ?'
    ).get(deal.companyId) as any

    const companyUrl = companyRow?.domain ? `https://${companyRow.domain}` : ''

    // Search Gmail for fundraise details and metrics
    let gmailContext = ''
    try {
      gmailContext = await getGmailContext(deal.companyName, dealRow?.contact_email || null)
    } catch { /* non-fatal */ }

    // Build full context
    const parts: string[] = []
    if (meetingContent.trim()) parts.push(meetingContent.trim())
    if (gmailContext) parts.push(`--- EMAIL CONTEXT ---\n${gmailContext}`)
    if (dealRow) {
      const extras: string[] = []
      if (dealRow.description) extras.push(`Existing description: ${dealRow.description}`)
      if (dealRow.revenue) extras.push(`Revenue: ${dealRow.revenue}`)
      if (dealRow.round_size) extras.push(`Round: ${dealRow.round_size}`)
      if (extras.length > 0) parts.push(extras.join('\n'))
    }

    enrichedDeals.push({
      companyId: deal.companyId,
      companyName: deal.companyName,
      companyUrl,
      contactName: deal.contactName || '',
      content: parts.length > 0 ? parts.join('\n\n') : `Company name: ${deal.companyName}`,
    })
  }

  if (enrichedDeals.length === 0) return []

  const openai = new OpenAI({ apiKey })

  const systemPrompt = `You are a VC associate writing deal sharing summaries from meeting notes and emails.

STYLE:
- Start with what the company DOES in plain language. Never start with "CompanyName is developing..." or "CompanyName offers..."
- 1-3 sentences max. Be concise and direct.
- Weave metrics in naturally: revenue, ARR, ACV, growth rate, signed contracts
- End with round info if known: "Series A." or "Raising $5-7M." as a short phrase
- No founder names, LinkedIn URLs, or titles
- No fluff: no "leveraging AI", no "positioned against competitors", no "significant traction"
- If data is sparse, keep it SHORT — one sentence is fine. Do NOT pad with speculation.
- NEVER say "sparse meeting notes" or "unable to generate" or "the company name suggests"
- Check email context for fundraise details, metrics, round sizes — these are often more current than meeting notes

GOOD EXAMPLES:
- "AI factory automation for heavy industries, focusing on steel, using hardware and software with sensor boxes in control rooms. 10-15 signed contracts with $350K ACV per module, camera system generating $2M ARR since November. Series A."
- "AI for Energy, starting with oil and gas. $5m in Revenue, 4x YoY."
- "Marketplace connecting family/caregivers with eldercare support (e.g. home health, meals, etc.) Series A."
- "AI agents for healthcare practices, automating tasks like scheduling and insurance workflows. $1.2M in live ARR in 8 months, with another $2.3M in signed contracts."

BAD EXAMPLES (never write like this):
- "Sparse meeting notes provided, unable to generate a detailed summary." — NEVER
- "The company name suggests a focus on providing compassionate services" — NEVER
- "achieving $5M in ARR... is expanding its implementation across healthcare systems, supported by a recent $15M raise" — too wordy, just state the facts

IMPORTANT: Return a summary for EVERY company. Never skip one.

Return ONLY a valid JSON array: [{"company":"Name","summary":"..."}]`

  // Process in batches of 6
  const BATCH_SIZE = 6
  const allResults: DealShareInfo[] = []

  for (let i = 0; i < enrichedDeals.length; i += BATCH_SIZE) {
    const batch = enrichedDeals.slice(i, i + BATCH_SIZE)

    const dealsBlock = batch.map(d => {
      const hint = d.contactName ? `\nKnown founder: ${d.contactName}` : ''
      return `--- ${d.companyName} ---${hint}\n${d.content}`
    }).join('\n\n')

    try {
      console.log(`[DealSharing] Batch ${Math.floor(i/BATCH_SIZE)+1}: ${batch.length} deals (${dealsBlock.length} chars)`)
      const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        temperature: 0.2,
        max_tokens: 2000,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: dealsBlock },
        ],
      })

      const raw = response.choices[0]?.message?.content || '[]'
      const jsonMatch = raw.match(/\[[\s\S]*\]/)
      if (!jsonMatch) {
        console.error('[DealSharing] No JSON in batch response')
        continue
      }

      const parsed = JSON.parse(jsonMatch[0]) as Array<{
        company: string; summary: string
      }>

      console.log(`[DealSharing] Batch returned ${parsed.length} summaries`)

      for (const p of parsed) {
        const match = batch.find(d =>
          d.companyName.toLowerCase() === p.company.toLowerCase()
        )
        allResults.push({
          companyId: match?.companyId || '',
          companyName: p.company,
          companyUrl: match?.companyUrl || '',
          summary: p.summary || '',
        })
      }
    } catch (err: any) {
      console.error(`[DealSharing] Batch ${Math.floor(i/BATCH_SIZE)+1} error:`, err.message)
    }
  }

  console.log(`[DealSharing] Total: ${allResults.length} summaries generated`)
  return allResults
}
