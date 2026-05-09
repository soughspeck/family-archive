import path from 'path'
import fs from 'fs'
import os from 'os'
import { config } from '../config'
import { uploadFile } from '../storage'

const HEIC_TYPES = new Set(['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence'])
export const isHeic = (mimeType: string) => HEIC_TYPES.has(mimeType)

// Convert HEIC/HEIF → JPEG for browser display.
// Sharp's libheif often lacks the HEVC decoder Apple uses inside HEIC, so we
// use heic-convert (pure-JS) to decode, then pipe the raw pixels through sharp
// for resizing and JPEG encoding.
export async function generateDisplayJpeg(
  filePath: string,
  assetId: string,
  uploadToStorage = false
): Promise<string | null> {
  try {
    const heicConvert = (await import('heic-convert'))
    const sharp = (await import('sharp')).default

    const displayFilename = `${assetId}_display.jpg`
    const displayKey = `display/${displayFilename}`

    // heic-convert → raw JPEG buffer (CJS module, default export is the convert fn)
    const inputBuffer = fs.readFileSync(filePath)
    const convert = (heicConvert as any).default ?? (heicConvert as any)
    const jpegBuffer: Buffer = await convert({ buffer: inputBuffer, format: 'JPEG', quality: 0.9 })

    // Run through sharp to resize (2000px max) and ensure correct orientation
    const resized = await sharp(jpegBuffer)
      .rotate()
      .resize(2000, 2000, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 90 })
      .toBuffer()

    if (uploadToStorage) {
      const tmpPath = path.join(os.tmpdir(), displayFilename)
      fs.writeFileSync(tmpPath, resized)
      await uploadFile(displayKey, tmpPath, 'image/jpeg')
      fs.unlinkSync(tmpPath)
    } else {
      const displayDir = path.join(config.uploadsDir, 'display')
      fs.mkdirSync(displayDir, { recursive: true })
      fs.writeFileSync(path.join(displayDir, displayFilename), resized)
    }

    return displayKey
  } catch (err) {
    console.warn('[display] HEIC→JPEG conversion failed:', err)
    return null
  }
}

// Extracts a single JPEG frame from a video using the system ffmpeg binary.
// Tries 1s first; if the video is shorter, retries at 0s.
function extractVideoFrame(videoPath: string, outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const { execFile } = require('child_process') as typeof import('child_process')
    const args = [
      '-ss', '00:00:01',       // seek to 1s
      '-i', videoPath,
      '-frames:v', '1',        // grab exactly one frame
      '-q:v', '2',             // high-quality JPEG
      '-y',                    // overwrite output if exists
      outPath,
    ]
    execFile('ffmpeg', args, (err) => {
      if (err) {
        // Retry at 0s for very short clips
        const args0 = ['-ss', '00:00:00', '-i', videoPath, '-frames:v', '1', '-q:v', '2', '-y', outPath]
        execFile('ffmpeg', args0, (err2) => {
          if (err2) reject(err2)
          else resolve()
        })
      } else {
        resolve()
      }
    })
  })
}

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

      // For HEIC/HEIF, sharp's libheif often lacks the HEVC decoder Apple uses.
      // Decode via heic-convert first, then hand raw JPEG bytes to sharp.
      let sourceForSharp: string | Buffer = filePath
      if (isHeic(mimeType)) {
        const heicConvert = (await import('heic-convert'))
        const convert = (heicConvert as any).default ?? (heicConvert as any)
        const inputBuffer = fs.readFileSync(filePath)
        sourceForSharp = await convert({ buffer: inputBuffer, format: 'JPEG', quality: 1 }) as Buffer
      }

      const pipeline = sharp(sourceForSharp)
        .rotate()
        .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 75 })

      if (uploadToStorage) {
        const tmpPath = path.join(os.tmpdir(), thumbFilename)
        await pipeline.toFile(tmpPath)
        await uploadFile(thumbKey, tmpPath, 'image/webp')
        fs.unlinkSync(tmpPath)
      } else {
        const thumbDir = path.join(config.uploadsDir, 'thumbnails')
        fs.mkdirSync(thumbDir, { recursive: true })
        await pipeline.toFile(path.join(thumbDir, thumbFilename))
      }

      return thumbKey
    }

    if (mimeType.startsWith('video/')) {
      const thumbDir = path.join(config.uploadsDir, 'thumbnails')
      fs.mkdirSync(thumbDir, { recursive: true })

      // Extract a frame at 1s (falls back to 0s if video is shorter) via ffmpeg,
      // then resize with sharp and encode as WebP.
      const rawFramePath = path.join(os.tmpdir(), `${assetId}_frame.jpg`)
      await extractVideoFrame(filePath, rawFramePath)

      const sharp = (await import('sharp')).default
      const resized = await sharp(rawFramePath)
        .rotate()
        .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 75 })
        .toBuffer()
      fs.unlinkSync(rawFramePath)

      if (uploadToStorage) {
        const tmpPath = path.join(os.tmpdir(), thumbFilename)
        fs.writeFileSync(tmpPath, resized)
        await uploadFile(thumbKey, tmpPath, 'image/webp')
        fs.unlinkSync(tmpPath)
      } else {
        fs.writeFileSync(path.join(thumbDir, thumbFilename), resized)
      }

      return thumbKey
    }

    return null
  } catch (err) {
    console.warn('[thumbnail] generation failed:', err)
    return null
  }
}
