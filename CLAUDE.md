# Family Archive — Project Prompt for Claude Code / Cowork

## What this is

A personal family archive application — a private, self-hosted web app to store, browse, search and enrich family photos, videos, audio recordings and documents. The grand vision is a living family memory: a timeline of assets connected to a family tree, searchable by date, people and events, with a pipeline to enrich metadata over time.

This prompt reflects a full architecture session. Do not redesign from scratch — build on the decisions made here.

---

## Repo

https://github.com/soughspeck/family-archive

The repo is public. Clone it, build on it, push changes.

---

## Tech stack — non-negotiable

- **Language**: TypeScript throughout (server and client)
- **Server**: Node.js + Express
- **Database**: SQLite via `better-sqlite3`
- **Client**: Vanilla HTML + CSS + TypeScript (compiled). No React, no Vue, no framework. Keep it simple.
- **Media storage**: Local `uploads/` folder in dev. Cloudflare R2 in production (stubbed interface ready, not wired yet).
- **Search**: SQLite FTS5 (built-in, no external service needed)
- **Image processing**: `sharp` for thumbnails
- **EXIF extraction**: `exifr`

---

## Architecture decisions already made

### Storage model
- Local `uploads/` folder for dev. The `config.ts` uses environment variables so switching to R2 later is a config change, not a code change.
- `MEDIA_BASE_URL` env var controls where media URLs point — local in dev, R2 CDN in prod.
- R2 interface is stubbed. Do not wire it yet — dev uses local files.

### Database
- Single SQLite file (`family-archive.db`) — portable, zero administration, easy to back up.
- WAL mode enabled, foreign keys ON.
- Migration runner: numbered SQL files in `server/db/migrations/`, run automatically on server startup. Every schema change must be a new migration file. Never modify existing migrations.
- All dates stored as ISO TEXT strings in SQLite. SQLite has no native date type.

### Date uncertainty model
This is critical and unusual. Family archives contain photos from 1960 with no date at all, and iPhone photos precise to the second. The schema handles this with two fields:
- `taken_at` — best known date as ISO string (could be "1987", "1987-06", "1987-06-14", or full ISO timestamp)
- `date_precision` — `'exact' | 'day' | 'month' | 'year' | 'circa' | 'unknown'`

The UI must respect this. Never force a full date. "1987" is a valid date entry. "circa 1970s" maps to precision=`'circa'`, taken_at=`'1970'`.

### Metadata model
Flexible key/value metadata table (`asset_metadata`) with full provenance:
- `source`: `'exif' | 'google_json' | 'ai' | 'manual'`
- `confidence`: float 0–1
- `added_by`: references users table

This means new metadata types are free — just use a new key. Never add columns to `assets` for new metadata types, use `asset_metadata`.

### Users model
Single-user for MVP (hardcoded owner with id `'owner'`). The schema is multi-user ready — every metadata record, tagging action and asset contribution tracks `added_by` referencing `users`. This makes adding real auth in phase 2 a non-breaking change.

### Family contribution model
No live sync to other people's cloud storage. Realistic contribution paths are:
1. **Shareable link import** — paste a Yandex.Disk / Google Drive / Dropbox shared link, the server downloads and ingests
2. **Manual upload via UI** — for new important moments
3. **Bulk folder ingest** — CLI script for large one-time imports (Google Takeout ZIP, iCloud export folder)

No Telegram bot, no OAuth to family members' clouds — explicitly out of scope for MVP.

### Deduplication
Exact hash deduplication is not needed (assets come from different phones/sources so exact duplicates are rare). Perceptual hashing (`perceptual_hash` column on assets) is stored for future near-duplicate detection. Not implemented in MVP — just store the hash, build the UI later.

### What is stubbed / out of scope for MVP
- Whisper transcription for audio/video — interface planned, not wired
- AI face detection — interface planned, not wired
- R2 cloud storage — interface ready, local files used in dev
- Real authentication / multi-user login — schema ready, hardcoded owner for now
- Telegram bot contributions — phase 2

---

## Schema — exact, do not modify without a migration

