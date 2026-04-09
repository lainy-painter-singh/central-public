#!/usr/bin/env node
/**
 * Standalone meeting sync script — runs outside Electron.
 * Syncs Granola (from cache + markdown files) and Fellow (from API) into the central DB.
 *
 * Usage: node scripts/sync-meetings.mjs
 */

import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'
import os from 'os'

const DB_PATH = path.join(os.homedir(), 'Library', 'Application Support', 'central', 'central.db')
const GRANOLA_CACHE_PATH = path.join(os.homedir(), 'Library', 'Application Support', 'Granola', 'cache-v4.json')
const GRANOLA_OUTPUT_DIR = path.join(os.homedir(), '.granola-archivist', 'output')

// ─── Database ───────────────────────────────────────────────────

function openDb() {
  if (!fs.existsSync(DB_PATH)) {
    console.error(`[DB] Database not found at ${DB_PATH}`)
    process.exit(1)
  }
  const db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  return db
}

// ─── Company matching ───────────────────────────────────────────

function loadCompanies(db) {
  return db.prepare('SELECT id, name, domain FROM companies').all()
}

function matchCompany(companies, attendeeEmails, title) {
  // Skip internal Craft domains
  const skipDomains = new Set([
    'craftventures.com', 'gmail.com', 'google.com', 'outlook.com',
    'hotmail.com', 'yahoo.com', 'icloud.com', 'me.com',
    'resource.calendar.google.com',
  ])

  for (const email of attendeeEmails) {
    const domain = email.split('@')[1]?.toLowerCase()
    if (!domain || skipDomains.has(domain)) continue

    const match = companies.find(c => c.domain && c.domain.toLowerCase() === domain)
    if (match) return match
  }

  // Fallback: fuzzy title match
  if (title) {
    const titleLower = title.toLowerCase()
    const match = companies.find(c =>
      c.name && titleLower.includes(c.name.toLowerCase())
    )
    if (match) return match
  }

  return null
}

// ─── Granola sync ───────────────────────────────────────────────

function syncGranola(db, companies, daysBack = 90) {
  console.log('\n── Syncing Granola ──')
  let meetings = []

  // 1. Read from Granola cache
  if (fs.existsSync(GRANOLA_CACHE_PATH)) {
    try {
      const raw = fs.readFileSync(GRANOLA_CACHE_PATH, 'utf-8')
      const cacheData = JSON.parse(raw)

      // The cache structure: { cache: "{\"state\": {...}}" } — nested JSON string
      let state
      if (cacheData.cache) {
        const inner = typeof cacheData.cache === 'string'
          ? JSON.parse(cacheData.cache)
          : cacheData.cache
        state = inner.state || inner
      } else if (cacheData.state) {
        state = cacheData.state
      } else {
        state = cacheData
      }

      const documents = state.documents || {}
      const documentPanels = state.documentPanels || {}

      for (const [docId, doc] of Object.entries(documents)) {
        const createdAt = doc.created_at
        if (!createdAt) continue

        // Extract attendees from google_calendar_event
        const calEvent = doc.google_calendar_event || {}
        const attendees = (calEvent.attendees || [])
          .filter(a => a.email && !a.self)
          .map(a => ({ name: a.email?.split('@')[0] || '', email: a.email }))

        // Extract AI summary from documentPanels
        let aiSummary = ''
        const panels = documentPanels[docId] || {}
        for (const panel of Object.values(panels)) {
          if (panel.title === 'Summary' && panel.content) {
            aiSummary = extractTextFromRichContent(panel.content)
          }
        }

        meetings.push({
          id: docId,
          title: doc.title || 'Untitled',
          created_at: createdAt,
          participants: attendees,
          notes: doc.notes_markdown || '',
          ai_summary: aiSummary,
        })
      }

      console.log(`  Cache: found ${meetings.length} meetings total`)
    } catch (err) {
      console.error(`  Cache read error: ${err.message}`)
    }
  } else {
    console.log(`  Cache not found at ${GRANOLA_CACHE_PATH}`)
  }

  // 2. Fallback to markdown files
  if (meetings.length === 0 && fs.existsSync(GRANOLA_OUTPUT_DIR)) {
    console.log('  Falling back to markdown files...')
    meetings = readMarkdownFiles(daysBack)
  }

  // 3. Filter to recent
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - daysBack)

  const recent = meetings.filter(m => {
    try {
      return new Date(m.created_at) >= cutoff
    } catch {
      return false
    }
  })

  console.log(`  Recent (${daysBack}d): ${recent.length} meetings`)

  // 4. Upsert
  const upsert = db.prepare(`
    INSERT INTO meetings (id, source, title, date, attendees, company_id, summary, raw_path)
    VALUES (?, 'granola', ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      date = excluded.date,
      attendees = excluded.attendees,
      company_id = excluded.company_id,
      summary = excluded.summary
  `)

  let count = 0
  const tx = db.transaction(() => {
    for (const m of recent) {
      const emails = (m.participants || []).map(a => a.email).filter(Boolean)
      const companyMatch = matchCompany(companies, emails, m.title)
      const date = m.created_at ? new Date(m.created_at).toISOString().split('T')[0] : null

      upsert.run(
        `granola-${m.id}`,
        m.title || 'Untitled Meeting',
        date,
        JSON.stringify(m.participants || []),
        companyMatch?.id || null,
        m.ai_summary || m.notes || null,
        null
      )
      count++
    }
  })
  tx()

  console.log(`  ✓ Synced ${count} Granola meetings`)
  return count
}

