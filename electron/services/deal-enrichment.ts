/**
 * Deal Enrichment Service
 *
 * When a deal is created, automatically:
 * 1. Search calendar events for attendees matching the company
 * 2. Search meetings (Granola/Fellow) for related call notes
 * 3. Search Gmail for email threads with the founder
 * 4. Populate contact info and link meetings to the deal
 */
import { google } from 'googleapis'
import { getDb } from '../db/database'
import { getAuthenticatedClient, isGoogleConnected } from './google-auth'
import { findVaultMeetings } from './vault-reader'
import fs from 'fs'
import path from 'path'
import os from 'os'

interface Contact {
  name: string
  email: string
  role?: string
}

interface LinkedMeeting {
  id: string
  title: string
  date: string
  source: string
  summary?: string
}

interface EnrichmentResult {
  contacts: Contact[]
  meetings: LinkedMeeting[]
  emailThreadCount: number
  contactName?: string
  contactEmail?: string
}

/**
 * Enrich a deal with contact info, meetings, and email context.
 * Called after deal creation.
 */
export async function enrichDeal(companyId: string, companyName: string): Promise<EnrichmentResult> {
  const result: EnrichmentResult = {
    contacts: [],
    meetings: [],
    emailThreadCount: 0,
  }

  // 1. Find contacts from calendar events
  const calendarContacts = findContactsFromCalendar(companyName)
  result.contacts.push(...calendarContacts)

  // 2. Find contacts from meeting attendees
  const meetingContacts = findContactsFromMeetings(companyName)
  for (const mc of meetingContacts) {
    if (!result.contacts.some(c => c.email === mc.email)) {
      result.contacts.push(mc)
    }
  }

  // 3. Find related meetings
  result.meetings = findRelatedMeetings(companyId, companyName)

  // 4. Search Gmail for email threads (if Google connected)
  if (isGoogleConnected()) {
    try {
      const gmailResult = await searchGmailForCompany(companyName, result.contacts)
      result.emailThreadCount = gmailResult.threadCount
      // Add any new contacts found in email
      for (const ec of gmailResult.contacts) {
        if (!result.contacts.some(c => c.email === ec.email)) {
          result.contacts.push(ec)
        }
      }
    } catch (err) {
      console.error('[Enrichment] Gmail search failed:', err)
    }
  }

  // Filter out noise: newsletters, service emails, etc.
  result.contacts = result.contacts.filter(c => !isNoiseEmail(c.email))

  // Clean up names that are just email addresses
  for (const c of result.contacts) {
    if (c.name === c.email || c.name.includes('@')) {
      c.name = c.email.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
    }
  }

  // Pick the best primary contact (first non-craft email found)
  const primaryContact = result.contacts.find(c =>
    c.email && !c.email.includes('craftventures.com') && !c.email.includes('craft.co')
  )
  if (primaryContact) {
    result.contactName = primaryContact.name
    result.contactEmail = primaryContact.email
  }

  // 5. Update the company contacts field and link meetings
  const db = getDb()
  if (result.contacts.length > 0) {
    db.prepare('UPDATE companies SET contacts = ? WHERE id = ?')
      .run(JSON.stringify(result.contacts), companyId)
  }

  // Link meetings to this company if they aren't already
  for (const meeting of result.meetings) {
    db.prepare('UPDATE meetings SET company_id = ? WHERE id = ? AND company_id IS NULL')
      .run(companyId, meeting.id)
  }

  console.log(`[Enrichment] ${companyName}: ${result.contacts.length} contacts, ${result.meetings.length} meetings, ${result.emailThreadCount} email threads`)
  return result
}

/**
 * Get search terms for a company name.
 * "Rely Health" → ["rely health", "rely"]
 * "ScrapChef" → ["scrapchef"]
 * "Circuit Mind" → ["circuit mind", "circuit"]
 * Filters out generic short words.
 */
