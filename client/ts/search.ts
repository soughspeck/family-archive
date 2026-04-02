import { api, Person, ArchiveEvent, Asset, AssetsResponse } from './api.js'

// ─── Cached reference data (loaded once) ──────────────────────────────────────

let cachedPeople: Person[] | null = null
let cachedEvents: ArchiveEvent[] | null = null

export async function getPeople(): Promise<Person[]> {
  if (!cachedPeople) cachedPeople = await api.people.list().catch(() => [])
  return cachedPeople
}

export async function getEvents(): Promise<ArchiveEvent[]> {
  if (!cachedEvents) cachedEvents = await api.events.list().catch(() => [])
  return cachedEvents
}

export function invalidatePeopleCache(): void { cachedPeople = null }
export function invalidateEventsCache(): void { cachedEvents = null }

// ─── Filter state ─────────────────────────────────────────────────────────────

export interface FilterState {
  q: string
  person: string
  event: string
  from: string
  to: string
}

export function readFiltersFromDOM(): FilterState {
  return {
    q: (document.getElementById('search-input') as HTMLInputElement).value.trim(),
    person: (document.getElementById('filter-person') as HTMLSelectElement).value,
    event: (document.getElementById('filter-event') as HTMLSelectElement).value,
    from: (document.getElementById('filter-from') as HTMLInputElement).value,
    to: (document.getElementById('filter-to') as HTMLInputElement).value,
  }
}

export function writeFiltersToDom(state: FilterState): void {
  ;(document.getElementById('search-input') as HTMLInputElement).value = state.q
  ;(document.getElementById('filter-person') as HTMLSelectElement).value = state.person
  ;(document.getElementById('filter-event') as HTMLSelectElement).value = state.event
  ;(document.getElementById('filter-from') as HTMLInputElement).value = state.from
  ;(document.getElementById('filter-to') as HTMLInputElement).value = state.to
}

export function hasActiveFilters(state: FilterState): boolean {
  return !!(state.q || state.person || state.event || state.from || state.to)
}

export function clearFilterState(): FilterState {
  return { q: '', person: '', event: '', from: '', to: '' }
}

// ─── URL param sync ───────────────────────────────────────────────────────────

const PARAM_MAP: Record<keyof FilterState, string> = {
  q: 'q',
  person: 'person',
  event: 'event',
  from: 'from',
  to: 'to',
}

export function readFiltersFromURL(): FilterState {
  const params = new URLSearchParams(window.location.search)
  return {
    q: params.get('q') || '',
    person: params.get('person') || '',
    event: params.get('event') || '',
    from: params.get('from') || '',
    to: params.get('to') || '',
  }
}

export function pushFiltersToURL(state: FilterState): void {
  const params = new URLSearchParams()
  for (const [key, paramName] of Object.entries(PARAM_MAP)) {
    const val = state[key as keyof FilterState]
    if (val) params.set(paramName, val)
  }
  const search = params.toString()
  const url = search ? `?${search}` : window.location.pathname
  window.history.replaceState(null, '', url)
}

// ─── Filter status bar ───────────────────────────────────────────────────────

export function updateFilterStatus(state: FilterState, resultCount: number): void {
  const statusEl = document.getElementById('filter-status')!
  const textEl = document.getElementById('filter-status-text')!

  if (!hasActiveFilters(state)) {
    statusEl.classList.add('hidden')
    return
  }

  statusEl.classList.remove('hidden')

  const parts: string[] = []
  if (state.q) parts.push(`"${state.q}"`)
  if (state.person) {
    const opt = (document.getElementById('filter-person') as HTMLSelectElement)
      .querySelector<HTMLOptionElement>(`option[value="${state.person}"]`)
    if (opt) parts.push(opt.textContent || state.person)
  }
  if (state.event) {
    const opt = (document.getElementById('filter-event') as HTMLSelectElement)
      .querySelector<HTMLOptionElement>(`option[value="${state.event}"]`)
    if (opt) parts.push(opt.textContent || state.event)
  }
  if (state.from && state.to) parts.push(`${state.from}–${state.to}`)
  else if (state.from) parts.push(`from ${state.from}`)
  else if (state.to) parts.push(`until ${state.to}`)

  const label = parts.length > 0 ? ` for ${parts.join(', ')}` : ''
  textEl.textContent = `${resultCount} result${resultCount !== 1 ? 's' : ''}${label}`
}

// ─── Execute search / filter ──────────────────────────────────────────────────

export async function executeSearch(state: FilterState): Promise<Asset[]> {
  const params: Record<string, string> = { limit: '500' }
  if (state.person) params.person = state.person
  if (state.event) params.event = state.event
  if (state.from) params.from = state.from
  if (state.to) params.to = state.to

  let response: AssetsResponse

  if (state.q) {
    response = await api.search({ q: state.q, ...params })
  } else {
    response = await api.assets.list(params)
  }

  return response.assets
}
