import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { app } from 'electron'
import { seedPortfolioCompanies } from './seed'

let db: Database.Database

/**
 * HARDCODED DB path — always ~/Library/Application Support/central/central.db
 * This avoids the two-database problem where Electron uses different userData
 * paths depending on how it's launched (npx electron . vs packaged app).
 */
function getDbPath(): string {
  const centralDir = path.join(os.homedir(), 'Library', 'Application Support', 'central')
  if (!fs.existsSync(centralDir)) {
    fs.mkdirSync(centralDir, { recursive: true })
  }
  return path.join(centralDir, 'central.db')
}

/**
 * One-time migration: if the old Electron DB exists with data we don't have,
 * pull settings (Google auth tokens) over so we don't lose them.
 */
function migrateFromOldDb(currentDb: Database.Database): void {
  const oldDbPath = path.join(os.homedir(), 'Library', 'Application Support', 'Electron', 'central.db')
  if (!fs.existsSync(oldDbPath)) return

  // Check if we've already migrated
  const migrated = currentDb.prepare("SELECT value FROM settings WHERE key = 'migrated_from_electron'").get() as any
  if (migrated?.value) return

  console.log('[DB] Migrating data from old Electron DB...')
  try {
    const oldDb = new Database(oldDbPath)

    // Migrate settings (Google auth tokens etc.)
    const oldSettings = oldDb.prepare('SELECT * FROM settings').all() as any[]
    const upsertSetting = currentDb.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)')
    for (const s of oldSettings) {
      upsertSetting.run(s.key, s.value)
    }
    console.log(`[DB] Migrated ${oldSettings.length} settings from old DB`)

    // Mark migration complete
    currentDb.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('migrated_from_electron', '1')").run()

    oldDb.close()
    console.log('[DB] Migration from old Electron DB complete')
  } catch (err: any) {
    console.error('[DB] Migration error (non-fatal):', err.message)
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS companies (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  relationship  TEXT NOT NULL,
  domain        TEXT,
  contacts      TEXT DEFAULT '[]',
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS deals (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES companies(id),
  stage         TEXT NOT NULL DEFAULT 'first_meeting',
  category      TEXT NOT NULL DEFAULT 'first_meeting',
    -- 'active_diligence' | 'long_term' | 'first_meeting' | 'passed'
  source        TEXT,
  notes         TEXT,
  description   TEXT,     -- 1-3 sentence summary of company
  revenue       TEXT,     -- revenue if mentioned
  round_size    TEXT,     -- round size if mentioned
  pass_reason   TEXT,
  pass_note     TEXT,
  contact_name  TEXT,
  contact_email TEXT,
  moved_at      TEXT DEFAULT (datetime('now')),
  created_at    TEXT DEFAULT (datetime('now')),
  updated_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS todos (
  id                    TEXT PRIMARY KEY,
  title                 TEXT NOT NULL,
  company_id            TEXT REFERENCES companies(id),
  type                  TEXT NOT NULL DEFAULT 'manual',
  priority              TEXT DEFAULT 'medium',
  status                TEXT DEFAULT 'open',
  source                TEXT,
  source_meeting_id     TEXT,
  source_meeting_title  TEXT,
  deadline              TEXT,
  context               TEXT,
  created_at            TEXT DEFAULT (datetime('now')),
  completed_at          TEXT
);

CREATE TABLE IF NOT EXISTS meetings (
  id              TEXT PRIMARY KEY,
  source          TEXT NOT NULL,
  title           TEXT,
  date            TEXT,
  attendees       TEXT DEFAULT '[]',
  company_id      TEXT REFERENCES companies(id),
  summary         TEXT,
  transcript      TEXT,
  todos_extracted INTEGER DEFAULT 0,
  raw_path        TEXT,
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS calendar_events (
  id            TEXT PRIMARY KEY,
  title         TEXT,
  start_time    TEXT,
  end_time      TEXT,
  attendees     TEXT DEFAULT '[]',
  location      TEXT,
  meeting_link  TEXT,
  company_id    TEXT REFERENCES companies(id),
  date          TEXT,
  synced_at     TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS board_prep (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL REFERENCES companies(id),
  meeting_date    TEXT,
  deck_source     TEXT,     -- 'email' | 'docsend' | 'manual'
  deck_path       TEXT,     -- local path or URL
  questions       TEXT DEFAULT '[]',  -- JSON array of {theme, question, checked}
  summary_draft   TEXT,     -- auto-drafted board summary
  summary_final   TEXT,     -- edited final version
  glue_posted     INTEGER DEFAULT 0,
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS scorecards (
  id              TEXT PRIMARY KEY,
  deal_id         TEXT NOT NULL REFERENCES deals(id),
  company_id      TEXT NOT NULL REFERENCES companies(id),
  status          TEXT NOT NULL DEFAULT 'draft',
  deal_context    TEXT,
  meeting_ids     TEXT DEFAULT '[]',
  file_contents   TEXT DEFAULT '[]',
  additional_notes TEXT,
  slide_executive_summary    TEXT,
  slide_highlights_risks     TEXT,
  slide_scorecard_table      TEXT,
  slide_hypothesis_framework TEXT,
  model_used      TEXT DEFAULT 'gpt-4o-mini',
  tokens_used     INTEGER,
  error_message   TEXT,
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE INDEX IF NOT EXISTS idx_deals_stage ON deals(stage);
CREATE INDEX IF NOT EXISTS idx_deals_company ON deals(company_id);
CREATE INDEX IF NOT EXISTS idx_todos_status ON todos(status);
CREATE INDEX IF NOT EXISTS idx_todos_priority ON todos(priority);
CREATE INDEX IF NOT EXISTS idx_todos_company ON todos(company_id);
CREATE INDEX IF NOT EXISTS idx_meetings_date ON meetings(date);
CREATE INDEX IF NOT EXISTS idx_meetings_source ON meetings(source);
CREATE INDEX IF NOT EXISTS idx_calendar_date ON calendar_events(date);
CREATE INDEX IF NOT EXISTS idx_deals_category ON deals(category);
CREATE INDEX IF NOT EXISTS idx_board_prep_company ON board_prep(company_id);
CREATE INDEX IF NOT EXISTS idx_board_prep_date ON board_prep(meeting_date);
CREATE INDEX IF NOT EXISTS idx_todos_type ON todos(type);
CREATE INDEX IF NOT EXISTS idx_scorecards_deal ON scorecards(deal_id);
CREATE INDEX IF NOT EXISTS idx_scorecards_company ON scorecards(company_id);
`

export function initDatabase(): Database.Database {
  const dbPath = getDbPath()
  console.log(`[DB] Initializing database at ${dbPath}`)

  db = new Database(dbPath)

  // Enable WAL mode for better performance
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  // Run schema
  db.exec(SCHEMA)

  // Migrations for existing databases
  try {
    db.exec(`ALTER TABLE deals ADD COLUMN category TEXT DEFAULT 'first_meeting'`)
  } catch { /* column already exists */ }
  try {
    db.exec(`ALTER TABLE deals ADD COLUMN description TEXT`)
  } catch { /* column already exists */ }
  try {
    db.exec(`ALTER TABLE deals ADD COLUMN revenue TEXT`)
  } catch { /* column already exists */ }
  try {
    db.exec(`ALTER TABLE deals ADD COLUMN round_size TEXT`)
  } catch { /* column already exists */ }

  // Migrate: sync category from stage for existing deals that have stage but default category
  try {
    db.exec(`
      UPDATE deals SET category = CASE stage
        WHEN 'inbound' THEN 'first_meeting'
        WHEN 'first_meeting' THEN 'first_meeting'
        WHEN 'diligence' THEN 'active_diligence'
        WHEN 'active_diligence' THEN 'active_diligence'
        WHEN 'posted_on_glue' THEN 'active_diligence'
        WHEN 'term_sheet' THEN 'active_diligence'
        WHEN 'closed' THEN 'long_term'
        WHEN 'passed' THEN 'passed'
        ELSE 'first_meeting'
      END
      WHERE category = 'first_meeting' AND stage != 'first_meeting' AND stage IS NOT NULL
    `)
  } catch { /* migration already applied or not needed */ }

  // Seed portfolio companies if empty
  const count = db.prepare('SELECT COUNT(*) as count FROM companies').get() as { count: number }
  if (count.count === 0) {
    seedPortfolioCompanies(db)
  }

  // One-time migration from old Electron DB
  migrateFromOldDb(db)

  console.log('[DB] Database initialized successfully')
  return db
}

export function getDb(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.')
  }
  return db
}
