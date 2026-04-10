/**
 * User Settings
 *
 * Reads user-specific configuration from environment variables (primary)
 * or the settings database (fallback). Set these in your .env file.
 */
import { getDb } from '../db/database'

function getSetting(key: string): string | null {
  try {
    const db = getDb()
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as any
    return row?.value || null
  } catch {
    return null
  }
}

/** Your first name, used in AI prompts. Set USER_NAME in .env */
export function getUserName(): string {
  return process.env.USER_NAME || getSetting('user_name') || 'the investor'
}

/** Your firm name, used in AI prompts. Set FIRM_NAME in .env */
export function getFirmName(): string {
  return process.env.FIRM_NAME || getSetting('firm_name') || 'the firm'
}

/**
 * Your firm's email domains (comma-separated). Used to filter your own
 * team out of contact lists and attendee lists. Set FIRM_DOMAINS in .env.
 * Example: FIRM_DOMAINS=acmecapital.com,acme.vc
 */
export function getFirmDomains(): string[] {
  const raw = process.env.FIRM_DOMAINS || getSetting('firm_domains') || ''
  return raw.split(',').map(d => d.trim().toLowerCase()).filter(Boolean)
}

/**
 * Your firm's team member names (comma-separated). Used to filter your
 * colleagues out of meeting title parsing. Set FIRM_PEOPLE in .env.
 * Example: FIRM_PEOPLE=alice,bob,carol,alice smith,bob jones
 */
export function getFirmPeople(): Set<string> {
  const raw = process.env.FIRM_PEOPLE || getSetting('firm_people') || ''
  const people = new Set<string>()
  for (const p of raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)) {
    people.add(p)
  }
  return people
}

/** Returns true if the email belongs to your firm */
export function isFirmEmail(email: string): boolean {
  const lower = email.toLowerCase()
  return getFirmDomains().some(d => lower.includes(d))
}
