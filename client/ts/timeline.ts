import { api, Asset, thumbnailUrl, formatDate, mimeIcon } from './api.js'
import {
  getPeople, getEvents,
  readFiltersFromDOM, readFiltersFromURL, writeFiltersToDom,
  pushFiltersToURL, hasActiveFilters, clearFilterState,
  updateFilterStatus, executeSearch,
} from './search.js'

// ─── State ────────────────────────────────────────────────────────────────────

let filteredAssets: Asset[] = []
let currentIndex = 0
let searchTimeout: ReturnType<typeof setTimeout> | null = null

// ─── Init ─────────────────────────────────────────────────────────────────────

export async function init(): Promise<void> {
  await populateFilterDropdowns()

  // Restore filters from URL if present
  const urlState = readFiltersFromURL()
  if (hasActiveFilters(urlState)) {
    writeFiltersToDom(urlState)
  }

  bindFilters()
  await applyFilters()
}

async function populateFilterDropdowns(): Promise<void> {
  const [people, events] = await Promise.all([getPeople(), getEvents()])

  const personSel = document.getElementById('filter-person') as HTMLSelectElement
  const eventSel = document.getElementById('filter-event') as HTMLSelectElement

  for (const p of people) {
    const opt = document.createElement('option')
    opt.value = p.id
    opt.textContent = p.name
    personSel.appendChild(opt)
  }

  for (const e of events) {
    const opt = document.createElement('option')
    opt.value = e.id
    opt.textContent = e.title
    eventSel.appendChild(opt)
  }
}

// ─── Render ───────────────────────────────────────────────────────────────────

function renderTimeline(assets: Asset[], isFiltered: boolean): void {
  const content = document.getElementById('timeline-content')!

  if (assets.length === 0) {
    if (isFiltered) {
      content.innerHTML = `
        <div class="state-empty">
          <h2>No results</h2>
          <p>Try a different search term, or remove some filters to broaden your results.</p>
        </div>`
    } else {
      content.innerHTML = `
        <div class="state-empty">
          <h2>No memories yet</h2>
          <p>Upload some photos, videos, or documents to get started. Switch to the <strong>Dashboard</strong> tab to add your first files.</p>
        </div>`
    }
    return
  }

  // Split dated vs undated/circa
  const dated = assets.filter(
    a => a.taken_at && a.date_precision !== 'unknown' && a.date_precision !== 'circa'
  )
  const undated = assets.filter(
    a => !a.taken_at || a.date_precision === 'unknown' || a.date_precision === 'circa'
  )

  // Group dated assets by year → month
  const byYear = new Map<string, Map<string, Asset[]>>()

  for (const asset of dated) {
    const year = asset.taken_at!.substring(0, 4)
    const monthKey = asset.taken_at!.length >= 7
      ? asset.taken_at!.substring(0, 7)
      : `${year}-00`

    if (!byYear.has(year)) byYear.set(year, new Map())
    const months = byYear.get(year)!
    if (!months.has(monthKey)) months.set(monthKey, [])
    months.get(monthKey)!.push(asset)
  }

  // Sort years descending
  const sortedYears = Array.from(byYear.keys()).sort((a, b) => b.localeCompare(a))

  const html: string[] = []

  for (const year of sortedYears) {
    const months = byYear.get(year)!
    const yearCount = Array.from(months.values()).reduce((s, m) => s + m.length, 0)

    html.push(`
      <div class="year-group">
        <div class="year-header">
          <span class="year-label">${year}</span>
          <span class="year-count">${yearCount} item${yearCount !== 1 ? 's' : ''}</span>
        </div>`)

    // Sort months descending within year
    const sortedMonths = Array.from(months.keys()).sort((a, b) => b.localeCompare(a))

    for (const monthKey of sortedMonths) {
      const monthAssets = months.get(monthKey)!
      const monthLabel = formatMonthLabel(monthKey)

      html.push(`
        <div class="month-group">
          <div class="month-header">${monthLabel}</div>
          <div class="thumb-grid">
            ${monthAssets.map(a => thumbHtml(a)).join('')}
          </div>
        </div>`)
    }

    html.push('</div>')
  }

  // Undated section
  if (undated.length > 0) {
    html.push(`
      <div class="undated-section">
        <div class="undated-header">Undated &amp; Approximate (${undated.length})</div>
        <div class="thumb-grid">
          ${undated.map(a => thumbHtml(a)).join('')}
        </div>
      </div>`)
  }

  content.innerHTML = html.join('')

  // Lazy-load images
  content.querySelectorAll<HTMLImageElement>('img[data-src]').forEach(img => {
    img.classList.add('loading')
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const el = entry.target as HTMLImageElement
          el.src = el.dataset.src!
          el.onload = () => el.classList.remove('loading')
          observer.unobserve(el)
        }
      }
    }, { rootMargin: '200px' })
    observer.observe(img)
  })

  // Click handlers
  content.querySelectorAll<HTMLElement>('.thumb-item').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.id!
      const idx = filteredAssets.findIndex(a => a.id === id)
      if (idx !== -1) openOverlay(idx)
    })
  })
}

