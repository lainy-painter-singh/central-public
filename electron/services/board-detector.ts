/**
 * Board Meeting Detector
 *
 * Identifies board meetings from calendar events and synced meetings,
 * auto-creates board_prep records and relevant todos.
 *
 * Company matching priority:
 *   1. Existing company_id on the meeting/event record
 *   2. Attendee email domains → portfolio company domains
 *   3. Company name in meeting title
 */
import { getDb } from '../db/database'
import { v4 as uuid } from 'uuid'
import { SKIP_DOMAINS } from '../utils/skip-domains'

// Patterns that indicate a board meeting
const BOARD_PATTERNS = [
  /board\s*meeting/i,
  /board\s*of\s*directors/i,
  /board\s*call/i,
  /board\s*session/i,
  /board\s*review/i,
]

// Secondary patterns — only match if paired with a portfolio company
const BOARD_ADJACENT_PATTERNS = [
  /quarterly\s*(update|review|check|meeting)/i,
  /Q[1-4]\s*\d{4}/i,
  /board\s*prep/i,
  /board\s*deck/i,
  /board\s*pre-read/i,
]

function isBoardMeetingTitle(title: string): boolean {
  return BOARD_PATTERNS.some(p => p.test(title))
}

function isBoardAdjacentTitle(title: string): boolean {
  return BOARD_ADJACENT_PATTERNS.some(p => p.test(title))
}

interface PortfolioCompany {
  id: string
  name: string
  relationship: string
  domain: string | null
}

/**
 * Get all portfolio companies with their domains
 */
function getPortfolioCompanies(): PortfolioCompany[] {
  const db = getDb()
  return db.prepare(`
    SELECT id, name, relationship, domain
    FROM companies
    WHERE relationship IN ('board_seat', 'board_observer')
  `).all() as PortfolioCompany[]
}

/**
 * Build a domain → company lookup map
 * Supports comma-separated domains (e.g. "vooma.ai,vooma.com")
 */
function buildDomainMap(companies: PortfolioCompany[]): Map<string, PortfolioCompany> {
  const map = new Map<string, PortfolioCompany>()
  for (const c of companies) {
    if (c.domain) {
      for (const d of c.domain.split(',')) {
        const trimmed = d.trim().toLowerCase()
        if (trimmed) map.set(trimmed, c)
      }
    }
  }
  return map
}

/**
 * Extract email domains from a JSON attendees string, excluding common providers
 */
function extractAttendeeCompanyDomains(attendeesJson: string | null): string[] {
  if (!attendeesJson) return []
  try {
    const attendees = JSON.parse(attendeesJson)
    if (!Array.isArray(attendees)) return []
    const domains = new Set<string>()
    for (const a of attendees) {
      const email = a.email || a.name || ''
      const atIdx = email.lastIndexOf('@')
      if (atIdx > 0) {
        const domain = email.slice(atIdx + 1).toLowerCase().trim()
        if (domain && !SKIP_DOMAINS.has(domain)) {
          domains.add(domain)
        }
      }
    }
    return Array.from(domains)
  } catch {
    return []
  }
}

/**
 * Match a meeting/event to a portfolio company using multiple signals:
 *   1. Existing company_id
 *   2. Attendee email domains
 *   3. Company name in title
 */
