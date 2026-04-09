/**
 * Markdown Exporter
 *
 * Exports meetings from the DB as Obsidian-compatible markdown files.
 * Each meeting becomes a note with YAML frontmatter, wikilinks to companies,
 * and tagged by source.
 *
 * Default vault path: ~/Documents/Central Vault/
 */
import fs from 'fs'
import path from 'path'
import os from 'os'
import { getDb } from '../db/database'

const DEFAULT_VAULT_PATH = path.join(os.homedir(), 'Documents', 'Central Vault')
const MEETINGS_DIR = 'Meetings'

function getVaultPath(): string {
  const db = getDb()
  const row = db.prepare("SELECT value FROM settings WHERE key = 'obsidian_vault_path'").get() as any
  return row?.value || DEFAULT_VAULT_PATH
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function sanitizeFilename(name: string): string {
  return name
    .replace(/[/\\:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
}

interface MeetingRow {
  id: string
  source: string
  title: string
  date: string
  attendees: string // JSON
  company_id: string | null
  summary: string | null
  transcript: string | null
  company_name?: string | null
}

function meetingToMarkdown(meeting: MeetingRow): string {
  const attendees = parseAttendees(meeting.attendees)
  const attendeeNames = attendees.map(a => a.name).filter(Boolean)
  const attendeeEmails = attendees.map(a => a.email).filter(Boolean)

  // YAML frontmatter
  const lines: string[] = ['---']
  lines.push(`date: ${meeting.date || 'unknown'}`)
  lines.push(`source: ${meeting.source}`)
  if (meeting.company_name) {
    lines.push(`company: "[[${meeting.company_name}]]"`)
  }
  if (attendeeNames.length > 0) {
    lines.push(`attendees:`)
    for (const name of attendeeNames) {
      lines.push(`  - "${name}"`)
    }
  }
  lines.push(`tags:`)
  lines.push(`  - meeting/${meeting.source}`)
  if (meeting.company_name) {
    lines.push(`  - company/${sanitizeTag(meeting.company_name)}`)
  }
  lines.push(`id: ${meeting.id}`)
  lines.push('---')
  lines.push('')

  // Title
  lines.push(`# ${meeting.title || 'Untitled Meeting'}`)
  lines.push('')

  // Metadata block
  if (meeting.date) {
    lines.push(`**Date:** ${meeting.date}`)
  }
  if (meeting.company_name) {
    lines.push(`**Company:** [[${meeting.company_name}]]`)
  }
  if (attendeeNames.length > 0) {
    lines.push(`**Attendees:** ${attendeeNames.join(', ')}`)
  }
  lines.push('')

  // Summary
  if (meeting.summary) {
    lines.push('## Summary')
    lines.push('')
    lines.push(meeting.summary)
    lines.push('')
  }

  // Transcript
  if (meeting.transcript) {
    lines.push('## Transcript')
    lines.push('')
    lines.push(meeting.transcript)
    lines.push('')
  }

  return lines.join('\n')
}

function parseAttendees(json: string): Array<{ name: string; email?: string }> {
  try {
    return JSON.parse(json || '[]')
  } catch {
    return []
  }
}

function sanitizeTag(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-')
}

/**
 * Export a single meeting to the Obsidian vault.
 * Returns the file path written.
 */
export function exportMeeting(meeting: MeetingRow): string {
  const vaultPath = getVaultPath()
  const meetingsDir = path.join(vaultPath, MEETINGS_DIR)
  ensureDir(meetingsDir)

  const datePrefix = meeting.date || 'undated'
  const titleSlug = sanitizeFilename(meeting.title || 'Untitled')
  const filename = `${datePrefix} ${titleSlug}.md`
  const filePath = path.join(meetingsDir, filename)

  const markdown = meetingToMarkdown(meeting)
  fs.writeFileSync(filePath, markdown, 'utf-8')

  return filePath
}

/**
 * Export all meetings that have been synced since the last export,
 * or all meetings if force=true.
 * Returns the number of files written.
 */
export function exportAllMeetings(force: boolean = false): number {
  const db = getDb()
  const vaultPath = getVaultPath()
  const meetingsDir = path.join(vaultPath, MEETINGS_DIR)
  ensureDir(meetingsDir)

  // Get all meetings with company names (include all, even without summary/transcript)
  const meetings = db.prepare(`
    SELECT m.*, c.name as company_name
    FROM meetings m
    LEFT JOIN companies c ON m.company_id = c.id
    ORDER BY m.date DESC
  `).all() as MeetingRow[]

  let count = 0
  for (const meeting of meetings) {
    const datePrefix = meeting.date || 'undated'
    const titleSlug = sanitizeFilename(meeting.title || 'Untitled')
    const filename = `${datePrefix} ${titleSlug}.md`
    const filePath = path.join(meetingsDir, filename)

    // Skip if file exists and not forcing (avoid rewriting unchanged notes)
    if (!force && fs.existsSync(filePath)) continue

    const markdown = meetingToMarkdown(meeting)
    fs.writeFileSync(filePath, markdown, 'utf-8')
    count++
  }

  console.log(`[Obsidian] Exported ${count} meetings to ${meetingsDir}`)
  return count
}

/**
 * Export recently synced meetings (call after each sync).
 * Looks at meetings from the last N days and writes/overwrites them.
 */
export function exportRecentMeetings(daysBack: number = 90): number {
  const db = getDb()
  const vaultPath = getVaultPath()
  const meetingsDir = path.join(vaultPath, MEETINGS_DIR)
  ensureDir(meetingsDir)

  const meetings = db.prepare(`
    SELECT m.*, c.name as company_name
    FROM meetings m
    LEFT JOIN companies c ON m.company_id = c.id
    WHERE m.date >= date('now', '-' || ? || ' days')
    ORDER BY m.date DESC
  `).all(daysBack) as MeetingRow[]

  let count = 0
  for (const meeting of meetings) {
    const datePrefix = meeting.date || 'undated'
    const titleSlug = sanitizeFilename(meeting.title || 'Untitled')
    const filename = `${datePrefix} ${titleSlug}.md`
    const filePath = path.join(meetingsDir, filename)

    const markdown = meetingToMarkdown(meeting)
    fs.writeFileSync(filePath, markdown, 'utf-8')
    count++
  }

  console.log(`[Obsidian] Exported ${count} recent meetings to ${meetingsDir}`)
  return count
}
