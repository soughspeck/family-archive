import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'
import { config } from '../config'

let _db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(config.dbPath)
    _db.pragma('journal_mode = WAL')   // better concurrent read performance
    _db.pragma('foreign_keys = ON')    // enforce referential integrity
  }
  return _db
}

export function runMigrations(): void {
  const db = getDb()

  // Track which migrations have run
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      filename TEXT PRIMARY KEY,
      ran_at   TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  const migrationsDir = path.join(__dirname, 'migrations')
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort()  // run in filename order: 001, 002, etc.

  const ran = db.prepare('SELECT filename FROM _migrations').all() as { filename: string }[]
  const ranSet = new Set(ran.map(r => r.filename))

  for (const file of files) {
    if (ranSet.has(file)) continue

    console.log(`[db] Running migration: ${file}`)
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8')

    db.exec(sql)
    db.prepare('INSERT INTO _migrations (filename) VALUES (?)').run(file)
    console.log(`[db] Migration complete: ${file}`)
  }
}
