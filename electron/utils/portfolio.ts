import { getDb } from '../db/database'
import { SKIP_DOMAINS } from './skip-domains'

interface CompanyMatch {
  id: string
  name: string
  relationship: string
}

/**
 * Try to match a meeting to a portfolio company based on attendee emails or title.
 * Returns the matched company or null.
 */
export function matchCompany(
  attendeeEmails: string[],
  meetingTitle?: string
): CompanyMatch | null {
  const db = getDb()
  const companies = db.prepare('SELECT id, name, relationship, domain FROM companies').all() as any[]

  // Build domain → company lookup (supports comma-separated domains)
  const domainMap = new Map<string, any>()
  for (const c of companies) {
    if (c.domain) {
      for (const d of c.domain.split(',')) {
        const trimmed = d.trim().toLowerCase()
        if (trimmed) domainMap.set(trimmed, c)
      }
    }
  }

  // 1. Match by email domain
  for (const email of attendeeEmails) {
    const domain = email.split('@')[1]?.toLowerCase()
    if (!domain) continue
    if (SKIP_DOMAINS.has(domain)) continue

    const match = domainMap.get(domain)
    if (match) {
      return { id: match.id, name: match.name, relationship: match.relationship }
    }
  }

  // 2. Match by company name in meeting title
  if (meetingTitle) {
    const titleLower = meetingTitle.toLowerCase()
    for (const company of companies) {
      const nameLower = company.name.toLowerCase()
      // Check for company name in title (with word boundaries)
      if (titleLower.includes(nameLower) ||
          titleLower.includes(nameLower.split(' ')[0])) {
        return { id: company.id, name: company.name, relationship: company.relationship }
      }
    }
  }

  return null
}

/**
 * Check if a company is a portfolio company (board seat or observer).
 */
export function isPortfolioCompany(companyId: string): boolean {
  const db = getDb()
  const company = db.prepare(
    "SELECT relationship FROM companies WHERE id = ? AND relationship IN ('board_seat', 'board_observer')"
  ).get(companyId)
  return !!company
}
