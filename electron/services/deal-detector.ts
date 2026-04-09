/**
 * Deal Detector
 *
 * After meetings sync, auto-creates "first_meeting" deals for new prospect companies.
 * Skips portfolio companies, VCs, law firms, expert networks, large public companies, etc.
 *
 * Company name resolution strategy:
 *   1. Try to match the prospect domain to a name in the meeting title
 *   2. Try to extract "(CompanyName)" parenthetical patterns from title
 *   3. Try "Craft <> CompanyName" or "CompanyName <> Craft" patterns
 *   4. Fall back to capitalizing the domain root (e.g. "supio.com" → "Supio")
 */
import { getDb } from '../db/database'
import { SKIP_DOMAINS } from '../utils/skip-domains'
import { isPortfolioCompanyName } from '../utils/portfolio-holdings'
import { v4 as uuid } from 'uuid'

/** Meeting title patterns to SKIP — these aren't prospect meetings */
const SKIP_TITLE_PATTERNS = [
  /alphasights/i,
  /tegus/i,
  /third\s*bridge/i,
  /glg\b/i,
  /guidepoint/i,
  /expert\s*(network|call|interview)/i,
  /ciso\s*advisory/i,           // CISO advisory calls
  /^DNS$/i,                      // Calendar hold
  /break.*clockwise/i,           // Calendar break
  /travel\s*time.*clockwise/i,   // Travel time
  /^\s*$/,                       // Empty titles
  /^(weekly|monthly|quarterly|recurring|standup|stand-up|1:1|1on1)/i,
  /investor\s*update/i,          // LP/investor updates
  /investment\s*process/i,       // Internal process meetings
  /steerco/i,                    // Steering committee
  /portco\s*sync/i,              // Portfolio company syncs (internal)
  /portfolio\s*sync/i,           // Portfolio syncs (handled separately as board/portfolio)
  /partners?\s*(meeting|call|sync|weekly)/i, // Partner meetings
  /deal\s*review/i,              // Internal deal review
]

/** Known Craft people — used to filter personal names from titles */
const CRAFT_PEOPLE = new Set([
  'lainy', 'lainy painter', 'lainy painter singh',
  'kevin', 'kevin gabura',
  'taylor', 'taylor durand',
  'david', 'david sacks',
  'jeff', 'jeff fluhr',
  'bryan', 'bryan rosenblatt',
  'cassie', 'cassie leemans',
  'alec', 'teddy', 'zach', 'ryan', 'crissy', 'josh',
  'alex', 'farzad', 'greg', 'bmur', 'michael', 'shiraz',
  'sarah', 'doug', 'firdaus',
])

/**
 * Try to extract the prospect company name from a meeting title,
 * using the prospect's email domain as a hint.
 *
 * Returns the best company name we can find, or null.
 */
