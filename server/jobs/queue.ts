import { v4 as uuid } from 'uuid'
import { getDb } from '../db/db'

interface QueueInput {
  takenAt: string | null
  personIds: string[]
}

export function populateTaggingQueue(assetId: string, input: QueueInput): void {
  const db = getDb()

  if (!input.takenAt) {
    db.prepare(`
      INSERT OR IGNORE INTO tagging_queue (id, asset_id, reason, priority)
      VALUES (?, ?, 'no_date', 10)
    `).run(uuid(), assetId)
  }

  if (!input.personIds || input.personIds.length === 0) {
    db.prepare(`
      INSERT OR IGNORE INTO tagging_queue (id, asset_id, reason, priority)
      VALUES (?, ?, 'no_people', 5)
    `).run(uuid(), assetId)
  }
}