```sql
users (id, name, role, created_at)
  -- role: 'owner' | 'editor' | 'contributor' | 'viewer'
  -- seeded with: INSERT OR IGNORE INTO users (id, name, role) VALUES ('owner', 'Anna', 'owner')

ingestion_sources (id, name, type, contributed_by→users, notes, ingested_at)
  -- type: 'local_folder' | 'google_takeout' | 'shared_link' | 'upload' | 'scan'

assets (
  id, filename, original_name, mime_type, file_size,
  local_path,        -- relative to uploads/
  r2_key,            -- null until prod migration
  thumbnail_path,    -- relative to uploads/
  taken_at,          -- ISO text, precision varies
  taken_at_source,   -- 'exif' | 'filename' | 'google_json' | 'manual'
  date_precision,    -- 'exact'|'day'|'month'|'year'|'circa'|'unknown'
  width, height, duration_s, orientation,
  latitude, longitude, location_name,
  perceptual_hash,
  source_id→ingestion_sources,
  contributed_by→users,
  visibility,        -- 'private'|'family'|'public'
  notes,
  created_at, updated_at
)

asset_metadata (id, asset_id→assets, key, value, source, confidence, added_by→users, added_at)
people (id, name, born_on, born_on_precision, died_on, died_on_precision, notes, created_at)
relationships (person_a→people, person_b→people, type, notes)
  -- type: 'parent' | 'spouse' | 'sibling' | 'child'
asset_people (asset_id→assets, person_id→people, added_by→users, added_at)
events (id, title, started_on, ended_on, location, notes, created_at)
asset_events (asset_id→assets, event_id→events, added_by→users)
tagging_queue (id, asset_id→assets, reason, priority, assigned_to→users, resolved, created_at, resolved_at)
  -- reason: 'no_date' | 'no_people' | 'ai_low_confidence' | 'needs_review'
duplicate_candidates (asset_a→assets, asset_b→assets, similarity, reason, resolved, keep→assets)
search_index (FTS5 virtual table: asset_id UNINDEXED, content, people_names, event_titles, location_name, year)
_migrations (filename, ran_at)  -- migration tracking, managed by runner
```

---

## API routes — already designed

```
GET  /api/health

Assets:
POST   /api/assets/upload         -- multipart, field: files[]
GET    /api/assets                -- paginated; query: page, limit, from, to, person, event, precision, mime
GET    /api/assets/:id            -- with joined people, events, metadata
PATCH  /api/assets/:id
DELETE /api/assets/:id

People:
GET    /api/people                -- with asset_count
POST   /api/people
PATCH  /api/people/:id
POST   /api/people/:id/relationships

Events:
GET    /api/events                -- with asset_count
POST   /api/events
PATCH  /api/events/:id

Search:
GET    /api/search                -- query: q, person, event, from, to, page, limit

Tagging queue:
GET    /api/queue
POST   /api/queue/:id/resolve

Dashboard:
GET    /api/dashboard/stats       -- totals, queue counts by reason, recent activity, byYear
```

---

## Frontend — two tabs, vanilla TS/HTML/CSS

### Shell
- Single `index.html`, two tabs, no routing library
- CSS custom properties (variables) for theming — the archive should feel warm and personal, not like a generic app
- Mobile-friendly — will be used on phone

### Tab 1: Dashboard
**Attention cards** (tappable, each opens relevant queue view):
- Faces to identify (count from queue reason `no_people`)
- Assets with no date (count from queue reason `no_date`)
- Pending imports

**Add new section:**
- Upload button → opens multi-file picker
- Import from shared link → paste field + contributor dropdown + notes field

**Upload flow** (inline, not a new page):
- Step 1: Drop zone / file picker, thumbnails appear as files are selected
- Step 2: Per-file metadata review — date (auto-filled from EXIF, editable), date precision selector (exact / day / month / year / circa / unknown), people (searchable dropdown from `/api/people` with inline "add new person"), event (searchable dropdown from `/api/events` with inline "create new event"), notes
- Batch context: set people/event once and apply to all files
- Step 3: Confirm summary → POST to `/api/assets/upload`

**Import from shared link flow:**
- Paste URL field
- Contributor dropdown (from `/api/people`)
- Notes
- Submit → server downloads and ingests in background, poll for progress

