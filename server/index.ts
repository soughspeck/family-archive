import express from 'express'
import cors from 'cors'
import path from 'path'
import fs from 'fs'
import { config } from './config'
import { runMigrations } from './db/db'
import { assetsRouter } from './routes/assets'
import {
  peopleRouter,
  eventsRouter,
  searchRouter,
  queueRouter,
  dashboardRouter,
} from './routes/index'

const app = express()

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors())
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// ─── Static files ─────────────────────────────────────────────────────────────
// Serve uploaded media
fs.mkdirSync(config.uploadsDir, { recursive: true })
app.use('/uploads', express.static(config.uploadsDir))

// Serve client HTML/CSS/JS (no-cache in dev for live reloads)
const clientDir = path.join(process.cwd(), 'client')
app.use(express.static(clientDir, { etag: false, lastModified: false, setHeaders: (res) => {
  res.setHeader('Cache-Control', 'no-store')
}}))

// ─── API routes ───────────────────────────────────────────────────────────────
app.use('/api/assets', assetsRouter)
app.use('/api/people', peopleRouter)
app.use('/api/events', eventsRouter)
app.use('/api/search', searchRouter)
app.use('/api/queue', queueRouter)
app.use('/api/dashboard', dashboardRouter)

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ ok: true, app: config.appName, ts: new Date().toISOString() })
})

// ─── SPA fallback ─────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(clientDir, 'index.html'))
})

// ─── Boot ─────────────────────────────────────────────────────────────────────
function start() {
  runMigrations()
  app.listen(config.port, () => {
    console.log(`\n🗂  ${config.appName} running at http://localhost:${config.port}`)
    console.log(`   DB: ${config.dbPath}`)
    console.log(`   Media: ${config.uploadsDir}`)
    console.log(`   R2: ${config.useR2 ? 'enabled' : 'local files (dev mode)'}`)
    console.log()
  })
}

start()