function matchCompany(
  existingCompanyId: string | null,
  existingCompanyName: string | null,
  existingRelationship: string | null,
  title: string,
  attendeesJson: string | null,
  portfolioCompanies: PortfolioCompany[],
  domainMap: Map<string, PortfolioCompany>
): { companyId: string; companyName: string; relationship: string; method: string } | null {

  // Method 1: Already matched to a portfolio company
  if (existingCompanyId) {
    const pc = portfolioCompanies.find(c => c.id === existingCompanyId)
    if (pc) {
      return { companyId: pc.id, companyName: pc.name, relationship: pc.relationship, method: 'existing' }
    }
  }

  // Method 2: Match attendee email domains against portfolio company domains
  const domains = extractAttendeeCompanyDomains(attendeesJson)
  for (const domain of domains) {
    const match = domainMap.get(domain)
    if (match) {
      return { companyId: match.id, companyName: match.name, relationship: match.relationship, method: 'attendee-email' }
    }
  }

  // Method 3: Company name appears in the meeting title
  const titleLower = title.toLowerCase()
  for (const c of portfolioCompanies) {
    // Match full name or key part (handle "ConverseNow Technologies" matching "ConverseNow")
    const nameLower = c.name.toLowerCase()
    if (titleLower.includes(nameLower)) {
      return { companyId: c.id, companyName: c.name, relationship: c.relationship, method: 'title' }
    }
    // Also try first word if name has multiple words (e.g., "Greenlite" from "Greenlite Technologies")
    const firstName = nameLower.split(/[\s(]+/)[0]
    if (firstName.length >= 4 && titleLower.includes(firstName)) {
      return { companyId: c.id, companyName: c.name, relationship: c.relationship, method: 'title' }
    }
  }

  return null
}

function boardPrepExists(companyId: string, meetingDate: string): boolean {
  const db = getDb()
  return !!db.prepare(`SELECT id FROM board_prep WHERE company_id = ? AND meeting_date = ?`).get(companyId, meetingDate)
}

function todoExists(companyId: string, type: string, meetingDate: string): boolean {
  const db = getDb()
  return !!db.prepare(`SELECT id FROM todos WHERE company_id = ? AND type = ? AND deadline = ? AND status = 'open'`).get(companyId, type, meetingDate)
}

function createBoardPrep(companyId: string, meetingDate: string): string {
  const db = getDb()
  const id = uuid()
  db.prepare(`INSERT INTO board_prep (id, company_id, meeting_date, questions) VALUES (?, ?, ?, '[]')`).run(id, companyId, meetingDate)
  console.log(`[BoardDetector] Created board_prep for ${companyId} on ${meetingDate}`)
  return id
}

function createBoardGluePostTodo(companyId: string, companyName: string, meetingDate: string, meetingTitle: string) {
  const db = getDb()
  const id = uuid()
  db.prepare(`
    INSERT INTO todos (id, title, company_id, type, priority, status, source, source_meeting_title, deadline, context)
    VALUES (?, ?, ?, 'glue_post', 'high', 'open', 'auto', ?, ?, ?)
  `).run(id, `Post Board Summary to Glue for ${companyName}`, companyId, meetingTitle, meetingDate,
    `Auto-created from board meeting: ${meetingTitle}`)
  console.log(`[BoardDetector] Created board glue_post todo for ${companyName}`)
}

/**
 * Process a detected board meeting: create board_prep + todos if they don't already exist
 */
function processDetectedBoardMeeting(
  companyId: string,
  companyName: string,
  meetingDate: string,
  meetingTitle: string,
  matchMethod: string
): boolean {
  if (!meetingDate) return false
  const dateOnly = meetingDate.split('T')[0]

  if (boardPrepExists(companyId, dateOnly)) return false

  console.log(`[BoardDetector] Detected board meeting: "${meetingTitle}" → ${companyName} (matched via ${matchMethod})`)
  createBoardPrep(companyId, dateOnly)
  if (!todoExists(companyId, 'glue_post', dateOnly)) {
    createBoardGluePostTodo(companyId, companyName, dateOnly, meetingTitle)
  }
  return true
}

/**
 * Scan synced meetings for board meetings
 */
export function detectBoardMeetingsFromMeetings(): number {
  const db = getDb()
  const portfolioCompanies = getPortfolioCompanies()
  const domainMap = buildDomainMap(portfolioCompanies)
  let detected = 0

  const meetings = db.prepare(`
    SELECT m.id, m.title, m.date, m.attendees, m.company_id, c.name as company_name, c.relationship
    FROM meetings m
    LEFT JOIN companies c ON m.company_id = c.id
    WHERE m.date >= date('now', '-90 days')
    ORDER BY m.date DESC
  `).all() as any[]

  for (const meeting of meetings) {
    if (!meeting.title) continue

    const isBoardTitle = isBoardMeetingTitle(meeting.title)
    const isBoardAdjacent = isBoardAdjacentTitle(meeting.title)

    if (!isBoardTitle && !isBoardAdjacent) continue

    // Try to match company using all available signals
    const match = matchCompany(
      meeting.company_id,
      meeting.company_name,
      meeting.relationship,
      meeting.title,
      meeting.attendees,
      portfolioCompanies,
      domainMap
    )

    if (!match) continue
    if (match.relationship !== 'board_seat' && match.relationship !== 'board_observer') continue

    // For board-adjacent titles, only proceed if we positively matched a portfolio company
    // For explicit board titles, always proceed
    if (!isBoardTitle && isBoardAdjacent) {
      // Board-adjacent needs a confirmed portfolio match — already guaranteed by matchCompany
    }

    if (processDetectedBoardMeeting(match.companyId, match.companyName, meeting.date, meeting.title, match.method)) {
      // Also update the meeting's company_id if it wasn't set
      if (!meeting.company_id) {
        db.prepare('UPDATE meetings SET company_id = ? WHERE id = ?').run(match.companyId, meeting.id)
      }
      detected++
    }
  }

  return detected
}

/**
 * Scan calendar events for upcoming board meetings
 */
export function detectBoardMeetingsFromCalendar(): number {
  const db = getDb()
  const portfolioCompanies = getPortfolioCompanies()
  const domainMap = buildDomainMap(portfolioCompanies)
  let detected = 0

  // Look at today + next 30 days, plus past 7 days (catch recent ones)
  const events = db.prepare(`
    SELECT ce.id, ce.title, ce.date, ce.start_time, ce.attendees, ce.company_id
    FROM calendar_events ce
    WHERE ce.date >= date('now', '-7 days') AND ce.date <= date('now', '+30 days')
    ORDER BY ce.date ASC
  `).all() as any[]

  for (const event of events) {
    if (!event.title) continue

    const isBoardTitle = isBoardMeetingTitle(event.title)
    const isBoardAdjacent = isBoardAdjacentTitle(event.title)

    if (!isBoardTitle && !isBoardAdjacent) continue

    const match = matchCompany(
      event.company_id,
      null,
      null,
      event.title,
      event.attendees,
      portfolioCompanies,
      domainMap
    )

    if (!match) continue
    if (match.relationship !== 'board_seat' && match.relationship !== 'board_observer') continue

    if (processDetectedBoardMeeting(match.companyId, match.companyName, event.date, event.title, match.method)) {
      // Also update the calendar event's company_id if it wasn't set
      if (!event.company_id) {
        db.prepare('UPDATE calendar_events SET company_id = ? WHERE id = ?').run(match.companyId, event.id)
      }
      detected++
    }
  }

  return detected
}

/**
 * Create "post to Glue" todos for active diligence deals that don't have one
 */
export function createGlueTodosForActiveDeals(): number {
  const db = getDb()
  let created = 0

  const activeDeals = db.prepare(`
    SELECT d.id, d.company_id, c.name as company_name
    FROM deals d
    JOIN companies c ON d.company_id = c.id
    WHERE d.category = 'active_diligence'
  `).all() as any[]

  for (const deal of activeDeals) {
    const existing = db.prepare(`
      SELECT id FROM todos WHERE company_id = ? AND type = 'glue_post' AND status = 'open'
    `).get(deal.company_id)

    if (!existing) {
      const id = uuid()
      db.prepare(`
        INSERT INTO todos (id, title, company_id, type, priority, status, source, context)
        VALUES (?, ?, ?, 'glue_post', 'medium', 'open', 'auto', ?)
      `).run(id, `Post ${deal.company_name} update to Glue`, deal.company_id,
        `Active diligence deal — share update with the team on Glue`)
      created++
    }
  }

  if (created > 0) {
    console.log(`[BoardDetector] Created ${created} glue_post todos for active diligence deals`)
  }
  return created
}

/**
 * Run all board detection scans
 */
export function runBoardDetection(): { meetings: number; calendar: number; glueDeals: number } {
  const meetings = detectBoardMeetingsFromMeetings()
  const calendar = detectBoardMeetingsFromCalendar()
  const glueDeals = createGlueTodosForActiveDeals()

  if (meetings + calendar + glueDeals > 0) {
    console.log(`[BoardDetector] Detected: ${meetings} from meetings, ${calendar} from calendar, ${glueDeals} glue todos for deals`)
  }

  return { meetings, calendar, glueDeals }
}
