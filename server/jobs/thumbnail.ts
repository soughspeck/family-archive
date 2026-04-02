import path from 'path'
import fs from 'fs'
import { config } from '../config'

export async function generateThumbnail(
  filePath: string,
  assetId: string,
  mimeType: string
): Promise<string | null> {
  try {
    const thumbDir = path.join(config.uploadsDir, 'thumbnails')
    fs.mkdirSync(thumbDir, { recursive: true })

    const thumbFilename = `${assetId}_thumb.webp`
    const thumbPath = path.join(thumbDir, thumbFilename)
    const relPath = path.join('thumbnails', thumbFilename)

    if (mimeType.startsWith('image/')) {
      const sharp = (await import('sharp')).default
      await sharp(filePath)
        .rotate()           // auto-rotate based on EXIF orientation
        .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 75 })
        .toFile(thumbPath)
      return relPath
    }

    if (mimeType.startsWith('video/')) {
      // Stub — in a real implementation you'd use ffmpeg here
      // For MVP, videos get no thumbnail (handled gracefully in UI)
      console.log(`[thumbnail] video thumbnail not yet implemented for ${assetId}`)
      return null
    }

    return null
  } catch (err) {
    console.warn('[thumbnail] generation failed:', err)
    return null
  }
}
