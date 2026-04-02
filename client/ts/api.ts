// Typed API wrappers for all server endpoints

export interface Asset {
  id: string
  filename: string
  original_name: string | null
  mime_type: string | null
  file_size: number | null
  local_path: string | null
  thumbnail_path: string | null
  taken_at: string | null
  taken_at_source: string | null
  date_precision: string
  width: number | null
  height: number | null
  duration_s: number | null
  orientation: number | null
  latitude: number | null
  longitude: number | null
  location_name: string | null
  notes: string | null
  visibility: string
  contributed_by: string | null
  created_at: string
  updated_at: string
  // joined fields (from /api/assets/:id)
  people?: Person[]
  events?: ArchiveEvent[]
  metadata?: AssetMetadata[]
}

export interface Person {
  id: string
  name: string
  born_on: string | null
  born_on_precision: string
  died_on: string | null
  notes: string | null
  asset_count?: number
}

export interface ArchiveEvent {
  id: string
  title: string
  started_on: string | null
  ended_on: string | null
  location: string | null
  notes: string | null
  asset_count?: number
}

export interface AssetMetadata {
  id: string
  asset_id: string
  key: string
  value: string
  source: string
  confidence: number
  added_by: string | null
  added_at: string
}

export interface AssetsResponse {
  assets: Asset[]
  total: number
  page: number
  limit: number
}

export interface DashboardStats {
  totals: { assets: number; people: number; events: number }
  queue: Record<string, number>
  recentActivity: Array<{ type: string; label: string; contributed_by: string; at: string }>
  byYear: Array<{ year: string; n: number }>
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

async function get<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL('/api' + path, window.location.origin)
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== '') url.searchParams.set(k, v)
    }
  }
  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json() as Promise<T>
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch('/api' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json() as Promise<T>
}

async function patch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch('/api' + path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json() as Promise<T>
}

// ─── API surface ──────────────────────────────────────────────────────────────

export const api = {
  health: () => get<{ ok: boolean; app: string }>('/health'),

  assets: {
    list: (params?: Record<string, string>) =>
      get<AssetsResponse>('/assets', params),
    get: (id: string) =>
      get<Asset>(`/assets/${id}`),
    update: (id: string, body: Record<string, unknown>) =>
      patch<{ ok: boolean }>(`/assets/${id}`, body),
    upload: (formData: FormData) =>
      fetch('/api/assets/upload', { method: 'POST', body: formData }).then(r => r.json()),
  },

  people: {
    list: () => get<Person[]>('/people'),
    create: (data: { name: string; born_on?: string; notes?: string }) =>
      post<{ id: string; name: string }>('/people', data),
  },

  events: {
    list: () => get<ArchiveEvent[]>('/events'),
    create: (data: { title: string; started_on?: string; location?: string }) =>
      post<{ id: string; title: string }>('/events', data),
  },

  search: (params: Record<string, string>) =>
    get<AssetsResponse>('/search', params),

  dashboard: {
    stats: () => get<DashboardStats>('/dashboard/stats'),
  },
}

// ─── URL helpers ──────────────────────────────────────────────────────────────

export function thumbnailUrl(asset: Asset): string | null {
  if (!asset.thumbnail_path) return null
  return `/uploads/${asset.thumbnail_path}`
}

export function originalUrl(asset: Asset): string | null {
  if (!asset.local_path) return null
  return `/uploads/${asset.local_path}`
}

export function formatDate(asset: Asset): string {
  if (!asset.taken_at) return 'Unknown date'
  const t = asset.taken_at
  const precision = asset.date_precision

  if (precision === 'year' || t.length === 4) return t

  if (precision === 'month' || t.length === 7) {
    const [year, month] = t.split('-')
    return new Date(parseInt(year), parseInt(month) - 1).toLocaleString('default', {
      month: 'long',
      year: 'numeric',
    })
  }

  try {
    const d = new Date(t)
    if (isNaN(d.getTime())) return t
    if (precision === 'exact') {
      return d.toLocaleDateString('default', { year: 'numeric', month: 'long', day: 'numeric' })
    }
    return d.toLocaleDateString('default', { year: 'numeric', month: 'long', day: 'numeric' })
  } catch {
    return t
  }
}

export function formatFileSize(bytes: number | null): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function mimeIcon(mimeType: string | null): string {
  if (!mimeType) return '📄'
  if (mimeType.startsWith('image/')) return '🖼'
  if (mimeType.startsWith('video/')) return '🎬'
  if (mimeType.startsWith('audio/')) return '🎵'
  return '📄'
}