function thumbHtml(asset: Asset): string {
  const thumb = thumbnailUrl(asset)
  const icon = mimeIcon(asset.mime_type)
  const media = thumb
    ? `<img data-src="${thumb}" alt="${escHtml(asset.original_name || '')}">`
    : `<div class="thumb-placeholder">${icon}</div>`

  const badge = asset.location_name
    ? `<span class="thumb-badge">${escHtml(asset.location_name)}</span>`
    : ''

  return `<div class="thumb-item" data-id="${asset.id}" title="${escHtml(asset.original_name || asset.filename)}">${media}${badge}</div>`
}

function formatMonthLabel(monthKey: string): string {
  if (monthKey.endsWith('-00')) return 'Unknown month'
  try {
    const [year, month] = monthKey.split('-')
    return new Date(parseInt(year), parseInt(month) - 1).toLocaleString('default', {
      month: 'long',
    })
  } catch {
    return monthKey
  }
}

// ─── Overlay ──────────────────────────────────────────────────────────────────

function openOverlay(index: number): void {
  currentIndex = index
  renderOverlay()
  document.getElementById('asset-overlay')!.classList.remove('hidden')
  document.body.style.overflow = 'hidden'
}

function closeOverlay(): void {
  document.getElementById('asset-overlay')!.classList.add('hidden')
  document.body.style.overflow = ''
}

async function renderOverlay(): Promise<void> {
  const asset = filteredAssets[currentIndex]
  if (!asset) return

  const prevBtn = document.getElementById('overlay-prev') as HTMLButtonElement
  const nextBtn = document.getElementById('overlay-next') as HTMLButtonElement
  prevBtn.disabled = currentIndex === 0
  nextBtn.disabled = currentIndex === filteredAssets.length - 1

  const content = document.getElementById('overlay-content')!
  content.innerHTML = renderAssetDetail(asset, null)

  try {
    const full = await api.assets.get(asset.id)
    content.innerHTML = renderAssetDetail(full, full)
  } catch {
    // already rendered with what we have
  }
}

function renderAssetDetail(asset: Asset, full: Asset | null): string {
  const mime = asset.mime_type || ''
  const origUrl = asset.local_path ? `/uploads/${asset.local_path}` : null
  const thumbUrl = thumbnailUrl(asset)

  let mediaHtml = ''
  if (mime.startsWith('image/') && origUrl) {
    mediaHtml = `<img src="${origUrl}" alt="${escHtml(asset.original_name || '')}" loading="lazy">`
  } else if (mime.startsWith('image/') && thumbUrl) {
    mediaHtml = `<img src="${thumbUrl}" alt="${escHtml(asset.original_name || '')}">`
  } else if (mime.startsWith('video/') && origUrl) {
    mediaHtml = `<video src="${origUrl}" controls preload="metadata"></video>`
  } else if (mime.startsWith('audio/') && origUrl) {
    mediaHtml = `<audio src="${origUrl}" controls style="width:100%;padding:20px"></audio>`
  } else {
    mediaHtml = `<div class="thumb-placeholder" style="font-size:3rem;padding:60px 0">${mimeIcon(mime)}</div>`
  }

  const people = full?.people ?? []
  const events = full?.events ?? []

  const peopleTags = people.length > 0
    ? people.map(p => `<span class="tag">${escHtml(p.name)}</span>`).join('')
    : '<span style="font-size:0.82rem;color:var(--text-3)">Not identified</span>'

  const eventTags = events.length > 0
    ? events.map(e => `<span class="tag event-tag">${escHtml(e.title)}</span>`).join('')
    : ''

  const location = asset.location_name
    ? `<div class="asset-info-section">
        <div class="asset-info-label">Location</div>
        <div style="font-size:0.88rem;color:var(--text-2)">${escHtml(asset.location_name)}</div>
       </div>`
    : ''

  const notes = asset.notes
    ? `<div class="asset-info-section">
        <div class="asset-info-label">Notes</div>
        <div class="asset-info-notes">${escHtml(asset.notes)}</div>
       </div>`
    : ''

  return `
    <div class="asset-detail">
      <div class="asset-media">${mediaHtml}</div>
      <div class="asset-info">
        <div class="asset-info-date">${formatDate(asset)}</div>
        <div class="asset-info-precision">${precisionLabel(asset.date_precision)}</div>

        <div class="asset-info-section">
          <div class="asset-info-label">People</div>
          <div class="asset-tags">${peopleTags}</div>
        </div>

        ${eventTags ? `<div class="asset-info-section">
          <div class="asset-info-label">Event</div>
          <div class="asset-tags">${eventTags}</div>
        </div>` : ''}

        ${location}
        ${notes}

        <div class="asset-info-meta">
          ${asset.width && asset.height ? `${asset.width} × ${asset.height}px<br>` : ''}
          ${asset.file_size ? `${(asset.file_size / (1024 * 1024)).toFixed(1)} MB<br>` : ''}
          ${asset.mime_type ? `${asset.mime_type}<br>` : ''}
        </div>

        <div class="asset-info-filename">${escHtml(asset.original_name || asset.filename)}</div>
      </div>
    </div>`
}

