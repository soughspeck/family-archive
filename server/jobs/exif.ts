import path from 'path'

export interface ExifResult {
  takenAt: string | null
  takenAtSource: string
  width: number | null
  height: number | null
  orientation: number | null
  latitude: number | null
  longitude: number | null
  duration: number | null
}

export async function extractExif(filePath: string, mimeType: string): Promise<ExifResult> {
  const result: ExifResult = {
    takenAt: null,
    takenAtSource: 'none',
    width: null,
    height: null,
    orientation: null,
    latitude: null,
    longitude: null,
    duration: null,
  }

  try {
    if (mimeType.startsWith('image/')) {
      // Dynamic import — exifr is ESM
      const exifr = await import('exifr')
      const exif = await exifr.default.parse(filePath, {
        pick: ['DateTimeOriginal', 'CreateDate', 'ImageWidth', 'ImageHeight',
               'Orientation', 'GPSLatitude', 'GPSLongitude', 'GPSLatitudeRef', 'GPSLongitudeRef']
      })

      if (exif) {
        if (exif.DateTimeOriginal || exif.CreateDate) {
          const d = exif.DateTimeOriginal || exif.CreateDate
          result.takenAt = d instanceof Date ? d.toISOString() : String(d)
          result.takenAtSource = 'exif'
        }
        result.width = exif.ImageWidth || null
        result.height = exif.ImageHeight || null
        result.orientation = exif.Orientation || null

        if (exif.GPSLatitude && exif.GPSLongitude) {
          result.latitude = exif.GPSLatitude
          result.longitude = exif.GPSLongitude
        }
      }
    }
  } catch (err) {
    // EXIF extraction is best-effort — never block an upload
    console.warn('[exif] extraction failed:', err)
  }

  // If no EXIF date, try to parse from filename
  if (!result.takenAt) {
    const fromFilename = parseDateFromFilename(path.basename(filePath))
    if (fromFilename) {
      result.takenAt = fromFilename
      result.takenAtSource = 'filename'
    }
  }

  return result
}

// Attempt to parse dates from common filename patterns:
// IMG_20190714_183200.jpg → 2019-07-14
// 2019-07-14_vacation.jpg → 2019-07-14
// 20190714_183200.jpg     → 2019-07-14
function parseDateFromFilename(filename: string): string | null {
  const patterns = [
    /(\d{4})-(\d{2})-(\d{2})/,                    // 2019-07-14
    /(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/, // 20190714_183200
    /(\d{4})(\d{2})(\d{2})/,                        // 20190714
  ]

  for (const pattern of patterns) {
    const match = filename.match(pattern)
    if (match) {
      const year = parseInt(match[1])
      const month = parseInt(match[2])
      const day = parseInt(match[3])
      if (year > 1900 && year < 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        return `${match[1]}-${match[2]}-${match[3]}`
      }
    }
  }
  return null
}

// Infer how precise a date is based on its format and source
export function inferDatePrecision(takenAt: string, source: string | null): string {
  if (!takenAt) return 'unknown'
  if (source === 'exif') return 'exact'         // EXIF has second precision

  // ISO string length signals precision
  if (takenAt.length >= 19) return 'exact'      // 2019-07-14T18:32:00
  if (takenAt.length === 10) return 'day'       // 2019-07-14
  if (takenAt.length === 7) return 'month'      // 2019-07
  if (takenAt.length === 4) return 'year'       // 1987

  return 'day'
}