**Recent activity feed** — last 10 uploads/imports with timestamps

### Tab 2: Timeline
**Filter bar:**
- Text search (hits `/api/search`)
- Person filter (dropdown from `/api/people`)
- Event filter (dropdown from `/api/events`)
- Year range (two simple number inputs)

**Timeline view:**
- Grouped by year, then month
- Each group has a header — "March 2024"
- Events surfaced as labeled clusters within a group
- Thumbnail grid — click opens asset detail overlay
- Assets with `date_precision = 'unknown'` or `'circa'` in a separate section at bottom: "Undated & Approximate"

**Asset detail overlay:**
- Full-size photo / video player / audio player depending on mime type
- All metadata: date with precision label, people chips, event badge, location, source provenance, contributed_by
- Edit mode — inline editing of any field
- People: show tagged people, add/remove
- Prev/next navigation within current filter

### Empty states
- First launch: friendly welcome, big upload prompt
- No search results: clear message, suggest broadening filters

---

## Folder structure

```
family-archive/
  server/
    index.ts              ← Express app entry, runs migrations on boot
    config.ts             ← all env vars in one place
    routes/
      assets.ts
      index.ts            ← people, events, search, queue, dashboard routers
    db/
      db.ts               ← getDb(), runMigrations()
      migrations/
        001_initial_schema.sql
    jobs/
      exif.ts             ← extractExif(), inferDatePrecision()
      thumbnail.ts        ← generateThumbnail() using sharp
      queue.ts            ← populateTaggingQueue()
      search.ts           ← updateSearchIndex()
  client/
    index.html
    css/
      main.css
    ts/
      main.ts             ← tab switching, app init
      dashboard.ts
      timeline.ts
      upload.ts
      search.ts
      api.ts              ← typed wrappers for all API calls
  uploads/                ← gitignored, created at runtime
    originals/
    thumbnails/
  package.json
  tsconfig.json
  .env.example
  .gitignore              ← node_modules, dist, .env, *.db, uploads/
```

---

## Environment variables (.env.example already in repo)

```
PORT=3000
DB_PATH=./family-archive.db
MEDIA_BASE_URL=http://localhost:3000/uploads
UPLOADS_DIR=./uploads
APP_NAME=Family Archive

# R2 — leave empty in dev
R2_ENDPOINT=
R2_BUCKET=
R2_ACCESS_KEY=
R2_SECRET_KEY=
```

---

## Processing pipeline on upload

When a file is uploaded:
1. Save to `uploads/originals/` with UUID filename
2. Extract EXIF — date, GPS, dimensions, orientation (best-effort, never block upload on failure)
3. Parse date from filename if no EXIF date (patterns: `20190714_183200`, `2019-07-14`, `IMG_20190714`)
4. Generate thumbnail — `sharp`, 400×400 max, WebP format, auto-rotate from EXIF orientation
5. Insert into `assets` table
6. Link to people and event if provided
7. Add to `tagging_queue` if missing date or people
8. Update `search_index` FTS5 table

---

## Key design principles to maintain

**Never block on metadata.** An upload with zero metadata (no date, no people, no event) is valid. It goes into the tagging queue. The archive is useful before it's complete.

**Always track provenance.** Every piece of metadata knows where it came from (`source` field) and who added it (`added_by`). This matters when you have auto-extracted EXIF data, AI-tagged data, and manually corrected data coexisting.

**Design for uncertainty.** Old family photos may have approximate or unknown dates. The date model handles this — do not force precision. The UI should make "circa 1970s" as easy to enter as an exact date.

**Migration discipline.** Every schema change is a new numbered migration file. The migration runner is idempotent. Never modify `001_initial_schema.sql`.

**Environment-driven config.** Every value that changes between dev and prod is in `config.ts` from an env var. No hardcoded paths or URLs in business logic.

**Mobile-friendly UI.** The owner will use this on a phone. Touch targets must be generous, the upload flow must work on mobile, the timeline must scroll smoothly.

---

## Build plan — week by week

The guiding principle: have something real and usable at the end of every week. Don't build infrastructure nobody can see yet. The timeline is the payoff — get it rendering real photos as fast as possible.