function precisionLabel(precision: string): string {
  const labels: Record<string, string> = {
    exact: 'Exact timestamp',
    day: 'Date known',
    month: 'Month known',
    year: 'Year only',
    circa: 'Approximate',
    unknown: 'Date unknown',
  }
  return labels[precision] ?? precision
}

// ─── Filters ──────────────────────────────────────────────────────────────────

function bindFilters(): void {
  const search = document.getElementById('search-input') as HTMLInputElement
  const person = document.getElementById('filter-person') as HTMLSelectElement
  const event = document.getElementById('filter-event') as HTMLSelectElement
  const from = document.getElementById('filter-from') as HTMLInputElement
  const to = document.getElementById('filter-to') as HTMLInputElement

  search.addEventListener('input', () => {
    if (searchTimeout) clearTimeout(searchTimeout)
    searchTimeout = setTimeout(() => applyFilters(), 300)
  })

  person.addEventListener('change', applyFilters)
  event.addEventListener('change', applyFilters)
  from.addEventListener('change', applyFilters)
  to.addEventListener('change', applyFilters)

  // Clear filters button
  document.getElementById('clear-filters')!.addEventListener('click', () => {
    const blank = clearFilterState()
    writeFiltersToDom(blank)
    applyFilters()
  })

  // Overlay nav + close
  document.getElementById('overlay-close')!.addEventListener('click', closeOverlay)
  document.getElementById('overlay-backdrop')!.addEventListener('click', closeOverlay)
  document.getElementById('overlay-prev')!.addEventListener('click', () => {
    if (currentIndex > 0) { currentIndex--; renderOverlay() }
  })
  document.getElementById('overlay-next')!.addEventListener('click', () => {
    if (currentIndex < filteredAssets.length - 1) { currentIndex++; renderOverlay() }
  })

  document.addEventListener('keydown', e => {
    const overlay = document.getElementById('asset-overlay')!
    if (overlay.classList.contains('hidden')) return
    if (e.key === 'Escape') closeOverlay()
    if (e.key === 'ArrowLeft' && currentIndex > 0) { currentIndex--; renderOverlay() }
    if (e.key === 'ArrowRight' && currentIndex < filteredAssets.length - 1) { currentIndex++; renderOverlay() }
  })

  // Listen for popstate (back/forward) to restore filters
  window.addEventListener('popstate', () => {
    const state = readFiltersFromURL()
    writeFiltersToDom(state)
    applyFilters()
  })
}

async function applyFilters(): Promise<void> {
  const state = readFiltersFromDOM()
  const isFiltered = hasActiveFilters(state)

  // Sync to URL
  pushFiltersToURL(state)

  const content = document.getElementById('timeline-content')!
  content.innerHTML = `<div class="state-loading">${state.q ? 'Searching…' : 'Loading memories…'}</div>`

  try {
    filteredAssets = await executeSearch(state)
    updateFilterStatus(state, filteredAssets.length)
    renderTimeline(filteredAssets, isFiltered)
  } catch {
    content.innerHTML = '<div class="state-loading">Could not load assets.</div>'
  }
}

// ─── Util ─────────────────────────────────────────────────────────────────────

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
