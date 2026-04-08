import { api, Asset, Person, ArchiveEvent, thumbnailUrl, formatDate, mimeIcon } from './api.js'
import {
  getPeople, getEvents, invalidatePeopleCache, invalidateEventsCache,
  readFiltersFromURL, FilterState,
  pushFiltersToURL, hasActiveFilters, clearFilterState,
  updateFilterStatus, executeSearch,
} from './search.js'

// ─── State ────────────────────────────────────────────────────────────────────

let filteredAssets: Asset[] = []
let currentIndex = 0
let searchTimeout: ReturnType<typeof setTimeout> | null = null

// Filter chip selections
let selectedPersonIds: string[] = []
let selectedEventIds: string[] = []

// Bulk selection
const selectedAssetIds = new Set<string>()
let lastCheckedIndex: number | null = null

// ─── Init ─────────────────────────────────────────────────────────────────────

export async function init(): Promise<void> {
  const app = document.getElementById('app')!
  app.innerHTML = `
    <div class="timeline-filters">
      <div class="filter-row">
        <input type="text" class="search-input" id="search-input" placeholder="Search…">
        <div class="filter-chip-select" id="filter-person-wrap">
          <div class="filter-chip-chips" id="filter-person-chips"></div>
          <input type="text" class="filter-chip-input" id="filter-person-input" placeholder="People" autocomplete="off">
          <div class="tag-dropdown hidden" id="filter-person-dropdown"></div>
        </div>
        <div class="filter-chip-select" id="filter-event-wrap">
          <div class="filter-chip-chips" id="filter-event-chips"></div>
          <input type="text" class="filter-chip-input" id="filter-event-input" placeholder="Events" autocomplete="off">
          <div class="tag-dropdown hidden" id="filter-event-dropdown"></div>
        </div>
        <input type="number" class="filter-year" id="filter-from" placeholder="From year">
        <input type="number" class="filter-year" id="filter-to" placeholder="To year">
        <a class="filter-clear hidden" id="clear-filters" href="#">Clear filters</a>
      </div>
      <div class="filter-status" id="filter-status"></div>
    </div>
    <div id="timeline-content"><div class="state-loading">Loading…</div></div>`

  // Preload cached data
  await Promise.all([getPeople(), getEvents()])

  // Restore filters from URL if present
  const urlState = readFiltersFromURL()
  if (hasActiveFilters(urlState)) {
    selectedPersonIds = urlState.personIds
    selectedEventIds = urlState.eventIds
    ;(document.getElementById('search-input') as HTMLInputElement).value = urlState.q
    ;(document.getElementById('filter-from') as HTMLInputElement).value = urlState.from
    ;(document.getElementById('filter-to') as HTMLInputElement).value = urlState.to
    renderFilterChips()
  }

  bindFilters()
  await applyFilters()
}

function renderFilterChips(): void {
  renderPersonChips()
  renderEventChips()
}

async function renderPersonChips(): Promise<void> {
  const container = document.getElementById('filter-person-chips')!
  const allPeople = await getPeople()
  container.innerHTML = selectedPersonIds
    .map(id => {
      const p = allPeople.find(x => x.id === id)
      const name = p ? escHtml(p.name) : id
      return `<span class="filter-chip" data-id="${id}">${name}<button class="filter-chip-x" data-id="${id}">×</button></span>`
    }).join('')

  // Update placeholder
  const input = document.getElementById('filter-person-input') as HTMLInputElement
  input.placeholder = selectedPersonIds.length ? '' : 'People'
}

