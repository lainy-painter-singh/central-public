-- Central Database Schema

CREATE TABLE IF NOT EXISTS companies (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  relationship  TEXT NOT NULL,  -- 'board_seat' | 'board_observer' | 'deal' | 'other'
  domain        TEXT,
  contacts      TEXT DEFAULT '[]',  -- JSON array of {name, email, role}
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS deals (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES companies(id),
  stage         TEXT NOT NULL DEFAULT 'inbound',
  source        TEXT,
  notes         TEXT,
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

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_deals_stage ON deals(stage);
CREATE INDEX IF NOT EXISTS idx_deals_company ON deals(company_id);
CREATE INDEX IF NOT EXISTS idx_todos_status ON todos(status);
CREATE INDEX IF NOT EXISTS idx_todos_priority ON todos(priority);
CREATE INDEX IF NOT EXISTS idx_todos_company ON todos(company_id);
CREATE INDEX IF NOT EXISTS idx_meetings_date ON meetings(date);
CREATE INDEX IF NOT EXISTS idx_meetings_source ON meetings(source);
CREATE INDEX IF NOT EXISTS idx_calendar_date ON calendar_events(date);
