import path from 'path'
import fs from 'fs'
import os from 'os'
import { config } from '../config'
import { uploadFile } from '../storage'

export async function generateThumbnail(
  filePath: string,
  assetId: string,
  mimeType: string,
  uploadToStorage = false
): Promise<string | null> {
  try {
    const thumbFilename = `${assetId}_thumb.webp`
    const thumbKey = path.join('thumbnails', thumbFilename)

    if (mimeType.startsWith('image/')) {
      const sharp = (await import('sharp')).default

      if (uploadToStorage) {
        // Write to a temp file, upload, then clean up
        const tmpPath = path.join(os.tmpdir(), thumbFilename)
        await sharp(filePath)
          .rotate()
          .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 75 })
          .toFile(tmpPath)
        await uploadFile(thumbKey, tmpPath, 'image/webp')
        fs.unlinkSync(tmpPath)
      } else {
        // Write directly to local uploads/thumbnails/
        const thumbDir = path.join(config.uploadsDir, 'thumbnails')
        fs.mkdirSync(thumbDir, { recursive: true })
        const thumbPath = path.join(thumbDir, thumbFilename)
        await sharp(filePath)
          .rotate()
          .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 75 })
          .toFile(thumbPath)
      }

      return thumbKey
    }

    if (mimeType.startsWith('video/')) {
      console.log(`[thumbnail] video thumbnail not yet implemented for ${assetId}`)
      return null
    }

    return null
  } catch (err) {
    console.warn('[thumbnail] generation failed:', err)
    return null
  }
}
