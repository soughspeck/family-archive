import { Router, Request, Response } from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { v4 as uuid } from 'uuid'
import { getDb } from '../db/db'
import { config } from '../config'
import { extractExif, inferDatePrecision } from '../jobs/exif'
import { generateThumbnail } from '../jobs/thumbnail'
import { populateTaggingQueue } from '../jobs/queue'
import { updateSearchIndex } from '../jobs/search'

export const assetsRouter = Router()

// ─── Multer setup ─────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(config.uploadsDir, 'originals')
    fs.mkdirSync(dir, { recursive: true })
    cb(null, dir)
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname)
    cb(null, `${uuid()}${ext}`)
  }
})

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB max
})

// ─── GET /api/assets ──────────────────────────────────────────────────────────
assetsRouter.get('/', (req: Request, res: Response) => {
  const db = getDb()
  const {
    page = '1',
    limit = '50',
    from,
    to,
    person,
    event,
    precision,
    mime,
  } = req.query as Record<string, string>

  const offset = (parseInt(page) - 1) * parseInt(limit)

  let sql = `
    SELECT DISTINCT a.*
    FROM assets a
    LEFT JOIN asset_people ap ON ap.asset_id = a.id
    LEFT JOIN asset_events ae ON ae.asset_id = a.id
    WHERE 1=1
  `
  const params: (string | number)[] = []

  if (from) { sql += ` AND a.taken_at >= ?`; params.push(from) }
  if (to)   { sql += ` AND a.taken_at <= ?`; params.push(to) }
  if (person) { sql += ` AND ap.person_id = ?`; params.push(person) }
  if (event)  { sql += ` AND ae.event_id = ?`; params.push(event) }
  if (precision) { sql += ` AND a.date_precision = ?`; params.push(precision) }
  if (mime)   { sql += ` AND a.mime_type LIKE ?`; params.push(`${mime}%`) }

  sql += ` ORDER BY a.taken_at DESC, a.created_at DESC LIMIT ? OFFSET ?`
  params.push(parseInt(limit), offset)

  const assets = db.prepare(sql).all(...params)

  // Count total for pagination
  let countSql = sql.replace(/SELECT DISTINCT a\.\*/, 'SELECT COUNT(DISTINCT a.id) as total')
  countSql = countSql.replace(/ORDER BY.*$/, '')
  const countParams = params.slice(0, -2)
  const { total } = db.prepare(countSql).get(...countParams) as { total: number }

  res.json({ assets, total, page: parseInt(page), limit: parseInt(limit) })
})

// ─── GET /api/assets/:id ──────────────────────────────────────────────────────
assetsRouter.get('/:id', (req: Request, res: Response) => {
  const db = getDb()
  const asset = db.prepare('SELECT * FROM assets WHERE id = ?').get(req.params.id)
  if (!asset) return res.status(404).json({ error: 'Not found' })

  const people = db.prepare(`
    SELECT p.* FROM people p
    JOIN asset_people ap ON ap.person_id = p.id
    WHERE ap.asset_id = ?
  `).all(req.params.id)

  const events = db.prepare(`
    SELECT e.* FROM events e
    JOIN asset_events ae ON ae.event_id = e.id
    WHERE ae.asset_id = ?
  `).all(req.params.id)

  const metadata = db.prepare(`
    SELECT * FROM asset_metadata WHERE asset_id = ?
  `).all(req.params.id)

  res.json({ ...asset as object, people, events, metadata })
})

