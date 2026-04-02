import dotenv from 'dotenv'
import path from 'path'

dotenv.config()

export const config = {
  port: parseInt(process.env.PORT || '3000'),
  dbPath: process.env.DB_PATH || './family-archive.db',
  mediaBaseUrl: process.env.MEDIA_BASE_URL || 'http://localhost:3000/uploads',
  uploadsDir: path.resolve(process.env.UPLOADS_DIR || './uploads'),
  appName: process.env.APP_NAME || 'Family Archive',

  // R2 — empty in dev, filled in prod
  r2: {
    endpoint: process.env.R2_ENDPOINT || '',
    bucket: process.env.R2_BUCKET || '',
    accessKey: process.env.R2_ACCESS_KEY || '',
    secretKey: process.env.R2_SECRET_KEY || '',
  },

  // Derived
  isProduction: process.env.NODE_ENV === 'production',
  useR2: !!process.env.R2_ENDPOINT,
}