function extractTextFromRichContent(content) {
  // Simple recursive text extraction from Granola's rich text structure
  if (!content) return ''

  function extract(node) {
    if (typeof node === 'string') return node
    if (!node || typeof node !== 'object') return ''

    if (node.type === 'text') return node.text || ''
    if (Array.isArray(node)) return node.map(extract).join('')
    if (node.content) return extract(node.content)
    return ''
  }

  return extract(content).trim()
}

function readMarkdownFiles(daysBack) {
  const meetings = []
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - daysBack)

  try {
    const files = fs.readdirSync(GRANOLA_OUTPUT_DIR)
      .filter(f => f.endsWith('.md'))
      .sort()
      .reverse()

    for (const file of files) {
      const dateMatch = file.match(/^(\d{4}-\d{2}-\d{2})/)
      if (!dateMatch) continue

      const fileDate = new Date(dateMatch[1])
      if (fileDate < cutoff) continue

      const content = fs.readFileSync(path.join(GRANOLA_OUTPUT_DIR, file), 'utf-8')
      const titleMatch = content.match(/^# Meeting: (.+)$/m)
      const attendeesMatch = content.match(/^Attendees: (.+)$/m)
      const summaryMatch = content.match(/## AI Summary\n([\s\S]*?)(?=\n## |$)/)
      const notesMatch = content.match(/## Your Notes\n([\s\S]*?)(?=\n## |$)/)

      const attendees = attendeesMatch
        ? attendeesMatch[1].split(',').map(a => {
            const emailMatch = a.match(/\(([^)]+)\)/)
            return {
              name: a.replace(/\([^)]+\)/, '').trim(),
              email: emailMatch ? emailMatch[1] : undefined,
            }
          })
        : []

      meetings.push({
        id: file.replace('.md', ''),
        title: titleMatch ? titleMatch[1] : file.replace('.md', ''),
        created_at: dateMatch[1],
        participants: attendees,
        notes: notesMatch ? notesMatch[1].trim() : undefined,
        ai_summary: summaryMatch ? summaryMatch[1].trim() : undefined,
      })
    }
  } catch (err) {
    console.error(`  Markdown read error: ${err.message}`)
  }

  return meetings
}

// ─── Fellow sync ────────────────────────────────────────────────

async function syncFellow(db, companies, daysBack = 30) {
  console.log('\n── Syncing Fellow ──')

  const setting = db.prepare("SELECT value FROM settings WHERE key = 'fellow_api_key'").get()
  const apiKey = setting?.value
  if (!apiKey) {
    console.log('  Fellow API key not configured — skipping')
    return 0
  }

  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - daysBack)

  try {
    const resp = await fetch(`https://api.fellow.app/v2/meetings?start_after=${cutoff.toISOString()}&limit=50`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    })

    if (!resp.ok) {
      throw new Error(`Fellow API ${resp.status}: ${resp.statusText}`)
    }

    const data = await resp.json()
    const meetings = data.results || data.meetings || data || []

    const upsert = db.prepare(`
      INSERT OR REPLACE INTO meetings (id, source, title, date, attendees, company_id, summary, raw_path)
      VALUES (?, 'fellow', ?, ?, ?, ?, ?, NULL)
    `)

    let count = 0
    const tx = db.transaction(() => {
      for (const m of meetings) {
        const emails = (m.attendees || []).map(a => a.email).filter(Boolean)
        const companyMatch = matchCompany(companies, emails, m.title)
        const date = m.start_time ? new Date(m.start_time).toISOString().split('T')[0] : null

        upsert.run(
          `fellow-${m.id}`,
          m.title || 'Untitled Meeting',
          date,
          JSON.stringify(m.attendees || []),
          companyMatch?.id || null,
          null,
        )
        count++
      }
    })
    tx()

    console.log(`  ✓ Synced ${count} Fellow meetings`)
    return count
  } catch (err) {
    console.error(`  Fellow sync error: ${err.message}`)
    return 0
  }
}

// ─── Main ───────────────────────────────────────────────────────

async function main() {
  console.log('=== Central Meeting Sync ===')
  console.log(`DB: ${DB_PATH}`)
  console.log(`Date: ${new Date().toISOString().split('T')[0]}`)

  const db = openDb()
  const companies = loadCompanies(db)
  console.log(`Loaded ${companies.length} companies for matching`)

  // Check current meeting counts
  const before = db.prepare(`
    SELECT source, count(*) as c FROM meetings GROUP BY source
  `).all()
  console.log('\nBefore sync:', before)

  const granolaCount = syncGranola(db, companies, 90)
  const fellowCount = await syncFellow(db, companies, 30)

  // Check after
  const after = db.prepare(`
    SELECT source, count(*) as c FROM meetings GROUP BY source
  `).all()
  console.log('\nAfter sync:', after)

  // Show most recent meetings
  const recent = db.prepare(`
    SELECT source, title, date FROM meetings
    ORDER BY date DESC LIMIT 10
  `).all()
  console.log('\nMost recent meetings:')
  for (const m of recent) {
    console.log(`  ${m.date} [${m.source}] ${m.title}`)
  }

  db.close()
  console.log('\nDone.')
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
