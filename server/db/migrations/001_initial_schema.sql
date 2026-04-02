-- Migration 001: Initial schema
-- Run automatically on server startup via migrate.ts

-- ─── Users ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'editor',
  -- 'owner' | 'editor' | 'contributor' | 'viewer'
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Seed the owner (you). Change name as needed.
INSERT OR IGNORE INTO users (id, name, role)
VALUES ('owner', 'Anna', 'owner');

-- ─── Ingestion sources ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ingestion_sources (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  type           TEXT NOT NULL,
  -- 'local_folder' | 'google_takeout' | 'shared_link' | 'upload' | 'scan'
  contributed_by TEXT REFERENCES users(id),
  notes          TEXT,
  ingested_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── Assets ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS assets (
  id               TEXT PRIMARY KEY,
  filename         TEXT NOT NULL,
  original_name    TEXT,
  mime_type        TEXT,
  file_size        INTEGER,

  -- Storage
  local_path       TEXT,          -- relative path under uploads/
  r2_key           TEXT UNIQUE,   -- key in R2 bucket (null until migrated to cloud)
  thumbnail_path   TEXT,

  -- Dates — designed for uncertainty
  taken_at         TEXT,          -- ISO string, best known value
  taken_at_source  TEXT,          -- 'exif' | 'filename' | 'google_json' | 'manual'
  date_precision   TEXT DEFAULT 'unknown',
  -- 'exact' | 'day' | 'month' | 'year' | 'circa' | 'unknown'

  -- Media properties
  width            INTEGER,
  height           INTEGER,
  duration_s       REAL,          -- for video/audio, seconds
  orientation      INTEGER,

  -- Location
  latitude         REAL,
  longitude        REAL,
  location_name    TEXT,          -- human readable, e.g. "Tel Aviv"

  -- Fingerprints
  perceptual_hash  TEXT,          -- for near-duplicate detection

  -- Provenance
  source_id        TEXT REFERENCES ingestion_sources(id),
  contributed_by   TEXT REFERENCES users(id) DEFAULT 'owner',

  -- Visibility
  visibility       TEXT NOT NULL DEFAULT 'family',
  -- 'private' | 'family' | 'public'

  -- Notes
  notes            TEXT,

  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_assets_taken_at ON assets(taken_at);
CREATE INDEX IF NOT EXISTS idx_assets_contributed_by ON assets(contributed_by);
CREATE INDEX IF NOT EXISTS idx_assets_mime_type ON assets(mime_type);

-- ─── Flexible metadata (key/value with full provenance) ───────────────────────
CREATE TABLE IF NOT EXISTS asset_metadata (
  id          TEXT PRIMARY KEY,
  asset_id    TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,   -- e.g. 'caption', 'color_label', 'transcript'
  value       TEXT NOT NULL,
  source      TEXT,            -- 'exif' | 'google_json' | 'ai' | 'manual'
  confidence  REAL DEFAULT 1.0,
  added_by    TEXT REFERENCES users(id),
  added_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_metadata_asset ON asset_metadata(asset_id);
CREATE INDEX IF NOT EXISTS idx_metadata_key ON asset_metadata(key);

-- ─── People ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS people (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  born_on     TEXT,
  born_on_precision TEXT DEFAULT 'unknown',
  died_on     TEXT,
  died_on_precision TEXT DEFAULT 'unknown',
  notes       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── Family relationships ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS relationships (
  person_a    TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  person_b    TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,   -- 'parent' | 'spouse' | 'sibling' | 'child'
  notes       TEXT,
  PRIMARY KEY (person_a, person_b, type)
);

-- ─── Asset ↔ People ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS asset_people (
  asset_id    TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  person_id   TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  added_by    TEXT REFERENCES users(id),
  added_at    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (asset_id, person_id)
);

-- ─── Events ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS events (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  started_on  TEXT,
  ended_on    TEXT,
  location    TEXT,
  notes       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── Asset ↔ Events ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS asset_events (
  asset_id    TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  added_by    TEXT REFERENCES users(id),
  PRIMARY KEY (asset_id, event_id)
);

-- ─── Tagging queue ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tagging_queue (
  id          TEXT PRIMARY KEY,
  asset_id    TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  reason      TEXT NOT NULL,
  -- 'no_date' | 'no_people' | 'ai_low_confidence' | 'needs_review'
  priority    INTEGER NOT NULL DEFAULT 0,
  assigned_to TEXT REFERENCES users(id),
  resolved    INTEGER NOT NULL DEFAULT 0,  -- 0 = pending, 1 = done
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_queue_resolved ON tagging_queue(resolved);
CREATE INDEX IF NOT EXISTS idx_queue_asset ON tagging_queue(asset_id);

-- ─── Duplicate candidates ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS duplicate_candidates (
  asset_a     TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  asset_b     TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  similarity  REAL NOT NULL,
  reason      TEXT,    -- 'perceptual_hash' | 'same_moment'
  resolved    INTEGER NOT NULL DEFAULT 0,
  keep        TEXT REFERENCES assets(id),
  PRIMARY KEY (asset_a, asset_b)
);

-- ─── Full-text search index ───────────────────────────────────────────────────
CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
  asset_id    UNINDEXED,
  content,             -- notes, captions, transcripts
  people_names,        -- denormalized: "Rosa Misha David"
  event_titles,        -- denormalized: "Passover 1987 Wedding"
  location_name,
  year                 -- for year-based text search
);