// ─── POST /api/assets/upload ─────────────────────────────────────────────────
assetsRouter.post('/upload', upload.array('files'), async (req: Request, res: Response) => {
  const db = getDb()
  const files = req.files as Express.Multer.File[]
  if (!files?.length) return res.status(400).json({ error: 'No files uploaded' })

  const {
    notes,
    taken_at_manual,
    date_precision_manual,
    person_ids,       // comma-separated
    event_id,
    contributed_by = 'owner',
    source_id,
  } = req.body

  const results = []

  for (const file of files) {
    const assetId = uuid()
    const localPath = path.relative(config.uploadsDir, file.path)
    const mimeType = file.mimetype

    // Extract EXIF
    const exif = await extractExif(file.path, mimeType)

    // Date resolution — manual overrides auto
    const takenAt = taken_at_manual || exif.takenAt || null
    const takenAtSource = taken_at_manual ? 'manual' : (exif.takenAt ? exif.takenAtSource : null)
    const datePrecision = date_precision_manual ||
      (takenAt ? inferDatePrecision(takenAt, takenAtSource) : 'unknown')

    // Thumbnail
    const thumbPath = await generateThumbnail(file.path, assetId, mimeType)

    // Insert asset
    db.prepare(`
      INSERT INTO assets (
        id, filename, original_name, mime_type, file_size,
        local_path, thumbnail_path,
        taken_at, taken_at_source, date_precision,
        width, height, duration_s, orientation,
        latitude, longitude,
        contributed_by, source_id, notes
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?,
        ?, ?, ?
      )
    `).run(
      assetId, file.filename, file.originalname, mimeType, file.size,
      localPath, thumbPath,
      takenAt, takenAtSource, datePrecision,
      exif.width || null, exif.height || null, exif.duration || null, exif.orientation || null,
      exif.latitude || null, exif.longitude || null,
      contributed_by, source_id || null, notes || null
    )

    // Link people
    if (person_ids) {
      const ids = person_ids.split(',').map((s: string) => s.trim()).filter(Boolean)
      for (const pid of ids) {
        db.prepare(`
          INSERT OR IGNORE INTO asset_people (asset_id, person_id, added_by)
          VALUES (?, ?, ?)
        `).run(assetId, pid, contributed_by)
      }
    }

    // Link event
    if (event_id) {
      db.prepare(`
        INSERT OR IGNORE INTO asset_events (asset_id, event_id, added_by)
        VALUES (?, ?, ?)
      `).run(assetId, event_id, contributed_by)
    }

    // Populate tagging queue for missing metadata
    populateTaggingQueue(assetId, { takenAt, personIds: person_ids?.split(',') || [] })

    // Update search index
    updateSearchIndex(assetId)

    results.push({ id: assetId, filename: file.filename, original: file.originalname })
  }

  res.json({ uploaded: results.length, assets: results })
})

// ─── PATCH /api/assets/:id ────────────────────────────────────────────────────
assetsRouter.patch('/:id', (req: Request, res: Response) => {
  const db = getDb()
  const { id } = req.params
  const {
    notes, taken_at, date_precision, location_name,
    latitude, longitude, visibility,
    person_ids, event_id
  } = req.body

  const asset = db.prepare('SELECT id FROM assets WHERE id = ?').get(id)
  if (!asset) return res.status(404).json({ error: 'Not found' })

  db.prepare(`
    UPDATE assets SET
      notes = COALESCE(?, notes),
      taken_at = COALESCE(?, taken_at),
      date_precision = COALESCE(?, date_precision),
      location_name = COALESCE(?, location_name),
      latitude = COALESCE(?, latitude),
      longitude = COALESCE(?, longitude),
      visibility = COALESCE(?, visibility),
      updated_at = datetime('now')
    WHERE id = ?
  `).run(notes, taken_at, date_precision, location_name, latitude, longitude, visibility, id)

  // Update people links if provided
  if (person_ids !== undefined) {
    db.prepare('DELETE FROM asset_people WHERE asset_id = ?').run(id)
    const ids = (person_ids as string).split(',').map(s => s.trim()).filter(Boolean)
    for (const pid of ids) {
      db.prepare(`INSERT OR IGNORE INTO asset_people (asset_id, person_id, added_by) VALUES (?, ?, 'owner')`).run(id, pid)
    }
  }

  // Update event link if provided
  if (event_id !== undefined) {
    db.prepare('DELETE FROM asset_events WHERE asset_id = ?').run(id)
    if (event_id) {
      db.prepare(`INSERT OR IGNORE INTO asset_events (asset_id, event_id, added_by) VALUES (?, ?, 'owner')`).run(id, event_id)
    }
  }

  updateSearchIndex(id)

  res.json({ ok: true })
})

// ─── DELETE /api/assets/:id ───────────────────────────────────────────────────
assetsRouter.delete('/:id', (req: Request, res: Response) => {
  const db = getDb()
  const asset = db.prepare('SELECT * FROM assets WHERE id = ?').get(req.params.id) as any
  if (!asset) return res.status(404).json({ error: 'Not found' })

  // Delete physical files
  if (asset.local_path) {
    const fullPath = path.join(config.uploadsDir, asset.local_path)
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath)
  }
  if (asset.thumbnail_path) {
    const thumbFull = path.join(config.uploadsDir, asset.thumbnail_path)
    if (fs.existsSync(thumbFull)) fs.unlinkSync(thumbFull)
  }

  db.prepare('DELETE FROM search_index WHERE asset_id = ?').run(req.params.id)
  db.prepare('DELETE FROM assets WHERE id = ?').run(req.params.id)

  res.json({ ok: true })
})