function extractCompanyName(title: string, prospectDomain: string): string {
  const domainRoot = prospectDomain.split('.')[0].toLowerCase()

  // Strategy 1: Does the title contain the domain root as a word/company name?
  // e.g., title "Craft <> Wealth.com" with domain "wealth.com" → "Wealth.com"
  // e.g., title "Craft Ventures <> Supio" with domain "supio.com" → "Supio"
  const domainNameRegex = new RegExp(
    `\\b(${escapeRegex(domainRoot)}(?:\\.[a-z]+)?)\\b`,
    'i'
  )
  const domainMatch = title.match(domainNameRegex)
  if (domainMatch) {
    const found = domainMatch[1]
    // Don't use it if it's a generic word like "meet" (from meetcaspian.com)
    // But do use it for clear matches
    if (found.length >= 3 && found.toLowerCase() !== 'the' && found.toLowerCase() !== 'and') {
      // Check if there's a better version in the title (e.g., domain "chartrhealth.com" but title has "ChartR")
      // Look for capitalized word near the match
      return found.charAt(0).toUpperCase() + found.slice(1)
    }
  }

  // Strategy 2: Split on <>, <->, //, or + separators (primary party separator)
  // Then find the non-Craft side, preferring matches to the prospect domain
  const partySeparator = /\s*(?:<->|<>|\/\/|\+)\s*|\s+\/\s+/
  const pipeSeparator = /\s*\|\s*/

  // First, strip any topic prefix separated by pipe
  // "Finance Discussion | Craft <> Wealth.com" → "Craft <> Wealth.com"
  let workingTitle = title
  if (pipeSeparator.test(title) && partySeparator.test(title)) {
    // Has both pipe and party separator — pipe is probably a topic prefix
    const pipeIdx = title.indexOf('|')
    const partyIdx = Math.min(
      title.indexOf('<>') >= 0 ? title.indexOf('<>') : Infinity,
      title.indexOf('<->') >= 0 ? title.indexOf('<->') : Infinity,
      title.indexOf('//') >= 0 ? title.indexOf('//') : Infinity
    )
    if (pipeIdx < partyIdx) {
      workingTitle = title.slice(pipeIdx + 1).trim()
    }
  }

  const parties = workingTitle.split(partySeparator).map(p => p.trim()).filter(Boolean)

  if (parties.length >= 2) {
    // First pass: prefer the party that matches the domain root
    for (const party of parties) {
      if (isCraftParty(party)) continue
      const lower = party.toLowerCase()
      if (lower.includes(domainRoot) || lower.includes(domainRoot.replace(/^(go|get|join|meet|use|try)/, ''))) {
        const name = cleanPartyName(party, domainRoot)
        if (name) return name
      }
    }
    // Second pass: take first non-Craft party
    for (const party of parties) {
      if (isCraftParty(party)) continue
      const name = cleanPartyName(party, domainRoot)
      if (name) return name
    }
  }

  // Strategy 3: Look for "(CompanyName)" parenthetical patterns
  // "SiftMed (Holly) & CRAFT Ventures (Lainy)" → extract "SiftMed"
  // "Lainy (Craft) <> Apoorva (ChartR)" → extract "ChartR"
  const parenParts = [...title.matchAll(/(\S+(?:\s+\S+)*?)\s*\(([^)]+)\)/g)]
  for (const match of parenParts) {
    const beforeParen = match[1].trim()
    const insideParen = match[2].trim()

    // If inside parens is a Craft person or "Craft", this segment's company is beforeParen
    if (isCraftName(insideParen)) continue

    // If beforeParen is a Craft person, the company is insideParen
    if (isCraftName(beforeParen)) {
      if (!isCraftName(insideParen) && !isPersonName(insideParen)) {
        return insideParen
      }
      continue
    }

    // If insideParen looks like a person name and beforeParen looks like a company
    if (isPersonName(insideParen) && !isPersonName(beforeParen)) {
      return beforeParen
    }

    // If insideParen looks like a company name
    if (!isPersonName(insideParen) && !isCraftName(insideParen)) {
      return insideParen
    }
  }

  // Strategy 4: Single company with person in parens — "ClickUp (Jason)"
  const simpleParenMatch = workingTitle.match(/^(.+?)\s*\(([^)]+)\)\s*$/)
  if (simpleParenMatch) {
    const mainPart = simpleParenMatch[1].trim()
    const parenPart = simpleParenMatch[2].trim()
    if (isPersonName(parenPart) && !isCraftName(mainPart) && !isPersonName(mainPart)) {
      return mainPart
    }
  }

  // Strategy 5: Try pipe separator as party separator (if no <> or // found)
  if (parties.length < 2) {
    const pipeParts = workingTitle.split(pipeSeparator).map(p => p.trim()).filter(Boolean)
    if (pipeParts.length >= 2) {
      for (const part of pipeParts) {
        if (isCraftParty(part)) continue
        const name = cleanPartyName(part, domainRoot)
        if (name) return name
      }
    }
  }

  // Strategy 6: For titles like "meeting between X and Y", try to extract
  const meetingBetween = workingTitle.match(/meeting\s+(?:between|with)\s+(.+)/i)
  if (meetingBetween) {
    const rest = meetingBetween[1]
    const andParts = rest.split(/\s+and\s+/i).map(p => p.trim())
    for (const part of andParts) {
      if (isCraftParty(part)) continue
      const name = cleanPartyName(part, domainRoot)
      if (name) return name
    }
  }

  // Strategy 7: Fall back to domain-derived name
  return domainToCompanyName(prospectDomain)
}

/** Check if a party string refers to Craft */
function isCraftParty(party: string): boolean {
  const lower = party.toLowerCase()
  return (
    /craft\s*ventures?/i.test(party) ||
    /\bcraft\b/i.test(party) ||
    CRAFT_PEOPLE.has(lower) ||
    // "Lainy (Craft)" pattern
    /\(craft\)/i.test(party)
  )
}

/** Check if a string is a Craft-related name */
function isCraftName(s: string): boolean {
  const lower = s.toLowerCase().trim()
  return CRAFT_PEOPLE.has(lower) || /craft/i.test(lower)
}

/** Check if a string looks like a person's name (not a company) */
function isPersonName(s: string): boolean {
  const lower = s.toLowerCase().trim()
  // Already known Craft person
  if (CRAFT_PEOPLE.has(lower)) return true
  // Single word that's a common first name pattern (lowercase, short)
  if (!s.includes(' ') && s.length < 10 && /^[A-Z][a-z]+$/.test(s.trim())) return true
  // "FirstName LastName" pattern with no company indicators
  if (/^[A-Z][a-z]+ [A-Z][a-z]+$/.test(s.trim())) return true
  // Contains & or / between what look like names: "Shachar & Dan"
  if (/^[A-Z][a-z]+\s*[&\/]\s*[A-Z][a-z]+$/.test(s.trim())) return true
  return false
}