/** Filter out newsletters, service emails, and other noise */
const NOISE_DOMAINS = [
  'substack.com', 'beehiiv.com', 'mail.beehiiv.com',
  'superhuman.com', 'vimcal.com', 'calendly.com', 'clockwise.com',
  'zoom.us', 'zoom.com', 'google.com', 'gmail.com',
  'tegus.com', 'alphasights.com', 'glg.com', 'thirdbridge.com',
  'affinity.co', 'notion.so', 'slack.com', 'linear.app',
  'axios.com', 'theinformation.com', 'politico.com', 'strictlyvc.com',
  'noreply', 'no-reply', 'notifications', 'updates', 'reminder', 'metrics',
  'donotreply', 'mailer-daemon',
]

function isNoiseEmail(email: string): boolean {
  if (!email) return true
  const domain = email.split('@')[1]?.toLowerCase() || ''
  const local = email.split('@')[0]?.toLowerCase() || ''
  if (NOISE_DOMAINS.some(d => domain.includes(d))) return true
  if (['noreply', 'no-reply', 'notifications', 'updates', 'reminder', 'metrics', 'internal-noreply', 'hello', 'info', 'support'].includes(local)) return true
  return false
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
 * Search calendar events for attendees associated with a company.
 */
function findContactsFromCalendar(companyName: string): Contact[] {
  const db = getDb()
  const contacts: Contact[] = []
  const searchTerms = getSearchTerms(companyName)

  // Search calendar events by title containing company name or its parts
  // Also search by attendee email domain matching the company
  const allEvents: Array<{ attendees: string; title: string }> = []
  for (const term of searchTerms) {
    const events = db.prepare(`
      SELECT attendees, title FROM calendar_events
      WHERE LOWER(title) LIKE '%' || ? || '%'
      ORDER BY start_time DESC LIMIT 20
    `).all(term) as Array<{ attendees: string; title: string }>
    for (const e of events) {
      if (!allEvents.some(x => x.title === e.title)) allEvents.push(e)
    }
  }
  const events = allEvents

  for (const event of events) {
    try {
      const attendees = JSON.parse(event.attendees || '[]')
      for (const a of attendees) {
        if (!a.email) continue
        // Skip our own domain and common service emails
        if (a.email.includes('craftventures.com') || a.email.includes('craft.co')) continue
        if (a.email.includes('calendar.google.com') || a.email.includes('resource.calendar')) continue
        if (!contacts.some(c => c.email === a.email)) {
          contacts.push({
            name: a.name || a.displayName || a.email.split('@')[0],
            email: a.email,
          })
        }
      }
    } catch { /* skip parse errors */ }
  }

  return contacts
}

/**
 * Search meeting attendees for contacts associated with a company.
 */
function findContactsFromMeetings(companyName: string): Contact[] {
  const db = getDb()
  const contacts: Contact[] = []
  const searchTerms = getSearchTerms(companyName)

  const allMeetings: Array<{ attendees: string; title: string }> = []
  for (const term of searchTerms) {
    const results = db.prepare(`
      SELECT attendees, title FROM meetings
      WHERE LOWER(title) LIKE '%' || ? || '%'
      ORDER BY date DESC LIMIT 20
    `).all(term) as Array<{ attendees: string; title: string }>
    for (const m of results) {
      if (!allMeetings.some(x => x.title === m.title)) allMeetings.push(m)
    }
  }
  const meetings = allMeetings

  for (const meeting of meetings) {
    try {
      const attendees = JSON.parse(meeting.attendees || '[]')
      for (const a of attendees) {
        const email = a.email
        if (!email) continue
        if (email.includes('craftventures.com') || email.includes('craft.co')) continue
        if (!contacts.some(c => c.email === email)) {
          contacts.push({
            name: a.name || email.split('@')[0],
            email,
          })
        }
      }
    } catch { /* skip */ }
  }

  return contacts
}

/**
 * Find meetings related to a company by company_id or title match.
 */
function findRelatedMeetings(companyId: string, companyName: string): LinkedMeeting[] {
  const db = getDb()
  const searchTerms = getSearchTerms(companyName)

  const all: LinkedMeeting[] = []

  // First get by company_id
  const byId = db.prepare(`
    SELECT DISTINCT id, title, date, source, summary
    FROM meetings WHERE company_id = ?
    ORDER BY date DESC LIMIT 30
  `).all(companyId) as LinkedMeeting[]
  all.push(...byId)

  // Then search by each term
  for (const term of searchTerms) {
    const results = db.prepare(`
      SELECT DISTINCT id, title, date, source, summary
      FROM meetings WHERE LOWER(title) LIKE '%' || ? || '%'
      ORDER BY date DESC LIMIT 20
    `).all(term) as LinkedMeeting[]
    for (const m of results) {
      if (!all.some(x => x.id === m.id)) all.push(m)
    }
  }

  // Also include vault meeting files (Obsidian markdown files)
  const vaultMeetings = findVaultMeetings(companyName)
  for (const vm of vaultMeetings) {
    if (!all.some(x => x.title === vm.title && x.date === vm.date)) {
      all.push({
        id: `vault-${vm.date}-${vm.title.slice(0, 30)}`,
        title: vm.title,
        date: vm.date,
        source: vm.source || 'vault',
        summary: vm.content.slice(0, 500),
      })
    }
  }

  return all.sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 30)
}

