/**
 * Storage abstraction — local disk in dev, Cloudflare R2 in prod.
 *
 * Both backends expose the same interface:
 *   uploadFile(key, data, mimeType) → void
 *   deleteFile(key)                 → void
 *   getPublicUrl(key)               → string
 *
 * `key` is always a relative path like "originals/uuid.jpg" or
 * "thumbnails/uuid_thumb.webp". In local mode it maps straight to
 * uploads/<key>. In R2 mode it becomes the S3 object key.
 */

import fs from 'fs'
import path from 'path'
import { config } from './config'
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3'

// ─── R2 client (created lazily only when useR2 = true) ───────────────────────

let _s3: S3Client | null = null

function getS3(): S3Client {
  if (_s3) return _s3
  _s3 = new S3Client({
    region: 'auto',
    endpoint: config.r2.endpoint,
    credentials: {
      accessKeyId: config.r2.accessKey,
      secretAccessKey: config.r2.secretKey,
    },
  })
  return _s3
}

// ─── Public interface ─────────────────────────────────────────────────────────

/**
 * Upload a file. `data` can be a Buffer (from memory) or a local file path
 * string (for local → R2 migration or thumbnail upload after sharp writes
 * to a temp path).
 */
export async function uploadFile(
  key: string,
  data: Buffer | string,
  mimeType: string
): Promise<void> {
  if (config.useR2) {
    const body = typeof data === 'string' ? fs.readFileSync(data) : data
    await getS3().send(new PutObjectCommand({
      Bucket: config.r2.bucket,
      Key: key,
      Body: body,
      ContentType: mimeType,
    }))
  } else {
    // Local: data is always the temp file path written by multer / sharp
    const dest = path.join(config.uploadsDir, key)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    if (typeof data === 'string') {
      // Copy from temp path to final local path (idempotent if same path)
      if (path.resolve(data) !== path.resolve(dest)) {
        fs.copyFileSync(data, dest)
      }
    } else {
      fs.writeFileSync(dest, data)
    }
  }
}

/**
 * Delete a file by key. Silently ignores missing files.
 */
export async function deleteFile(key: string): Promise<void> {
  if (config.useR2) {
    try {
      await getS3().send(new DeleteObjectCommand({
        Bucket: config.r2.bucket,
        Key: key,
      }))
    } catch (err) {
      console.warn(`[storage] R2 delete failed for ${key}:`, err)
    }
  } else {
    const fullPath = path.join(config.uploadsDir, key)
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath)
  }
}

/**
 * Returns the public URL for a stored key.
 * In dev: http://localhost:3000/uploads/<key>
 * In prod: https://<R2-public-domain>/<key>  (set via MEDIA_BASE_URL)
 */
export function getPublicUrl(key: string): string {
  const base = config.mediaBaseUrl.replace(/\/$/, '')
  return `${base}/${key}`
}