---

### Week 1 — Foundation: server boots, file lands, thumbnail renders

**Goal:** A working upload pipeline. Drop a photo in, see it stored and served back. Nothing visible in the UI yet beyond a health check — but the plumbing is solid.

**Server:**
- `npm run dev` starts without errors
- `runMigrations()` runs on boot, all 13 tables created, `_migrations` tracked
- `/api/health` returns `{ ok: true }`
- `POST /api/assets/upload` accepts a file, runs the full pipeline:
  1. Saves to `uploads/originals/` with UUID filename
  2. Extracts EXIF — date, GPS, dimensions, orientation (best-effort, never throws)
  3. Falls back to filename date parsing if no EXIF date
  4. Generates WebP thumbnail via `sharp` at 400×400 max, auto-rotated
  5. Inserts into `assets` table with correct `date_precision`
  6. Adds to `tagging_queue` if missing date or people
  7. Updates `search_index` FTS5 table
- `GET /api/assets` returns paginated list
- `GET /api/assets/:id` returns asset with joined people, events, metadata
- `uploads/` folder is served as static at `/uploads`

**Verify:**
- Upload a photo via curl or Postman
- Check SQLite directly — row exists, thumbnail_path populated
- Fetch the thumbnail URL in browser — image renders

---

### Week 2 — Client shell + Timeline tab rendering

**Goal:** Open the app in a browser and see your photos in a timeline. The first emotionally satisfying moment.

**Client shell (`client/index.html`, `client/css/main.css`, `client/ts/main.ts`):**
- Two-tab layout: Dashboard | Timeline
- CSS custom properties for the full color palette, typography, spacing
- Warm, personal aesthetic — not a generic app. Think aged paper tones, serif accents, generous whitespace
- Mobile-first layout, works on phone
- Tab switching with no page reload
- `api.ts` — typed fetch wrappers for every API endpoint, used by all other TS files

**Timeline tab (`client/ts/timeline.ts`):**
- On load: fetch `GET /api/assets?limit=200`
- Group assets by year, then by month
- Render year headers ("2024") and month subheaders ("March 2024")
- Thumbnail grid within each month group — responsive, works on phone
- Assets with `date_precision = 'unknown'` or `'circa'` collected into a separate "Undated & Approximate" section pinned to the bottom
- Clicking a thumbnail opens the asset detail overlay

**Asset detail overlay:**
- Full-size photo display (just images for now, video/audio in week 4)
- Metadata panel: date with precision label, people chips (names only), event badge, location, notes, contributed_by
- Prev / Next navigation within current visible assets
- Close button / click-outside to dismiss
- Mobile-friendly: overlay takes full screen on small viewports

**Empty state:**
- First launch with no assets: friendly welcome message, big upload CTA pointing to Dashboard tab

---

### Week 3 — Search + filters working

**Goal:** Find any photo by typing a name, year, or word. Filter by person or event.

**Filter bar (top of Timeline tab):**
- Text search input — debounced 300ms, hits `GET /api/search?q=`
- Person filter — `<select>` populated from `GET /api/people`, filters timeline
- Event filter — `<select>` populated from `GET /api/events`, filters timeline
- Year range — two number inputs (from / to), filters timeline
- All filters composable — search + person + year all work together
- "Clear filters" link appears when any filter is active
- Filter state reflected in URL params so links are shareable

**Search (`client/ts/search.ts`):**
- Calls `GET /api/search` with all active params
- Results replace timeline content, grouped the same way (year/month)
- "X results for 'grandma'" count shown
- No results state: clear message, suggest broadening

**People and events loaded once on app init, cached in memory** — no repeated fetches on every filter change.

---

### Week 4 — Dashboard tab: stats, upload flow, queue

**Goal:** A working command center. Upload new photos from the UI. See what needs attention.

**Dashboard tab (`client/ts/dashboard.ts`):**

**Stats row:**
- Fetches `GET /api/dashboard/stats` on load
- Total assets, total people, total events — displayed as simple counters
- "Photos by year" — small horizontal bar chart, pure CSS, no library