async function renderEventChips(): Promise<void> {
  const container = document.getElementById('filter-event-chips')!
  const allEvents = await getEvents()
  container.innerHTML = selectedEventIds
    .map(id => {
      const e = allEvents.find(x => x.id === id)
      const title = e ? escHtml(e.title) : id
      return `<span class="filter-chip filter-chip-event" data-id="${id}">${title}<button class="filter-chip-x" data-id="${id}">×</button></span>`
    }).join('')

  const input = document.getElementById('filter-event-input') as HTMLInputElement
  input.placeholder = selectedEventIds.length ? '' : 'Events'
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

  // Checkbox handlers with shift-select
  const allCheckboxes = Array.from(content.querySelectorAll<HTMLInputElement>('.thumb-checkbox'))

  allCheckboxes.forEach((cb, idx) => {
    cb.addEventListener('click', (e) => {
      e.stopPropagation()
      const checking = cb.checked

      if (e.shiftKey && lastCheckedIndex !== null) {
        const from = Math.min(lastCheckedIndex, idx)
        const to = Math.max(lastCheckedIndex, idx)
        for (let i = from; i <= to; i++) {
          const box = allCheckboxes[i]
          const id = box.dataset.id!
          const item = box.closest('.thumb-item') as HTMLElement
          box.checked = checking
          if (checking) {
            selectedAssetIds.add(id)
            item.classList.add('selected')
          } else {
            selectedAssetIds.delete(id)
            item.classList.remove('selected')
          }
        }
      } else {
        const id = cb.dataset.id!
        const item = cb.closest('.thumb-item') as HTMLElement
        if (checking) {
          selectedAssetIds.add(id)
          item.classList.add('selected')
        } else {
          selectedAssetIds.delete(id)
          item.classList.remove('selected')
        }
      }

      lastCheckedIndex = idx
      updateSelectionBar()
    })
  })

  // Prevent checkbox label clicks from opening the overlay
  content.querySelectorAll<HTMLElement>('.thumb-check').forEach(el => {
    el.addEventListener('click', (e) => e.stopPropagation())
  })

  // Click on thumbnail (not checkbox) opens overlay
  content.querySelectorAll<HTMLElement>('.thumb-item').forEach(el => {
    el.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.thumb-check')) return
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

  const checked = selectedAssetIds.has(asset.id) ? ' checked' : ''

  return `<div class="thumb-item${checked ? ' selected' : ''}" data-id="${asset.id}" title="${escHtml(asset.original_name || asset.filename)}">
    <label class="thumb-check"><input type="checkbox" class="thumb-checkbox" data-id="${asset.id}"${checked}><span class="thumb-check-mark"></span></label>
    ${media}${badge}</div>`
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
    bindOverlayTagging(full)
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

  const taggedPeople = full?.people ?? []
  const taggedEvents = full?.events ?? []

  const peopleChips = taggedPeople
    .map(p => `<span class="tag tag-removable" data-person-id="${p.id}">${escHtml(p.name)}<button class="tag-x" data-person-id="${p.id}" aria-label="Remove ${escHtml(p.name)}">×</button></span>`)
    .join('')

  const eventChips = taggedEvents
    .map(e => `<span class="tag event-tag tag-removable" data-event-id="${e.id}">${escHtml(e.title)}<button class="tag-x tag-x-event" data-event-id="${e.id}" aria-label="Remove ${escHtml(e.title)}">×</button></span>`)
    .join('')

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

  const precisionOptions = ['exact', 'day', 'month', 'year', 'circa', 'unknown']
  const precisionSelect = precisionOptions
    .map(p => `<option value="${p}"${asset.date_precision === p ? ' selected' : ''}>${precisionLabel(p)}</option>`)
    .join('')

  const hasDate = asset.taken_at && asset.date_precision !== 'unknown'
  const dateDisplay = hasDate
    ? `<div id="date-display">
        <span class="tag tag-removable date-tag">${escHtml(formatDate(asset))}<button class="tag-x" id="date-remove" aria-label="Remove date">×</button></span>
       </div>`
    : `<button class="tag-add-btn" id="date-add-btn">+ Add date</button>`

  return `
    <div class="asset-detail">
      <div class="asset-media">${mediaHtml}</div>
      <div class="asset-info">
        <div class="asset-info-title">${escHtml(asset.original_name || asset.filename)}</div>

        <div class="asset-info-section">
          <div class="asset-info-label">Date</div>
          <div id="date-section">
            ${dateDisplay}
            <div class="date-editor hidden" id="date-editor">
              <input type="text" class="date-editor-input" id="date-input"
                value="${escHtml(asset.taken_at || '')}"
                placeholder="e.g. 1987, 1987-06, 1987-06-14">
              <select class="date-editor-precision" id="date-precision">${precisionSelect}</select>
              <button class="btn btn-small btn-primary" id="date-save">Save</button>
              <button class="btn btn-small btn-ghost" id="date-cancel">Cancel</button>
            </div>
          </div>
        </div>

        <div class="asset-info-section">
          <div class="asset-info-label">People</div>
          <div class="tag-editor" id="people-tag-editor">
            <div class="tag-chips" id="people-chips">${peopleChips}</div>
            <button class="tag-add-btn" id="people-add-btn">+ Add people</button>
            <div class="tag-search-wrap hidden" id="people-search-wrap">
              <input type="text" class="tag-search-input" id="people-search" placeholder="Tag someone…" autocomplete="off">
              <div class="tag-dropdown hidden" id="people-dropdown"></div>
              <button class="btn btn-small btn-ghost" id="people-cancel">Cancel</button>
            </div>
          </div>
        </div>

        <div class="asset-info-section">
          <div class="asset-info-label">Event</div>
          <div class="tag-editor" id="event-tag-editor">
            <div class="tag-chips" id="event-chips">${eventChips}</div>
            <button class="tag-add-btn" id="event-add-btn">+ Add event</button>
            <div class="tag-search-wrap hidden" id="event-search-wrap">
              <input type="text" class="tag-search-input" id="event-search" placeholder="Add event…" autocomplete="off">
              <div class="tag-dropdown hidden" id="event-dropdown"></div>
              <button class="btn btn-small btn-ghost" id="event-cancel">Cancel</button>
            </div>
          </div>
        </div>

        ${location}
        ${notes}

        <div class="asset-info-meta">
          ${asset.width && asset.height ? `${asset.width} × ${asset.height}px<br>` : ''}
          ${asset.file_size ? `${(asset.file_size / (1024 * 1024)).toFixed(1)} MB<br>` : ''}
          ${asset.mime_type ? `${asset.mime_type}<br>` : ''}
        </div>

        <button class="btn-delete-asset" id="btn-delete-asset" data-id="${asset.id}">Delete item</button>
      </div>
    </div>`
}

// ─── Overlay tagging (people + events) ────────────────────────────────────────

async function bindOverlayTagging(asset: Asset): Promise<void> {
  // ── Date editing ──
  const dateSection = document.getElementById('date-section')!
  const dateEditor = document.getElementById('date-editor')!
  const dateInput = document.getElementById('date-input') as HTMLInputElement
  const datePrecision = document.getElementById('date-precision') as HTMLSelectElement

  function showEditor(): void {
    document.getElementById('date-display')?.classList.add('hidden')
    document.getElementById('date-add-btn')?.classList.add('hidden')
    dateEditor.classList.remove('hidden')
    dateInput.focus()
  }

  function rebuildDateDisplay(): void {
    const hasDate = asset.taken_at && asset.date_precision !== 'unknown'
    const displayEl = document.getElementById('date-display')
    const addBtn = document.getElementById('date-add-btn')

    if (hasDate) {
      if (displayEl) {
        displayEl.innerHTML = `<span class="tag tag-removable date-tag">${escHtml(formatDate(asset))}<button class="tag-x" id="date-remove" aria-label="Remove date">×</button></span>`
        displayEl.classList.remove('hidden')
        bindDateRemove()
      } else {
        addBtn?.remove()
        const div = document.createElement('div')
        div.id = 'date-display'
        div.innerHTML = `<span class="tag tag-removable date-tag">${escHtml(formatDate(asset))}<button class="tag-x" id="date-remove" aria-label="Remove date">×</button></span>`
        dateSection.insertBefore(div, dateEditor)
        bindDateRemove()
      }
    } else {
      displayEl?.remove()
      if (!document.getElementById('date-add-btn')) {
        const btn = document.createElement('button')
        btn.className = 'tag-add-btn'
        btn.id = 'date-add-btn'
        btn.textContent = '+ Add date'
        btn.addEventListener('click', showEditor)
        dateSection.insertBefore(btn, dateEditor)
      } else {
        addBtn!.classList.remove('hidden')
      }
    }
    dateEditor.classList.add('hidden')
  }

  function bindDateRemove(): void {
    document.getElementById('date-remove')?.addEventListener('click', async () => {
      try {
        await api.assets.update(asset.id, { taken_at: null, date_precision: 'unknown' })
        asset.taken_at = null
        asset.date_precision = 'unknown'
        dateInput.value = ''
        datePrecision.value = 'unknown'
        rebuildDateDisplay()
      } catch { alert('Failed to remove date.') }
    })
  }

  document.getElementById('date-add-btn')?.addEventListener('click', showEditor)
  document.getElementById('date-display')?.addEventListener('click', (e) => {
    if (!(e.target as HTMLElement).closest('.tag-x')) showEditor()
  })
  bindDateRemove()

  document.getElementById('date-cancel')?.addEventListener('click', () => {
    dateInput.value = asset.taken_at || ''
    datePrecision.value = asset.date_precision || 'unknown'
    rebuildDateDisplay()
  })

  document.getElementById('date-save')?.addEventListener('click', async () => {
    const taken_at = dateInput.value.trim() || null
    const date_precision = datePrecision.value
    try {
      await api.assets.update(asset.id, { taken_at, date_precision })
      asset.taken_at = taken_at
      asset.date_precision = date_precision
      rebuildDateDisplay()
      showToast('Date added')
    } catch {
      alert('Failed to save date.')
    }
  })

  const allPeople = await getPeople()
  const allEvents = await getEvents()
  const taggedPeopleIds = new Set((asset.people ?? []).map(p => p.id))
  const taggedEventIds = new Set((asset.events ?? []).map(e => e.id))

  // ── People tagging ──
  const peopleSearch = document.getElementById('people-search') as HTMLInputElement
  const peopleDropdown = document.getElementById('people-dropdown')!
  const peopleAddBtn = document.getElementById('people-add-btn')!
  const peopleSearchWrap = document.getElementById('people-search-wrap')!

  function showPeopleEditor(): void {
    peopleAddBtn.classList.add('hidden')
    peopleSearchWrap.classList.remove('hidden')
    peopleSearch.value = ''
    peopleSearch.focus()
  }
  function hidePeopleEditor(): void {
    peopleSearchWrap.classList.add('hidden')
    peopleDropdown.classList.add('hidden')
    peopleAddBtn.classList.remove('hidden')
  }

  peopleAddBtn.addEventListener('click', showPeopleEditor)
  document.getElementById('people-cancel')!.addEventListener('click', hidePeopleEditor)

  peopleSearch.addEventListener('focus', () => showPeopleDropdown(''))
  peopleSearch.addEventListener('input', () => showPeopleDropdown(peopleSearch.value))

  function showPeopleDropdown(query: string): void {
    const q = query.toLowerCase().trim()
    const available = allPeople.filter(p => !taggedPeopleIds.has(p.id))
    const matches = q
      ? available.filter(p => p.name.toLowerCase().includes(q))
      : available

    let html = matches.slice(0, 10)
      .map(p => `<button class="tag-dropdown-item" data-person-id="${p.id}">${escHtml(p.name)}</button>`)
      .join('')

    if (q && !matches.some(p => p.name.toLowerCase() === q)) {
      html += `<button class="tag-dropdown-item tag-dropdown-create" data-create-person="${escHtml(q)}">+ Add "${escHtml(q)}"</button>`
    }

    if (!html) {
      html = `<div class="tag-dropdown-empty">Type a name to add</div>`
    }

    peopleDropdown.innerHTML = html
    peopleDropdown.classList.remove('hidden')

    peopleDropdown.querySelectorAll<HTMLButtonElement>('[data-person-id]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const pid = btn.dataset.personId!
        taggedPeopleIds.add(pid)
        await savePeople()
        const person = allPeople.find(p => p.id === pid)
        if (person) addChip('people', person.id, person.name)
        hidePeopleEditor()
      })
    })

    peopleDropdown.querySelectorAll<HTMLButtonElement>('[data-create-person]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const name = btn.dataset.createPerson!
        const created = await api.people.create({ name })
        invalidatePeopleCache()
        allPeople.push({ id: created.id, name: created.name, born_on: null, born_on_precision: 'unknown', died_on: null, notes: null })
        taggedPeopleIds.add(created.id)
        await savePeople()
        addChip('people', created.id, created.name)
        hidePeopleEditor()
      })
    })
  }

  async function savePeople(): Promise<void> {
    await api.assets.update(asset.id, { person_ids: Array.from(taggedPeopleIds).join(',') })
  }

  // Remove people chips
  document.getElementById('people-chips')!.addEventListener('click', async (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-person-id]')
    if (!btn || !btn.classList.contains('tag-x')) return
    const pid = btn.dataset.personId!
    taggedPeopleIds.delete(pid)
    await savePeople()
    btn.closest('.tag')?.remove()
  })

  // ── Event tagging ──
  const eventSearch = document.getElementById('event-search') as HTMLInputElement
  const eventDropdown = document.getElementById('event-dropdown')!
  const eventAddBtn = document.getElementById('event-add-btn')!
  const eventSearchWrap = document.getElementById('event-search-wrap')!

  function showEventEditor(): void {
    eventAddBtn.classList.add('hidden')
    eventSearchWrap.classList.remove('hidden')
    eventSearch.value = ''
    eventSearch.focus()
  }
  function hideEventEditor(): void {
    eventSearchWrap.classList.add('hidden')
    eventDropdown.classList.add('hidden')
    eventAddBtn.classList.remove('hidden')
  }

  eventAddBtn.addEventListener('click', showEventEditor)
  document.getElementById('event-cancel')!.addEventListener('click', hideEventEditor)

  eventSearch.addEventListener('focus', () => showEventDropdown(''))
  eventSearch.addEventListener('input', () => showEventDropdown(eventSearch.value))

  function showEventDropdown(query: string): void {
    const q = query.toLowerCase().trim()
    const available = allEvents.filter(e => !taggedEventIds.has(e.id))
    const matches = q
      ? available.filter(e => e.title.toLowerCase().includes(q))
      : available

    let html = matches.slice(0, 10)
      .map(e => `<button class="tag-dropdown-item" data-event-id="${e.id}">${escHtml(e.title)}</button>`)
      .join('')

    if (q && !matches.some(e => e.title.toLowerCase() === q)) {
      html += `<button class="tag-dropdown-item tag-dropdown-create" data-create-event="${escHtml(q)}">+ Create "${escHtml(q)}"</button>`
    }

    if (!html) {
      html = `<div class="tag-dropdown-empty">Type an event name</div>`
    }

    eventDropdown.innerHTML = html
    eventDropdown.classList.remove('hidden')

    eventDropdown.querySelectorAll<HTMLButtonElement>('[data-event-id]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const eid = btn.dataset.eventId!
        taggedEventIds.add(eid)
        await saveEvent()
        const ev = allEvents.find(e => e.id === eid)
        if (ev) addChip('event', ev.id, ev.title)
        hideEventEditor()
      })
    })

    eventDropdown.querySelectorAll<HTMLButtonElement>('[data-create-event]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const title = btn.dataset.createEvent!
        const created = await api.events.create({ title })
        invalidateEventsCache()
        allEvents.push({ id: created.id, title: created.title, started_on: null, ended_on: null, location: null, notes: null })
        taggedEventIds.add(created.id)
        await saveEvent()
        addChip('event', created.id, created.title)
        hideEventEditor()
      })
    })
  }

  async function saveEvent(): Promise<void> {
    // The PATCH endpoint replaces all event links; send the first one via event_id
    const ids = Array.from(taggedEventIds)
    await api.assets.update(asset.id, { event_id: ids[0] || '' })
  }

  // Remove event chips
  document.getElementById('event-chips')!.addEventListener('click', async (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-event-id]')
    if (!btn || !btn.classList.contains('tag-x')) return
    const eid = btn.dataset.eventId!
    taggedEventIds.delete(eid)
    await saveEvent()
    btn.closest('.tag')?.remove()
  })

  // Close dropdowns on click outside
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement
    if (!target.closest('#people-tag-editor')) peopleDropdown.classList.add('hidden')
    if (!target.closest('#event-tag-editor')) eventDropdown.classList.add('hidden')
  }, { once: false })

  // ── Delete button ──
  document.getElementById('btn-delete-asset')?.addEventListener('click', async () => {
    if (!confirm(`Delete "${asset.original_name || asset.filename}"? This cannot be undone.`)) return
    try {
      await api.assets.delete(asset.id)
      filteredAssets.splice(currentIndex, 1)
      selectedAssetIds.delete(asset.id)
      closeOverlay()
      await applyFilters()
    } catch {
      alert('Failed to delete item.')
    }
  })
}

