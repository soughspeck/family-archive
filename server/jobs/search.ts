import { getDb } from '../db/db'

export function updateSearchIndex(assetId: string): void {
  const db = getDb()

  const asset = db.prepare('SELECT * FROM assets WHERE id = ?').get(assetId) as any
  if (!asset) return

  const people = db.prepare(`
    SELECT p.name FROM people p
    JOIN asset_people ap ON ap.person_id = p.id
    WHERE ap.asset_id = ?
  `).all(assetId) as { name: string }[]

  const events = db.prepare(`
    SELECT e.title FROM events e
    JOIN asset_events ae ON ae.event_id = e.id
    WHERE ae.asset_id = ?
  `).all(assetId) as { title: string }[]

  const content = [asset.notes, asset.original_name].filter(Boolean).join(' ')
  const peopleNames = people.map(p => p.name).join(' ')
  const eventTitles = events.map(e => e.title).join(' ')
  const year = asset.taken_at ? asset.taken_at.substring(0, 4) : ''

  // Delete existing entry and reinsert
  db.prepare('DELETE FROM search_index WHERE asset_id = ?').run(assetId)
  db.prepare(`
    INSERT INTO search_index (asset_id, content, people_names, event_titles, location_name, year)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(assetId, content, peopleNames, eventTitles, asset.location_name || '', year)
}
