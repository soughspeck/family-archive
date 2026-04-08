import { api } from './api.js'
import { openUploadModal } from './upload.js'

export async function init(): Promise<void> {
  const app = document.getElementById('app')!
  app.innerHTML = '<div class="dashboard-content" id="dashboard-content"><div class="state-loading">Loading…</div></div>'

  try {
    const stats = await api.dashboard.stats()
    renderDashboard(stats)
  } catch {
    document.getElementById('dashboard-content')!.innerHTML = '<div class="state-loading">Could not load dashboard.</div>'
  }
}

export function destroy(): void {
  // nothing to clean up
}

function renderDashboard(stats: Awaited<ReturnType<typeof api.dashboard.stats>>): void {
  const content = document.getElementById('dashboard-content')!

  const noDate = stats.queue['no_date'] ?? 0
  const noPeople = stats.queue['no_people'] ?? 0

  const recentHtml = stats.recentActivity.length > 0
    ? stats.recentActivity.map(a => `
        <div class="activity-item">
          <div class="activity-dot"></div>
          <span class="activity-label">${escHtml(a.label || 'Unknown')}</span>
          <span class="activity-time">${formatRelativeTime(a.at)}</span>
        </div>`).join('')
    : '<div style="font-size:0.85rem;color:var(--text-3)">No activity yet.</div>'

  content.innerHTML = `
    <div class="dashboard-section">
      <div class="dashboard-section-title">Overview</div>
      <div class="stats-row">
        <div class="stat-card">
          <div class="stat-number">${stats.totals.assets}</div>
          <div class="stat-label">items</div>
        </div>
        <div class="stat-card">
          <div class="stat-number">${stats.totals.people}</div>
          <div class="stat-label">people</div>
        </div>
        <div class="stat-card">
          <div class="stat-number">${stats.totals.events}</div>
          <div class="stat-label">events</div>
        </div>
      </div>
    </div>

    <div class="dashboard-section">
      <div class="dashboard-section-title">Add memories</div>
      <button class="btn-upload" id="btn-open-upload">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M10 3v10M6 7l4-4 4 4"/>
          <path d="M3 14v1a2 2 0 002 2h10a2 2 0 002-2v-1"/>
        </svg>
        Upload photos &amp; files
      </button>
    </div>

    ${noDate + noPeople > 0 ? `
    <div class="dashboard-section">
      <div class="dashboard-section-title">Needs attention</div>
      <div class="attention-cards">
        ${noDate > 0 ? `
        <button class="attention-card" data-queue="no_date">
          <div class="attention-icon">📅</div>
          <div class="attention-text">
            <div class="attention-title">Missing dates</div>
            <div class="attention-sub">Photos without a date</div>
          </div>
          <div class="attention-count">${noDate}</div>
        </button>` : ''}
        ${noPeople > 0 ? `
        <button class="attention-card" data-queue="no_people">
          <div class="attention-icon">👤</div>
          <div class="attention-text">
            <div class="attention-title">Unidentified people</div>
            <div class="attention-sub">Photos with no one tagged</div>
          </div>
          <div class="attention-count">${noPeople}</div>
        </button>` : ''}
      </div>
    </div>` : ''}

    <div class="dashboard-section">
      <div class="dashboard-section-title">Recent uploads</div>
      <div class="activity-list">${recentHtml}</div>
    </div>

    ${stats.byYear.length > 0 ? `
    <div class="dashboard-section">
      <div class="dashboard-section-title">By year</div>
      <div class="activity-list">
        ${stats.byYear.slice(0, 10).map(r => `
          <div class="activity-item">
            <div class="activity-dot"></div>
            <span class="activity-label">${escHtml(r.year)}</span>
            <span class="activity-time">${r.n} item${r.n !== 1 ? 's' : ''}</span>
          </div>`).join('')}
      </div>
    </div>` : ''}
  `

  document.getElementById('btn-open-upload')?.addEventListener('click', openUploadModal)
}

function formatRelativeTime(isoString: string): string {
  try {
    const d = new Date(isoString)
    const diffMs = Date.now() - d.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    if (diffMins < 1) return 'just now'
    if (diffMins < 60) return `${diffMins}m ago`
    const diffHours = Math.floor(diffMins / 60)
    if (diffHours < 24) return `${diffHours}h ago`
    const diffDays = Math.floor(diffHours / 24)
    if (diffDays < 7) return `${diffDays}d ago`
    return d.toLocaleDateString()
  } catch {
    return ''
  }
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