function addChip(type: 'people' | 'event', id: string, label: string): void {
  const container = document.getElementById(`${type}-chips`)!
  const idAttr = type === 'people' ? 'person-id' : 'event-id'
  const tagClass = type === 'event' ? 'tag event-tag tag-removable' : 'tag tag-removable'
  const xClass = type === 'event' ? 'tag-x tag-x-event' : 'tag-x'
  const chip = document.createElement('span')
  chip.className = tagClass
  chip.dataset[type === 'people' ? 'personId' : 'eventId'] = id
  chip.innerHTML = `${escHtml(label)}<button class="${xClass}" data-${idAttr}="${id}" aria-label="Remove ${escHtml(label)}">×</button>`
  container.appendChild(chip)
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

function readFilterState(): FilterState {
  return {
    q: (document.getElementById('search-input') as HTMLInputElement).value.trim(),
    personIds: [...selectedPersonIds],
    eventIds: [...selectedEventIds],
    from: (document.getElementById('filter-from') as HTMLInputElement).value,
    to: (document.getElementById('filter-to') as HTMLInputElement).value,
  }
}

function bindFilters(): void {
  const search = document.getElementById('search-input') as HTMLInputElement
  const from = document.getElementById('filter-from') as HTMLInputElement
  const to = document.getElementById('filter-to') as HTMLInputElement

  search.addEventListener('input', () => {
    if (searchTimeout) clearTimeout(searchTimeout)
    searchTimeout = setTimeout(() => applyFilters(), 300)
  })

  from.addEventListener('change', applyFilters)
  to.addEventListener('change', applyFilters)

  // ── Person chip multiselect ──
  bindChipSelect({
    inputId: 'filter-person-input',
    dropdownId: 'filter-person-dropdown',
    chipsId: 'filter-person-chips',
    wrapId: 'filter-person-wrap',
    getAll: getPeople,
    getSelected: () => selectedPersonIds,
    getLabel: p => p.name,
    chipClass: 'filter-chip',
    onAdd(id) { selectedPersonIds.push(id); renderPersonChips(); applyFilters() },
    onRemove(id) { selectedPersonIds = selectedPersonIds.filter(x => x !== id); renderPersonChips(); applyFilters() },
  })

  // ── Event chip multiselect ──
  bindChipSelect({
    inputId: 'filter-event-input',
    dropdownId: 'filter-event-dropdown',
    chipsId: 'filter-event-chips',
    wrapId: 'filter-event-wrap',
    getAll: getEvents,
    getSelected: () => selectedEventIds,
    getLabel: e => e.title,
    chipClass: 'filter-chip filter-chip-event',
    onAdd(id) { selectedEventIds.push(id); renderEventChips(); applyFilters() },
    onRemove(id) { selectedEventIds = selectedEventIds.filter(x => x !== id); renderEventChips(); applyFilters() },
  })

  // Clear filters button
  document.getElementById('clear-filters')!.addEventListener('click', () => {
    search.value = ''
    from.value = ''
    to.value = ''
    selectedPersonIds = []
    selectedEventIds = []
    renderFilterChips()
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
    ;(document.getElementById('search-input') as HTMLInputElement).value = state.q
    ;(document.getElementById('filter-from') as HTMLInputElement).value = state.from
    ;(document.getElementById('filter-to') as HTMLInputElement).value = state.to
    selectedPersonIds = state.personIds
    selectedEventIds = state.eventIds
    renderFilterChips()
    applyFilters()
  })
}

interface ChipSelectConfig<T extends { id: string }> {
  inputId: string
  dropdownId: string
  chipsId: string
  wrapId: string
  getAll: () => Promise<T[]>
  getSelected: () => string[]
  getLabel: (item: T) => string
  chipClass: string
  onAdd: (id: string) => void
  onRemove: (id: string) => void
}

function bindChipSelect<T extends { id: string }>(cfg: ChipSelectConfig<T>): void {
  const input = document.getElementById(cfg.inputId) as HTMLInputElement
  const dropdown = document.getElementById(cfg.dropdownId)!
  const chipsEl = document.getElementById(cfg.chipsId)!
  const wrap = document.getElementById(cfg.wrapId)!

  // Click the wrapper to focus the input
  wrap.addEventListener('click', () => input.focus())

  input.addEventListener('focus', () => showDropdown(''))
  input.addEventListener('input', () => showDropdown(input.value))

  async function showDropdown(query: string): Promise<void> {
    const all = await cfg.getAll()
    const selected = new Set(cfg.getSelected())
    const q = query.toLowerCase().trim()
    const available = all.filter(item => !selected.has(item.id))
    const matches = q
      ? available.filter(item => cfg.getLabel(item).toLowerCase().includes(q))
      : available

    if (matches.length === 0) {
      dropdown.innerHTML = `<div class="tag-dropdown-empty">No matches</div>`
      dropdown.classList.remove('hidden')
      return
    }

    dropdown.innerHTML = matches.slice(0, 12)
      .map(item => `<button class="tag-dropdown-item" data-id="${item.id}">${escHtml(cfg.getLabel(item))}</button>`)
      .join('')
    dropdown.classList.remove('hidden')

    dropdown.querySelectorAll<HTMLButtonElement>('[data-id]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        cfg.onAdd(btn.dataset.id!)
        input.value = ''
        dropdown.classList.add('hidden')
      })
    })
  }

  // Remove chips via delegation
  chipsEl.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.filter-chip-x')
    if (!btn) return
    e.stopPropagation()
    cfg.onRemove(btn.dataset.id!)
  })

  // Close dropdown on click outside
  document.addEventListener('click', (e) => {
    if (!(e.target as HTMLElement).closest(`#${cfg.wrapId}`)) {
      dropdown.classList.add('hidden')
    }
  })
}