/** Clean a party string to extract the company name */
function cleanPartyName(party: string, domainRoot: string): string | null {
  let cleaned = party
    .replace(/\(Craft\)/gi, '')
    .replace(/Craft\s*Ventures?/gi, '')
    .replace(/\(Lainy\)/gi, '')
    .replace(/\(Kevin\)/gi, '')
    .trim()

  if (!cleaned || isCraftName(cleaned)) return null

  // Extract parenthetical company: "Apoorva (ChartR)" → "ChartR"
  const parenMatch = cleaned.match(/\(([^)]+)\)/)
  if (parenMatch) {
    const inside = parenMatch[1].trim()
    const before = cleaned.replace(/\s*\([^)]+\)/, '').trim()
    // If what's in parens matches domain root, use it
    if (inside.toLowerCase().includes(domainRoot)) return inside
    // If what's before parens looks like a person and inside looks like company
    if (isPersonName(before) && !isPersonName(inside)) return inside
    // If what's before looks like a company
    if (!isPersonName(before)) return before
    return inside
  }

  // If it's just a person name, skip
  if (isPersonName(cleaned)) return null

  // If it contains the domain root, likely the company
  if (cleaned.toLowerCase().includes(domainRoot)) return cleaned

  return cleaned
}

/** Convert a domain to a capitalized company name */
function domainToCompanyName(domain: string): string {
  const root = domain.split('.')[0]
  // Handle common patterns
  if (root.startsWith('go')) {
    // goartemis.ai → Artemis, getmeez.com → Meez
    return root.slice(2).charAt(0).toUpperCase() + root.slice(3)
  }
  if (root.startsWith('get')) {
    return root.slice(3).charAt(0).toUpperCase() + root.slice(4)
  }
  if (root.startsWith('join')) {
    return root.slice(4).charAt(0).toUpperCase() + root.slice(5)
  }
  if (root.startsWith('meet')) {
    return root.slice(4).charAt(0).toUpperCase() + root.slice(5)
  }
  if (root.startsWith('use')) {
    return root.slice(3).charAt(0).toUpperCase() + root.slice(4)
  }
  if (root.startsWith('try')) {
    return root.slice(3).charAt(0).toUpperCase() + root.slice(4)
  }
  return root.charAt(0).toUpperCase() + root.slice(1)
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Extract ALL external (non-skipped) attendee domains from a meeting
 */
function extractProspectAttendees(attendeesJson: string | null): { domain: string; name: string; email: string }[] {
  if (!attendeesJson) return []
  try {
    const attendees = JSON.parse(attendeesJson)
    if (!Array.isArray(attendees)) return []

    const results: { domain: string; name: string; email: string }[] = []
    const seenDomains = new Set<string>()

    for (const a of attendees) {
      const email = (a.email || '').toLowerCase()
      const atIdx = email.lastIndexOf('@')
      if (atIdx <= 0) continue

      const domain = email.slice(atIdx + 1).trim()
      if (!domain || SKIP_DOMAINS.has(domain)) continue
      if (seenDomains.has(domain)) continue
      seenDomains.add(domain)

      results.push({
        domain,
        name: a.name || email.split('@')[0],
        email,
      })
    }
    return results
  } catch {
    return []
  }
}

/**
 * Check if a domain belongs to a portfolio company
 */
function isPortfolioDomain(db: any, domain: string): boolean {
  // Check exact match and comma-separated domains — includes all portfolio relationships
  const companies = db.prepare(
    "SELECT id, domain, relationship FROM companies WHERE relationship IN ('board_seat', 'board_observer', 'portfolio')"
  ).all() as any[]

  for (const c of companies) {
    if (!c.domain) continue
    const domains = c.domain.split(',').map((d: string) => d.trim().toLowerCase())
    if (domains.includes(domain.toLowerCase())) return true
  }
  return false
}

/**
 * Scan recent meetings and auto-create deals for new prospect companies.
 */
export function detectNewDeals(): number {
  const db = getDb()
  let created = 0

  // Get recent meetings that aren't matched to portfolio companies
  const meetings = db.prepare(`
    SELECT m.id, m.title, m.date, m.attendees, m.company_id, c.relationship
    FROM meetings m
    LEFT JOIN companies c ON m.company_id = c.id
    WHERE m.date >= date('now', '-30 days')
    ORDER BY m.date ASC
  `).all() as any[]

  // Track domains we've already created deals for
  const processedDomains = new Set<string>()

  // Pre-populate with existing deal company domains
  const existingDeals = db.prepare(`
    SELECT c.domain FROM deals d
    JOIN companies c ON d.company_id = c.id
    WHERE c.domain IS NOT NULL
  `).all() as any[]
  for (const d of existingDeals) {
    if (d.domain) {
      d.domain.split(',').forEach((dom: string) => processedDomains.add(dom.trim().toLowerCase()))
    }
  }

  for (const meeting of meetings) {
    const title = meeting.title || ''

    // Skip non-prospect meetings by title
    if (SKIP_TITLE_PATTERNS.some(p => p.test(title))) continue

    // Skip if already matched to a portfolio company
    if (meeting.relationship === 'board_seat' || meeting.relationship === 'board_observer' || meeting.relationship === 'portfolio') continue

    // Extract ALL external attendees
    const prospects = extractProspectAttendees(meeting.attendees)
    if (prospects.length === 0) continue

    // Find the first prospect whose domain we haven't processed and isn't portfolio
    let prospect = null
    for (const p of prospects) {
      if (processedDomains.has(p.domain)) continue
      if (isPortfolioDomain(db, p.domain)) continue
      prospect = p
      break
    }
    if (!prospect) continue

    processedDomains.add(prospect.domain)

    // Check if a company already exists with this domain
    const existingCompany = findCompanyByDomain(db, prospect.domain)

    // If it's a portfolio company, skip
    if (existingCompany?.relationship === 'board_seat' || existingCompany?.relationship === 'board_observer' || existingCompany?.relationship === 'portfolio') {
      continue
    }

    // Check if deal already exists for this company
    if (existingCompany) {
      const existingDeal = db.prepare("SELECT id FROM deals WHERE company_id = ?").get(existingCompany.id) as any
      if (existingDeal) continue
    }

    // Determine company name
    const companyName = extractCompanyName(title, prospect.domain)

    // Skip if this matches an existing portfolio company by name
    // (catches portfolio companies even when domain isn't in our DB)
    if (isPortfolioCompanyName(companyName)) {
      console.log(`[DealDetector] Skipping portfolio company: ${companyName} — from "${title}"`)
      continue
    }

    let companyId = existingCompany?.id

    // Create company if needed
    if (!companyId) {
      companyId = companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

      // Check by ID too (might exist without domain)
      const existingById = db.prepare("SELECT id FROM companies WHERE id = ?").get(companyId) as any
      if (existingById) {
        // Update domain on existing company
        db.prepare("UPDATE companies SET domain = ? WHERE id = ? AND domain IS NULL").run(prospect.domain, companyId)
        companyId = existingById.id
      } else {
        db.prepare(
          "INSERT OR IGNORE INTO companies (id, name, relationship, domain) VALUES (?, ?, 'deal', ?)"
        ).run(companyId, companyName, prospect.domain)
        console.log(`[DealDetector] Created company: ${companyName} (${prospect.domain})`)
      }
    }

    // Check deal again after potential company resolution
    const existingDeal = db.prepare("SELECT id FROM deals WHERE company_id = ?").get(companyId) as any
    if (existingDeal) continue

    // Create the deal
    const dealId = uuid()
    db.prepare(`
      INSERT INTO deals (id, company_id, stage, category, source, contact_name, contact_email)
      VALUES (?, ?, 'first_meeting', 'first_meeting', 'meeting', ?, ?)
    `).run(dealId, companyId, prospect.name, prospect.email)

    // Also update the meeting's company_id if not set
    if (!meeting.company_id) {
      db.prepare("UPDATE meetings SET company_id = ? WHERE id = ?").run(companyId, meeting.id)
    }

    console.log(`[DealDetector] Created deal: ${companyName} (first_meeting) — from "${title}"`)
    created++
  }

  if (created > 0) {
    console.log(`[DealDetector] Created ${created} new deals from meetings`)
  }

  return created
}

/** Find a company by domain, handling comma-separated domains */
function findCompanyByDomain(db: any, domain: string): { id: string; relationship: string; domain: string } | null {
  // Try exact match on the full domain column first
  const exact = db.prepare(
    "SELECT id, relationship, domain FROM companies WHERE domain = ?"
  ).get(domain) as any
  if (exact) return exact

  // Try LIKE for comma-separated
  const like = db.prepare(
    "SELECT id, relationship, domain FROM companies WHERE domain LIKE ?"
  ).get(`%${domain}%`) as any
  if (like) {
    // Verify it's an actual match (not substring)
    const domains = like.domain.split(',').map((d: string) => d.trim().toLowerCase())
    if (domains.includes(domain.toLowerCase())) return like
  }

  return null
}