**Attention cards (tappable):**
- "📅 N photos with no date" — count from `queue.no_date`
- "👤 N untagged photos" — count from `queue.no_people`
- Each card tappable — opens the tagging queue view inline below the cards
- Tagging queue view: shows the photo, lets you add date or people, calls `PATCH /api/assets/:id`, resolves queue item

**Upload flow (inline, three steps):**

Step 1 — Pick files:
- Large drop zone, also works as file picker button
- Accepts images, video, audio
- Thumbnails preview immediately as files are selected (browser-side, before upload)
- "Upload N files" button advances to Step 2

Step 2 — Review metadata:
- Batch context row at top: set people / event / notes once, applies to all files
- Per-file rows below: filename, preview thumbnail, date field (auto-filled from EXIF if available), date precision selector, override people/event for this file
- Date field: plain text input accepting "1987", "1987-06", "1987-06-14", full ISO — precision inferred from what's typed
- People field: searchable dropdown from `/api/people`, multi-select chips
- Inline "add new person" — small inline form, posts to `/api/people`, adds to dropdown immediately
- Event field: searchable dropdown from `/api/events`
- Inline "create new event" — small inline form, posts to `/api/events`, selects it immediately
- "Back" and "Upload" buttons

Step 3 — Uploading:
- Progress indicator per file
- On completion: "12 photos added. 3 need date review." with link to queue
- "Upload more" resets to Step 1

**Import from shared link (below upload flow):**
- Paste URL field (Yandex.Disk, Google Drive, Dropbox)
- Contributor name field (free text — who sent this)
- Notes field
- "Import" button → `POST /api/ingest/link`
- Shows "Importing… checking back in 5s" then polls `GET /api/ingest/status/:jobId`
- On completion: "847 assets added"

**Recent activity feed:**
- Last 10 items from `recentActivity` in dashboard stats
- Each item: thumbnail, original filename, date, contributed_by
- Timestamps formatted as relative ("2 days ago")

---

### Week 5 — Polish, media types, mobile

**Goal:** Everything works on a phone. Video and audio play. The app feels finished.

**Media in asset detail overlay:**
- Images: already working from Week 2
- Video (`video/*`): `<video controls>` element, uses local URL or R2 URL from config
- Audio (`audio/*`): `<audio controls>` element, with waveform placeholder
- Documents: link to open in new tab

**Mobile polish pass:**
- Test entire flow on phone viewport
- Touch targets minimum 44×44px
- Upload flow works on mobile Safari (file picker, drag not required)
- Timeline scroll is smooth — no janky reflows
- Overlay is full-screen on mobile
- Filter bar collapses to a single "Filter" button on small screens, expands on tap

**Edit mode in asset detail:**
- "Edit" button reveals inline editing for all fields
- Date, precision, notes, location — all editable in place
- People: add chip (searchable dropdown) / remove chip (× on chip)
- Event: searchable dropdown, clearable
- "Save" calls `PATCH /api/assets/:id`, closes edit mode, refreshes display
- "Cancel" discards changes

**People and events management (accessible from Dashboard):**
- Simple list of all people with asset counts
- Click a person → timeline filtered to their photos
- Edit name, birth year, notes inline
- Add relationship (parent/spouse/sibling) — simple form
- Same for events

**Final checks:**
- All empty states handled gracefully
- All API errors surface as readable messages, not silent failures
- No hardcoded URLs anywhere — everything from `config.ts`
- `npm run build` compiles without errors
- README updated with setup instructions: `npm install`, copy `.env.example` to `.env`, `npm run dev`

---

## Future phases (do not build now, but do not break)

- **Whisper transcription** — `asset_metadata` key `'transcript'`, triggered from dashboard queue
- **AI face detection** — populates `tagging_queue` with reason `'ai_low_confidence'`
- **Perceptual hash dedup UI** — `duplicate_candidates` table already in schema
- **R2 cloud storage** — swap `config.useR2`, same API interface
- **Real auth** — `users` table and `added_by` tracking already in place
- **Hetzner VPS deploy** — copy `.db` file, `git clone`, set env vars, done
- **Family tree visualization** — `people` + `relationships` tables already in schema
- **Google Takeout bulk import** — parse sidecar `.json` files for date + people metadata