/**
 * Search Gmail for email threads with the company or its contacts.
 */
async function searchGmailForCompany(
  companyName: string,
  knownContacts: Contact[]
): Promise<{ threadCount: number; contacts: Contact[] }> {
  const auth = await getAuthenticatedClient()
  const gmail = google.gmail({ version: 'v1', auth })
  const contacts: Contact[] = []

  // Build search query from known contact emails only (company name is too broad and matches newsletters)
  const contactEmails = knownContacts.filter(c => c.email && !isNoiseEmail(c.email)).slice(0, 5)
  if (contactEmails.length === 0) {
    // If no contacts known yet, search by company name in from/to fields
    return { threadCount: 0, contacts: [] }
  }
  const query = contactEmails.map(c => `from:${c.email} OR to:${c.email}`).join(' OR ')

  try {
    const response = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: 20,
    })

    const messages = response.data.messages || []

    // Extract contacts from message headers
    for (const msg of messages.slice(0, 10)) {
      try {
        const detail = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id!,
          format: 'metadata',
          metadataHeaders: ['From', 'To'],
        })

        const headers = detail.data.payload?.headers || []
        for (const header of headers) {
          if (header.name === 'From' || header.name === 'To') {
            const parsed = parseEmailHeader(header.value || '')
            for (const p of parsed) {
              if (!p.email) continue
              if (p.email.includes('craftventures.com') || p.email.includes('craft.co')) continue
              if (!contacts.some(c => c.email === p.email) &&
                  !knownContacts.some(c => c.email === p.email)) {
                contacts.push(p)
              }
            }
          }
        }
      } catch { /* skip individual message errors */ }
    }

    return { threadCount: messages.length, contacts }
  } catch (err) {
    console.error('[Enrichment] Gmail search error:', err)
    return { threadCount: 0, contacts: [] }
  }
}

/**
 * Parse email header value like "Name <email@domain.com>, Other <other@domain.com>"
 */
function parseEmailHeader(value: string): Contact[] {
  const contacts: Contact[] = []
  const parts = value.split(',')
  for (const part of parts) {
    const match = part.match(/(?:"?([^"<]*)"?\s*)?<?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})>?/)
    if (match) {
      contacts.push({
        name: (match[1] || '').trim() || match[2].split('@')[0],
        email: match[2].toLowerCase(),
      })
    }
  }
  return contacts
}

/**
 * Get linked meetings for a deal (for displaying in DealDetailPanel).
 */
export function getLinkedMeetings(companyId: string, companyName: string): LinkedMeeting[] {
  return findRelatedMeetings(companyId, companyName)
}

/**
 * Get contacts for a company.
 */
export function getCompanyContacts(companyId: string): Contact[] {
  const db = getDb()
  const row = db.prepare('SELECT contacts FROM companies WHERE id = ?').get(companyId) as any
  try {
    return JSON.parse(row?.contacts || '[]')
  } catch {
    return []
  }
}
