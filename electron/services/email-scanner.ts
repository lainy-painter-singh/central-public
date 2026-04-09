/**
 * Email Scanner
 *
 * Scans recent Gmail messages from portfolio/board companies for actionable requests.
 * Creates todos when a portfolio company is asking for feedback, review, or approval.
 *
 * Only processes emails from known portfolio/board company domains.
 * Uses OpenAI to classify whether the email genuinely requires Lainy's action.
 */
import { google } from 'googleapis'
import OpenAI from 'openai'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { getAuthenticatedClient } from './google-auth'
import { getDb } from '../db/database'
import { v4 as uuid } from 'uuid'

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

const EMAIL_SYSTEM_PROMPT = `You analyze emails sent to a VC investor (Lainy at Craft Ventures) from portfolio companies.

Determine if this email requires Lainy to take a SPECIFIC action. Only return an action item if the email is:
1. From a portfolio company (board seat or board observer company)
2. Directly asking Lainy for feedback, review, approval, or a decision on something specific
3. Something concrete she needs to respond to or act on

Examples of actionable emails:
- "Can you review our proposed debt restructuring terms?" → "Review [Company] debt restructuring"
- "We're considering a $5M bridge round, would love your thoughts" → "Give feedback to [Company] on $5M raise"
- "Attached is the board deck for review before Thursday's meeting" → "Review [Company] board deck"
- "Could you make an intro to [Person] at [Company]?" → "Intro [Person] to [Company contact]"

NOT actionable (return empty):
- General company updates or newsletters
- FYI emails with no ask
- Meeting invites (handled by calendar)
- Emails where someone else on the team is the main recipient
- Marketing or automated emails
- Thank you notes or acknowledgments

Return JSON: { "action": string | null, "priority": "high" | "medium", "company": string }
If no action needed, return: { "action": null, "priority": "medium", "company": "" }`

interface PortfolioEmailDomain {
  domain: string
  companyId: string
  companyName: string
}

/**
 * Get all portfolio/board company domains for email matching
 */
function getPortfolioDomains(): PortfolioEmailDomain[] {
  const db = getDb()
  const companies = db.prepare(`
    SELECT id, name, domain FROM companies
    WHERE relationship IN ('board_seat', 'board_observer', 'portfolio')
    AND domain IS NOT NULL AND domain != ''
  `).all() as any[]

  const domains: PortfolioEmailDomain[] = []
  for (const c of companies) {
    for (const d of c.domain.split(',')) {
      const trimmed = d.trim().toLowerCase()
      if (trimmed) {
        domains.push({ domain: trimmed, companyId: c.id, companyName: c.name })
      }
    }
  }
  return domains
}

/**
 * Check if we've already scanned this email (by message ID)
 */
function isEmailScanned(messageId: string): boolean {
  const db = getDb()
  // Use the settings table as a simple key-value store for scanned email IDs
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(`email_scanned_${messageId}`) as any
  return !!row
}

function markEmailScanned(messageId: string) {
  const db = getDb()
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(`email_scanned_${messageId}`, '1')
}

/**
 * Scan recent Gmail messages for actionable requests from portfolio companies.
 * Returns the number of todos created.
 */
export async function scanEmailsForActionItems(): Promise<number> {
  const apiKey = getOpenAIKey()
  if (!apiKey) {
    console.log('[EmailScanner] No OpenAI API key, skipping')
    return 0
  }

  let auth
  try {
    auth = await getAuthenticatedClient()
  } catch {
    console.log('[EmailScanner] Not authenticated with Google, skipping')
    return 0
  }

  const gmail = google.gmail({ version: 'v1', auth })
  const portfolioDomains = getPortfolioDomains()

  if (portfolioDomains.length === 0) {
    console.log('[EmailScanner] No portfolio company domains configured')
    return 0
  }

  // Build a Gmail search query for emails from portfolio company domains (last 3 days)
  // Limit to emails sent directly to the user (not CC/BCC mass sends)
  const domainQuery = portfolioDomains
    .map(d => `from:${d.domain}`)
    .join(' OR ')
  const query = `(${domainQuery}) newer_than:3d -category:promotions -category:social`

  let messages: any[] = []
  try {
    const response = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: 20,
    })
    messages = response.data.messages || []
  } catch (err: any) {
    console.error('[EmailScanner] Error listing messages:', err.message)
    return 0
  }

  if (messages.length === 0) {
    console.log('[EmailScanner] No recent portfolio company emails found')
    return 0
  }

  const openai = new OpenAI({ apiKey })
  const db = getDb()
  let created = 0

  for (const msg of messages) {
    if (isEmailScanned(msg.id)) continue

    // Fetch the email
    let emailData: any
    try {
      const full = await gmail.users.messages.get({
        userId: 'me',
        id: msg.id,
        format: 'metadata',
        metadataHeaders: ['From', 'Subject', 'To'],
      })
      emailData = full.data
    } catch {
      continue
    }

    const headers = emailData.payload?.headers || []
    const from = headers.find((h: any) => h.name === 'From')?.value || ''
    const subject = headers.find((h: any) => h.name === 'Subject')?.value || ''
    const to = headers.find((h: any) => h.name === 'To')?.value || ''

    // Match sender domain to portfolio company
    const fromDomain = from.match(/@([a-z0-9.-]+)/i)?.[1]?.toLowerCase()
    if (!fromDomain) {
      markEmailScanned(msg.id)
      continue
    }

    const portfolioMatch = portfolioDomains.find(d => fromDomain === d.domain || fromDomain.endsWith('.' + d.domain))
    if (!portfolioMatch) {
      markEmailScanned(msg.id)
      continue
    }

    // Get email snippet for context (avoid fetching full body)
    const snippet = emailData.snippet || ''

    // Ask OpenAI to classify
    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: EMAIL_SYSTEM_PROMPT },
          {
            role: 'user',
            content: `From: ${from}\nTo: ${to}\nSubject: ${subject}\n\nSnippet: ${snippet}\n\nCompany: ${portfolioMatch.companyName}\n\nDoes this email require a specific action from Lainy? Return JSON.`,
          },
        ],
      })

      const result = JSON.parse(response.choices[0]?.message?.content || '{"action":null}')

      if (result.action) {
        // Check for existing similar todo
        const existing = db.prepare(
          "SELECT id FROM todos WHERE company_id = ? AND title LIKE ? AND status = 'open'"
        ).get(portfolioMatch.companyId, `%${result.action.slice(0, 30)}%`)

        if (!existing) {
          const todoId = uuid()
          db.prepare(`
            INSERT INTO todos (id, title, company_id, type, priority, status, source, context)
            VALUES (?, ?, ?, 'portfolio_followup', ?, 'open', 'auto', ?)
          `).run(
            todoId,
            result.action,
            portfolioMatch.companyId,
            result.priority || 'medium',
            `From email: "${subject}" — ${from}`
          )
          console.log(`[EmailScanner] Created todo: ${result.action} (${portfolioMatch.companyName})`)
          created++
        }
      }
    } catch (err: any) {
      console.error(`[EmailScanner] OpenAI error for "${subject}":`, err.message)
    }

    markEmailScanned(msg.id)

    // Rate limit
    await new Promise(resolve => setTimeout(resolve, 300))
  }

  if (created > 0) {
    console.log(`[EmailScanner] Created ${created} email-based action items`)
  } else {
    console.log(`[EmailScanner] Scanned ${messages.length} emails, no action items`)
  }

  return created
}