async function applyFilters(): Promise<void> {
  const state = readFilterState()
  const isFiltered = hasActiveFilters(state)

  pushFiltersToURL(state)

  const content = document.getElementById('timeline-content')!
  content.innerHTML = `<div class="state-loading">${state.q ? 'Searching…' : 'Loading memories…'}</div>`

  try {
    filteredAssets = await executeSearch(state)
    await updateFilterStatus(state, filteredAssets.length)
    renderTimeline(filteredAssets, isFiltered)
  } catch {
    content.innerHTML = '<div class="state-loading">Could not load assets.</div>'
  }
}

// ─── Bulk selection bar + modal ───────────────────────────────────────────────

function updateSelectionBar(): void {
  let bar = document.getElementById('selection-bar')
  const count = selectedAssetIds.size

  if (count === 0) {
    bar?.remove()
    return
  }

  if (!bar) {
    bar = document.createElement('div')
    bar.id = 'selection-bar'
    bar.className = 'selection-bar'
    document.body.appendChild(bar)
  }

  bar.innerHTML = `
    <span class="selection-bar-text">${count} selected</span>
    <button class="btn btn-primary selection-bar-btn" id="bulk-tag-btn">Tag people &amp; events</button>
    <button class="btn btn-danger selection-bar-btn" id="bulk-delete-btn">Delete</button>
    <button class="btn btn-ghost selection-bar-btn" id="bulk-deselect-btn">Deselect all</button>`

  document.getElementById('bulk-tag-btn')!.addEventListener('click', openBulkTagModal)
  document.getElementById('bulk-delete-btn')!.addEventListener('click', bulkDelete)
  document.getElementById('bulk-deselect-btn')!.addEventListener('click', () => {
    selectedAssetIds.clear()
    document.querySelectorAll<HTMLElement>('.thumb-item.selected').forEach(el => el.classList.remove('selected'))
    document.querySelectorAll<HTMLInputElement>('.thumb-checkbox:checked').forEach(cb => { cb.checked = false })
    updateSelectionBar()
  })
}

