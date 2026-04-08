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
  personIds: string[]
  eventIds: string[]
  from: string
  to: string
}

export function hasActiveFilters(state: FilterState): boolean {
  return !!(state.q || state.personIds.length || state.eventIds.length || state.from || state.to)
}

export function clearFilterState(): FilterState {
  return { q: '', personIds: [], eventIds: [], from: '', to: '' }
}

// ─── URL param sync ───────────────────────────────────────────────────────────

export function readFiltersFromURL(): FilterState {
  const params = new URLSearchParams(window.location.search)
  return {
    q: params.get('q') || '',
    personIds: params.get('person')?.split(',').filter(Boolean) || [],
    eventIds: params.get('event')?.split(',').filter(Boolean) || [],
    from: params.get('from') || '',
    to: params.get('to') || '',
  }
}

export function pushFiltersToURL(state: FilterState): void {
  const params = new URLSearchParams()
  if (state.q) params.set('q', state.q)
  if (state.personIds.length) params.set('person', state.personIds.join(','))
  if (state.eventIds.length) params.set('event', state.eventIds.join(','))
  if (state.from) params.set('from', state.from)
  if (state.to) params.set('to', state.to)
  const search = params.toString()
  const url = search ? `?${search}` : window.location.pathname
  window.history.replaceState(null, '', url)
}

// ─── Filter status bar ───────────────────────────────────────────────────────

export async function updateFilterStatus(state: FilterState, resultCount: number): Promise<void> {
  const statusEl = document.getElementById('filter-status')!
  const textEl = document.getElementById('filter-status-text')!

  if (!hasActiveFilters(state)) {
    statusEl.classList.add('hidden')
    return
  }

  statusEl.classList.remove('hidden')

  const parts: string[] = []
  if (state.q) parts.push(`"${state.q}"`)

  if (state.personIds.length) {
    const allPeople = await getPeople()
    const names = state.personIds
      .map(id => allPeople.find(p => p.id === id)?.name || id)
    parts.push(names.join(', '))
  }

  if (state.eventIds.length) {
    const allEvents = await getEvents()
    const titles = state.eventIds
      .map(id => allEvents.find(e => e.id === id)?.title || id)
    parts.push(titles.join(', '))
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
  if (state.personIds.length) params.person = state.personIds.join(',')
  if (state.eventIds.length) params.event = state.eventIds.join(',')
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
