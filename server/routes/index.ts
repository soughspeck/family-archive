import { Router, Request, Response } from 'express'
import { v4 as uuid } from 'uuid'
import { getDb } from '../db/db'

// ─── People ───────────────────────────────────────────────────────────────────
export const peopleRouter = Router()

peopleRouter.get('/', (req: Request, res: Response) => {
  const db = getDb()
  const people = db.prepare(`
    SELECT p.*, COUNT(ap.asset_id) as asset_count
    FROM people p
    LEFT JOIN asset_people ap ON ap.person_id = p.id
    GROUP BY p.id
    ORDER BY p.name
  `).all()
  res.json(people)
})

peopleRouter.post('/', (req: Request, res: Response) => {
  const db = getDb()
  const { name, born_on, born_on_precision, died_on, notes } = req.body
  if (!name) return res.status(400).json({ error: 'name is required' })

  const id = uuid()
  db.prepare(`
    INSERT INTO people (id, name, born_on, born_on_precision, died_on, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, name, born_on || null, born_on_precision || 'unknown', died_on || null, notes || null)

  res.json({ id, name })
})

peopleRouter.patch('/:id', (req: Request, res: Response) => {
  const db = getDb()
  const { name, born_on, born_on_precision, died_on, notes } = req.body
  db.prepare(`
    UPDATE people SET
      name = COALESCE(?, name),
      born_on = COALESCE(?, born_on),
      born_on_precision = COALESCE(?, born_on_precision),
      died_on = COALESCE(?, died_on),
      notes = COALESCE(?, notes)
    WHERE id = ?
  `).run(name, born_on, born_on_precision, died_on, notes, req.params.id)
  res.json({ ok: true })
})

peopleRouter.post('/:id/relationships', (req: Request, res: Response) => {
  const db = getDb()
  const { related_to, type, notes } = req.body
  if (!related_to || !type) return res.status(400).json({ error: 'related_to and type required' })

  db.prepare(`
    INSERT OR REPLACE INTO relationships (person_a, person_b, type, notes)
    VALUES (?, ?, ?, ?)
  `).run(req.params.id, related_to, type, notes || null)

  res.json({ ok: true })
})

// ─── Events ───────────────────────────────────────────────────────────────────
export const eventsRouter = Router()

eventsRouter.get('/', (req: Request, res: Response) => {
  const db = getDb()
  const events = db.prepare(`
    SELECT e.*, COUNT(ae.asset_id) as asset_count
    FROM events e
    LEFT JOIN asset_events ae ON ae.event_id = e.id
    GROUP BY e.id
    ORDER BY e.started_on DESC
  `).all()
  res.json(events)
})

eventsRouter.post('/', (req: Request, res: Response) => {
  const db = getDb()
  const { title, started_on, ended_on, location, notes } = req.body
  if (!title) return res.status(400).json({ error: 'title is required' })

  const id = uuid()
  db.prepare(`
    INSERT INTO events (id, title, started_on, ended_on, location, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, title, started_on || null, ended_on || null, location || null, notes || null)

  res.json({ id, title })
})

eventsRouter.patch('/:id', (req: Request, res: Response) => {
  const db = getDb()
  const { title, started_on, ended_on, location, notes } = req.body
  db.prepare(`
    UPDATE events SET
      title = COALESCE(?, title),
      started_on = COALESCE(?, started_on),
      ended_on = COALESCE(?, ended_on),
      location = COALESCE(?, location),
      notes = COALESCE(?, notes)
    WHERE id = ?
  `).run(title, started_on, ended_on, location, notes, req.params.id)
  res.json({ ok: true })
})

// ─── Search ───────────────────────────────────────────────────────────────────
export const searchRouter = Router()

searchRouter.get('/', (req: Request, res: Response) => {
  const db = getDb()
  const { q, person, event, from, to, page = '1', limit = '50' } = req.query as Record<string, string>
  const offset = (parseInt(page) - 1) * parseInt(limit)

  let assetIds: string[] = []

  // FTS5 text search
  if (q?.trim()) {
    const ftsResults = db.prepare(`
      SELECT asset_id FROM search_index
      WHERE search_index MATCH ?
      ORDER BY rank
    `).all(`${q}*`) as { asset_id: string }[]
    assetIds = ftsResults.map(r => r.asset_id)
    if (assetIds.length === 0) return res.json({ assets: [], total: 0 })
  }

  // Build main query
  let sql = `
    SELECT DISTINCT a.*
    FROM assets a
    LEFT JOIN asset_people ap ON ap.asset_id = a.id
    LEFT JOIN asset_events ae ON ae.asset_id = a.id
    WHERE 1=1
  `
  const params: (string | number)[] = []

  if (assetIds.length > 0) {
    sql += ` AND a.id IN (${assetIds.map(() => '?').join(',')})`
    params.push(...assetIds)
  }
  if (person) { sql += ` AND ap.person_id = ?`; params.push(person) }
  if (event)  { sql += ` AND ae.event_id = ?`; params.push(event) }
  if (from)   { sql += ` AND a.taken_at >= ?`; params.push(from) }
  if (to)     { sql += ` AND a.taken_at <= ?`; params.push(to) }

  sql += ` ORDER BY a.taken_at DESC LIMIT ? OFFSET ?`
  params.push(parseInt(limit), offset)

  const assets = db.prepare(sql).all(...params)
  res.json({ assets, total: assets.length, page: parseInt(page) })
})

// ─── Tagging queue ────────────────────────────────────────────────────────────
export const queueRouter = Router()

queueRouter.get('/', (req: Request, res: Response) => {
  const db = getDb()
  const items = db.prepare(`
    SELECT q.*, a.filename, a.thumbnail_path, a.taken_at, a.mime_type
    FROM tagging_queue q
    JOIN assets a ON a.id = q.asset_id
    WHERE q.resolved = 0
    ORDER BY q.priority DESC, q.created_at ASC
    LIMIT 100
  `).all()
  res.json(items)
})

queueRouter.post('/:id/resolve', (req: Request, res: Response) => {
  const db = getDb()
  db.prepare(`
    UPDATE tagging_queue SET resolved = 1, resolved_at = datetime('now')
    WHERE id = ?
  `).run(req.params.id)
  res.json({ ok: true })
})

// ─── Dashboard stats ──────────────────────────────────────────────────────────
export const dashboardRouter = Router()

dashboardRouter.get('/stats', (req: Request, res: Response) => {
  const db = getDb()

  const totalAssets = (db.prepare('SELECT COUNT(*) as n FROM assets').get() as any).n
  const totalPeople = (db.prepare('SELECT COUNT(*) as n FROM people').get() as any).n
  const totalEvents = (db.prepare('SELECT COUNT(*) as n FROM events').get() as any).n

  const queueCounts = db.prepare(`
    SELECT reason, COUNT(*) as n
    FROM tagging_queue
    WHERE resolved = 0
    GROUP BY reason
  `).all() as { reason: string, n: number }[]

  const queueByReason: Record<string, number> = {}
  for (const row of queueCounts) queueByReason[row.reason] = row.n

  const recentActivity = db.prepare(`
    SELECT
      'upload' as type,
      a.original_name as label,
      a.contributed_by,
      a.created_at as at
    FROM assets a
    ORDER BY a.created_at DESC
    LIMIT 10
  `).all()

  const byYear = db.prepare(`
    SELECT
      SUBSTR(taken_at, 1, 4) as year,
      COUNT(*) as n
    FROM assets
    WHERE taken_at IS NOT NULL AND date_precision != 'unknown'
    GROUP BY year
    ORDER BY year DESC
  `).all()

  res.json({
    totals: { assets: totalAssets, people: totalPeople, events: totalEvents },
    queue: queueByReason,
    recentActivity,
    byYear,
  })
})