async function bulkDelete(): Promise<void> {
  const count = selectedAssetIds.size
  if (!confirm(`Delete ${count} item${count !== 1 ? 's' : ''}? This cannot be undone.`)) return

  const ids = Array.from(selectedAssetIds)
  let failed = 0
  for (const id of ids) {
    try {
      await api.assets.delete(id)
    } catch {
      failed++
    }
  }
  selectedAssetIds.clear()
  updateSelectionBar()
  await applyFilters()
  if (failed > 0) alert(`${failed} item${failed !== 1 ? 's' : ''} could not be deleted.`)
}

async function openBulkTagModal(): Promise<void> {
  const allPeople = await getPeople()
  const allEvents = await getEvents()
  const bulkPeopleIds: string[] = []
  const bulkEventIds: string[] = []

  // Create modal
  let modal = document.getElementById('bulk-tag-modal')
  if (modal) modal.remove()

  modal = document.createElement('div')
  modal.id = 'bulk-tag-modal'
  modal.className = 'overlay'
  modal.setAttribute('role', 'dialog')
  modal.innerHTML = `
    <div class="overlay-backdrop" id="bulk-tag-backdrop"></div>
    <div class="upload-panel">
      <button class="overlay-close" id="bulk-tag-close">×</button>
      <h2 class="upload-title">Tag ${selectedAssetIds.size} item${selectedAssetIds.size !== 1 ? 's' : ''}</h2>

      <div class="asset-info-section">
        <div class="asset-info-label">People</div>
        <div class="tag-editor" id="bulk-people-editor">
          <div class="tag-chips" id="bulk-people-chips"></div>
          <div class="tag-add-row">
            <div class="tag-search-wrap">
              <input type="text" class="tag-search-input" id="bulk-people-search" placeholder="Tag someone…" autocomplete="off">
              <div class="tag-dropdown hidden" id="bulk-people-dropdown"></div>
            </div>
          </div>
        </div>
      </div>

      <div class="asset-info-section" style="margin-top:16px">
        <div class="asset-info-label">Event</div>
        <div class="tag-editor" id="bulk-event-editor">
          <div class="tag-chips" id="bulk-event-chips"></div>
          <div class="tag-add-row">
            <div class="tag-search-wrap">
              <input type="text" class="tag-search-input" id="bulk-event-search" placeholder="Add event…" autocomplete="off">
              <div class="tag-dropdown hidden" id="bulk-event-dropdown"></div>
            </div>
          </div>
        </div>
      </div>

      <div class="btn-row" style="margin-top:20px">
        <button class="btn btn-ghost" id="bulk-tag-cancel">Cancel</button>
        <button class="btn btn-primary" id="bulk-tag-apply">Apply to ${selectedAssetIds.size} items</button>
      </div>

      <div id="bulk-tag-progress" class="upload-progress" style="display:none">
        <span id="bulk-tag-progress-text"></span>
        <div class="progress-bar"><div class="progress-bar-fill" id="bulk-tag-fill"></div></div>
      </div>
    </div>`

  document.body.appendChild(modal)
  document.body.style.overflow = 'hidden'

  const closeBulk = () => { modal!.remove(); document.body.style.overflow = '' }
  document.getElementById('bulk-tag-backdrop')!.addEventListener('click', closeBulk)
  document.getElementById('bulk-tag-close')!.addEventListener('click', closeBulk)
  document.getElementById('bulk-tag-cancel')!.addEventListener('click', closeBulk)

  // ── People tagging ──
  const pSearch = document.getElementById('bulk-people-search') as HTMLInputElement
  const pDropdown = document.getElementById('bulk-people-dropdown')!

  pSearch.addEventListener('focus', () => showBulkPeople(''))
  pSearch.addEventListener('input', () => showBulkPeople(pSearch.value))

  function showBulkPeople(query: string): void {
    const q = query.toLowerCase().trim()
    const selected = new Set(bulkPeopleIds)
    const available = allPeople.filter(p => !selected.has(p.id))
    const matches = q ? available.filter(p => p.name.toLowerCase().includes(q)) : available

    let html = matches.slice(0, 10)
      .map(p => `<button class="tag-dropdown-item" data-pid="${p.id}">${escHtml(p.name)}</button>`)
      .join('')

    if (q && !matches.some(p => p.name.toLowerCase() === q)) {
      html += `<button class="tag-dropdown-item tag-dropdown-create" data-create-name="${escHtml(q)}">+ Add "${escHtml(q)}"</button>`
    }
    if (!html) html = `<div class="tag-dropdown-empty">No people found</div>`

    pDropdown.innerHTML = html
    pDropdown.classList.remove('hidden')

    pDropdown.querySelectorAll<HTMLButtonElement>('[data-pid]').forEach(btn => {
      btn.addEventListener('click', () => {
        bulkPeopleIds.push(btn.dataset.pid!)
        renderBulkPeopleChips()
        pSearch.value = ''
        pDropdown.classList.add('hidden')
      })
    })
    pDropdown.querySelectorAll<HTMLButtonElement>('[data-create-name]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const created = await api.people.create({ name: btn.dataset.createName! })
        invalidatePeopleCache()
        allPeople.push({ id: created.id, name: created.name, born_on: null, born_on_precision: 'unknown', died_on: null, notes: null })
        bulkPeopleIds.push(created.id)
        renderBulkPeopleChips()
        pSearch.value = ''
        pDropdown.classList.add('hidden')
      })
    })
  }

  function renderBulkPeopleChips(): void {
    document.getElementById('bulk-people-chips')!.innerHTML = bulkPeopleIds
      .map(id => {
        const p = allPeople.find(x => x.id === id)
        return `<span class="tag tag-removable" data-rid="${id}">${escHtml(p?.name || id)}<button class="tag-x" data-rid="${id}">×</button></span>`
      }).join('')
  }

  document.getElementById('bulk-people-chips')!.addEventListener('click', e => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.tag-x')
    if (!btn) return
    const idx = bulkPeopleIds.indexOf(btn.dataset.rid!)
    if (idx !== -1) bulkPeopleIds.splice(idx, 1)
    renderBulkPeopleChips()
  })

  // ── Event tagging ──
  const eSearch = document.getElementById('bulk-event-search') as HTMLInputElement
  const eDropdown = document.getElementById('bulk-event-dropdown')!

  eSearch.addEventListener('focus', () => showBulkEvents(''))
  eSearch.addEventListener('input', () => showBulkEvents(eSearch.value))

  function showBulkEvents(query: string): void {
    const q = query.toLowerCase().trim()
    const selected = new Set(bulkEventIds)
    const available = allEvents.filter(e => !selected.has(e.id))
    const matches = q ? available.filter(e => e.title.toLowerCase().includes(q)) : available

    let html = matches.slice(0, 10)
      .map(e => `<button class="tag-dropdown-item" data-eid="${e.id}">${escHtml(e.title)}</button>`)
      .join('')

    if (q && !matches.some(e => e.title.toLowerCase() === q)) {
      html += `<button class="tag-dropdown-item tag-dropdown-create" data-create-title="${escHtml(q)}">+ Create "${escHtml(q)}"</button>`
    }
    if (!html) html = `<div class="tag-dropdown-empty">No events found</div>`

    eDropdown.innerHTML = html
    eDropdown.classList.remove('hidden')

    eDropdown.querySelectorAll<HTMLButtonElement>('[data-eid]').forEach(btn => {
      btn.addEventListener('click', () => {
        bulkEventIds.push(btn.dataset.eid!)
        renderBulkEventChips()
        eSearch.value = ''
        eDropdown.classList.add('hidden')
      })
    })
    eDropdown.querySelectorAll<HTMLButtonElement>('[data-create-title]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const created = await api.events.create({ title: btn.dataset.createTitle! })
        invalidateEventsCache()
        allEvents.push({ id: created.id, title: created.title, started_on: null, ended_on: null, location: null, notes: null })
        bulkEventIds.push(created.id)
        renderBulkEventChips()
        eSearch.value = ''
        eDropdown.classList.add('hidden')
      })
    })
  }

  function renderBulkEventChips(): void {
    document.getElementById('bulk-event-chips')!.innerHTML = bulkEventIds
      .map(id => {
        const e = allEvents.find(x => x.id === id)
        return `<span class="tag event-tag tag-removable" data-rid="${id}">${escHtml(e?.title || id)}<button class="tag-x tag-x-event" data-rid="${id}">×</button></span>`
      }).join('')
  }

  document.getElementById('bulk-event-chips')!.addEventListener('click', e => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.tag-x')
    if (!btn) return
    const idx = bulkEventIds.indexOf(btn.dataset.rid!)
    if (idx !== -1) bulkEventIds.splice(idx, 1)
    renderBulkEventChips()
  })

  // Close dropdowns on outside click
  modal.addEventListener('click', e => {
    const t = e.target as HTMLElement
    if (!t.closest('#bulk-people-editor')) pDropdown.classList.add('hidden')
    if (!t.closest('#bulk-event-editor')) eDropdown.classList.add('hidden')
  })

  // ── Apply ──
  document.getElementById('bulk-tag-apply')!.addEventListener('click', async () => {
    if (bulkPeopleIds.length === 0 && bulkEventIds.length === 0) { closeBulk(); return }

    const applyBtn = document.getElementById('bulk-tag-apply') as HTMLButtonElement
    applyBtn.disabled = true

    const progressDiv = document.getElementById('bulk-tag-progress')!
    const progressText = document.getElementById('bulk-tag-progress-text')!
    const progressFill = document.getElementById('bulk-tag-fill')!
    progressDiv.style.display = 'block'

    const ids = Array.from(selectedAssetIds)
    let done = 0

    for (const assetId of ids) {
      progressText.textContent = `Tagging ${done + 1} of ${ids.length}…`
      progressFill.style.width = `${Math.round((done / ids.length) * 100)}%`

      // Fetch current people/events for this asset so we merge, not replace
      const current = await api.assets.get(assetId)
      const currentPeople = (current.people ?? []).map(p => p.id)
      const currentEvents = (current.events ?? []).map(e => e.id)

      const mergedPeople = Array.from(new Set([...currentPeople, ...bulkPeopleIds]))
      const mergedEvent = bulkEventIds.length > 0
        ? Array.from(new Set([...currentEvents, ...bulkEventIds]))[0]
        : undefined

      const update: Record<string, unknown> = {}
      if (bulkPeopleIds.length > 0) update.person_ids = mergedPeople.join(',')
      if (mergedEvent) update.event_id = mergedEvent

      await api.assets.update(assetId, update)
      done++
    }

    progressFill.style.width = '100%'
    progressText.textContent = `Done! Tagged ${ids.length} item${ids.length !== 1 ? 's' : ''}.`

    setTimeout(() => {
      closeBulk()
      selectedAssetIds.clear()
      updateSelectionBar()
      applyFilters()
    }, 800)
  })
}

export function destroy(): void {
  selectedAssetIds.clear()
  lastCheckedIndex = null
  document.getElementById('selection-bar')?.remove()
}

// ─── Util ─────────────────────────────────────────────────────────────────────

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function showToast(message: string): void {
  const existing = document.getElementById('toast')
  if (existing) existing.remove()
  const toast = document.createElement('div')
  toast.id = 'toast'
  toast.className = 'toast'
  toast.textContent = message
  document.body.appendChild(toast)
  requestAnimationFrame(() => toast.classList.add('toast-visible'))
  setTimeout(() => {
    toast.classList.remove('toast-visible')
    setTimeout(() => toast.remove(), 300)
  }, 2000)
}
