/**
 * Obsidian Vault Reader
 *
 * Reads meeting files from the Obsidian vault and the Granola archivist output.
 * These are the primary source of meeting content for deal overviews.
 */
import fs from 'fs'
import path from 'path'
import os from 'os'
import { getDb } from '../db/database'

export interface VaultMeeting {
  title: string
  date: string
  source: string
  company?: string
  content: string  // Full meeting content (notes, summary, transcript)
  filePath: string
}

const DEFAULT_VAULT_PATH = path.join(os.homedir(), 'Documents', 'Central Vault', 'Meetings')
const GRANOLA_OUTPUT_PATH = path.join(os.homedir(), '.granola-archivist', 'output')

function getVaultPath(): string {
  try {
    const db = getDb()
    const row = db.prepare("SELECT value FROM settings WHERE key = 'obsidian_vault_path'").get() as any
    if (row?.value) return path.join(row.value, 'Meetings')
  } catch { /* use default */ }
  return DEFAULT_VAULT_PATH
}

function getSearchTerms(companyName: string): string[] {
  const full = companyName.toLowerCase().trim()
  const terms = [full]
  const genericWords = ['health', 'labs', 'care', 'tech', 'technologies', 'inc', 'ai', 'io', 'app',
    'the', 'and', 'for', 'flow', 'ventures', 'capital', 'partners', 'group', 'digital',
    'solutions', 'services', 'systems', 'global', 'data', 'cloud', 'software', 'platform']
  const words = full.split(/[\s\-_]+/).filter(w => w.length >= 3)
  if (words.length > 1) {
    // Add only non-generic significant words
    for (const w of words) {
      if (w.length >= 4 && !terms.includes(w) && !genericWords.includes(w)) {
        terms.push(w)
      }
    }
  }
  return terms
}

/**
 * Parse YAML frontmatter from a markdown file.
 */
function parseFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!match) return { frontmatter: {}, body: content }

  const frontmatter: Record<string, string> = {}
  for (const line of match[1].split('\n')) {
    const kv = line.match(/^(\w+):\s*(.+)/)
    if (kv) {
      frontmatter[kv[1]] = kv[2].replace(/^"?\[\[/, '').replace(/\]\]"?$/, '').replace(/^"/, '').replace(/"$/, '')
    }
  }
  return { frontmatter, body: match[2] }
}

/**
 * Find all vault meeting files matching a company name.
 * Searches Obsidian vault + Granola archivist output.
 * Matches by: filename, frontmatter company, OR first 2000 chars of content body.
 */
export function findVaultMeetings(companyName: string): VaultMeeting[] {
  const searchTerms = getSearchTerms(companyName)
  const results: VaultMeeting[] = []
  const seen = new Set<string>()

  const dirs = [getVaultPath(), GRANOLA_OUTPUT_PATH]

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue

    let files: string[]
    try {
      files = fs.readdirSync(dir).filter(f => f.endsWith('.md'))
    } catch {
      continue
    }

    for (const file of files) {
      if (seen.has(file)) continue

      const filenameLower = file.toLowerCase()
      const filenameMatches = searchTerms.some(term => filenameLower.includes(term))

      const filePath = path.join(dir, file)
      let raw: string
      try {
        raw = fs.readFileSync(filePath, 'utf-8')
      } catch {
        continue
      }

      const { frontmatter, body } = parseFrontmatter(raw)

      // Check frontmatter company field
      const fmCompany = (frontmatter.company || '').toLowerCase()
      const companyMatch = searchTerms.some(term => fmCompany.includes(term))

      // If no filename or frontmatter match, check first 2000 chars of body
      // This catches files like "Alice (Acme) <> Marcus (Wispr)"
      let contentMatch = false
      if (!filenameMatches && !companyMatch) {
        const snippet = body.slice(0, 2000).toLowerCase()
        contentMatch = searchTerms.some(term => snippet.includes(term))
      }

      if (!filenameMatches && !companyMatch && !contentMatch) continue

      seen.add(file)

      // Extract content from ## sections
      const contentLines = body.split('\n')
      const contentStart = contentLines.findIndex(l => l.startsWith('## '))
      const content = contentStart >= 0
        ? contentLines.slice(contentStart).join('\n')
        : body

      // Skip files with very little content
      if (content.trim().length < 50) continue

      const date = frontmatter.date || file.slice(0, 10)
      const titleMatch = body.match(/^#\s+(.+)/m)
      const title = titleMatch ? titleMatch[1] : file.replace('.md', '')

      results.push({
        title,
        date,
        source: frontmatter.source || 'vault',
        company: frontmatter.company,
        content: content.trim(),
        filePath,
      })
    }
  }

  return results.sort((a, b) => b.date.localeCompare(a.date))
}

/**
 * Get the combined content of all vault meetings for a company.
 * Returns formatted text suitable for LLM analysis.
 */
export function getVaultMeetingContent(companyName: string): { content: string; count: number } {
  const meetings = findVaultMeetings(companyName)

  if (meetings.length === 0) {
    return { content: '', count: 0 }
  }

  const combined = meetings.map(m =>
    `--- Meeting: ${m.title} (${m.date}, ${m.source}) ---\n${m.content}`
  ).join('\n\n')

  return { content: combined, count: meetings.length }
}
