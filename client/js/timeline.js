import { api, thumbnailUrl, formatDate, mimeIcon } from './api.js';
// ─── State ────────────────────────────────────────────────────────────────────
let allAssets = [];
let filteredAssets = [];
let currentIndex = 0;
let searchTimeout = null;
// ─── Init ─────────────────────────────────────────────────────────────────────
export async function init() {
    await loadFilters();
    await loadAssets();
    bindFilters();
}
async function loadFilters() {
    const [people, events] = await Promise.all([
        api.people.list().catch(() => []),
        api.events.list().catch(() => []),
    ]);
    const personSel = document.getElementById('filter-person');
    const eventSel = document.getElementById('filter-event');
    for (const p of people) {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name;
        personSel.appendChild(opt);
    }
    for (const e of events) {
        const opt = document.createElement('option');
        opt.value = e.id;
        opt.textContent = e.title;
        eventSel.appendChild(opt);
    }
}
async function loadAssets(params) {
    const content = document.getElementById('timeline-content');
    content.innerHTML = '<div class="state-loading">Loading memories…</div>';
    try {
        const response = await api.assets.list({ limit: '500', ...params });
        allAssets = response.assets;
        filteredAssets = allAssets;
        renderTimeline(allAssets);
    }
    catch {
        content.innerHTML = '<div class="state-loading">Could not load assets.</div>';
    }
}
// ─── Render ───────────────────────────────────────────────────────────────────
function renderTimeline(assets) {
    const content = document.getElementById('timeline-content');
    if (assets.length === 0) {
        content.innerHTML = `
      <div class="state-empty">
        <h2>No memories yet</h2>
        <p>Upload some photos, videos, or documents to get started.</p>
      </div>`;
        return;
    }
    // Split dated vs undated/circa
    const dated = assets.filter(a => a.taken_at && a.date_precision !== 'unknown' && a.date_precision !== 'circa');
    const undated = assets.filter(a => !a.taken_at || a.date_precision === 'unknown' || a.date_precision === 'circa');
    // Group dated assets by year → month
    const byYear = new Map();
    for (const asset of dated) {
        const year = asset.taken_at.substring(0, 4);
        const monthKey = asset.taken_at.length >= 7
            ? asset.taken_at.substring(0, 7)
            : `${year}-00`;
        if (!byYear.has(year))
            byYear.set(year, new Map());
        const months = byYear.get(year);
        if (!months.has(monthKey))
            months.set(monthKey, []);
        months.get(monthKey).push(asset);
    }
    // Sort years descending
    const sortedYears = Array.from(byYear.keys()).sort((a, b) => b.localeCompare(a));
    const html = [];
    for (const year of sortedYears) {
        const months = byYear.get(year);
        const yearCount = Array.from(months.values()).reduce((s, m) => s + m.length, 0);
        html.push(`
      <div class="year-group">
        <div class="year-header">
          <span class="year-label">${year}</span>
          <span class="year-count">${yearCount} item${yearCount !== 1 ? 's' : ''}</span>
        </div>`);
        // Sort months descending within year
        const sortedMonths = Array.from(months.keys()).sort((a, b) => b.localeCompare(a));
        for (const monthKey of sortedMonths) {
            const monthAssets = months.get(monthKey);
            const monthLabel = formatMonthLabel(monthKey);
            html.push(`
        <div class="month-group">
          <div class="month-header">${monthLabel}</div>
          <div class="thumb-grid">
            ${monthAssets.map(a => thumbHtml(a)).join('')}
          </div>
        </div>`);
        }
        html.push('</div>');
    }
    // Undated section
    if (undated.length > 0) {
        html.push(`
      <div class="undated-section">
        <div class="undated-header">Undated &amp; Approximate (${undated.length})</div>
        <div class="thumb-grid">
          ${undated.map(a => thumbHtml(a)).join('')}
        </div>
      </div>`);
    }
    content.innerHTML = html.join('');
    // Lazy-load images
    content.querySelectorAll('img[data-src]').forEach(img => {
        img.classList.add('loading');
        const observer = new IntersectionObserver(entries => {
            for (const entry of entries) {
                if (entry.isIntersecting) {
                    const el = entry.target;
                    el.src = el.dataset.src;
                    el.onload = () => el.classList.remove('loading');
                    observer.unobserve(el);
                }
            }
        }, { rootMargin: '200px' });
        observer.observe(img);
    });
    // Click handlers
    content.querySelectorAll('.thumb-item').forEach(el => {
        el.addEventListener('click', () => {
            const id = el.dataset.id;
            const idx = filteredAssets.findIndex(a => a.id === id);
            if (idx !== -1)
                openOverlay(idx);
        });
    });
}
function thumbHtml(asset) {
    const thumb = thumbnailUrl(asset);
    const icon = mimeIcon(asset.mime_type);
    const media = thumb
        ? `<img data-src="${thumb}" alt="${escHtml(asset.original_name || '')}">`
        : `<div class="thumb-placeholder">${icon}</div>`;
    const badge = asset.location_name
        ? `<span class="thumb-badge">${escHtml(asset.location_name)}</span>`
        : '';
    return `<div class="thumb-item" data-id="${asset.id}" title="${escHtml(asset.original_name || asset.filename)}">${media}${badge}</div>`;
}
function formatMonthLabel(monthKey) {
    if (monthKey.endsWith('-00'))
        return 'Unknown month';
    try {
        const [year, month] = monthKey.split('-');
        return new Date(parseInt(year), parseInt(month) - 1).toLocaleString('default', {
            month: 'long',
        });
    }
    catch {
        return monthKey;
    }
}
// ─── Overlay ──────────────────────────────────────────────────────────────────
function openOverlay(index) {
    currentIndex = index;
    renderOverlay();
    document.getElementById('asset-overlay').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
}
function closeOverlay() {
    document.getElementById('asset-overlay').classList.add('hidden');
    document.body.style.overflow = '';
}
async function renderOverlay() {
    const asset = filteredAssets[currentIndex];
    if (!asset)
        return;
    const prevBtn = document.getElementById('overlay-prev');
    const nextBtn = document.getElementById('overlay-next');
    prevBtn.disabled = currentIndex === 0;
    nextBtn.disabled = currentIndex === filteredAssets.length - 1;
    // Show skeleton while we fetch full detail
    const content = document.getElementById('overlay-content');
    content.innerHTML = renderAssetDetail(asset, null);
    try {
        const full = await api.assets.get(asset.id);
        content.innerHTML = renderAssetDetail(full, full);
    }
    catch {
        // already rendered with what we have
    }
}
function renderAssetDetail(asset, full) {
    const mime = asset.mime_type || '';
    const origUrl = asset.local_path ? `/uploads/${asset.local_path}` : null;
    const thumbUrl = thumbnailUrl(asset);
    let mediaHtml = '';
    if (mime.startsWith('image/') && origUrl) {
        mediaHtml = `<img src="${origUrl}" alt="${escHtml(asset.original_name || '')}" loading="lazy">`;
    }
    else if (mime.startsWith('image/') && thumbUrl) {
        mediaHtml = `<img src="${thumbUrl}" alt="${escHtml(asset.original_name || '')}">`;
    }
    else if (mime.startsWith('video/') && origUrl) {
        mediaHtml = `<video src="${origUrl}" controls preload="metadata"></video>`;
    }
    else if (mime.startsWith('audio/') && origUrl) {
        mediaHtml = `<audio src="${origUrl}" controls style="width:100%;padding:20px"></audio>`;
    }
    else {
        mediaHtml = `<div class="thumb-placeholder" style="font-size:3rem;padding:60px 0">${mimeIcon(mime)}</div>`;
    }
    const people = full?.people ?? [];
    const events = full?.events ?? [];
    const peopleTags = people.length > 0
        ? people.map(p => `<span class="tag">${escHtml(p.name)}</span>`).join('')
        : '<span style="font-size:0.82rem;color:var(--text-3)">Not identified</span>';
    const eventTags = events.length > 0
        ? events.map(e => `<span class="tag event-tag">${escHtml(e.title)}</span>`).join('')
        : '';
    const location = asset.location_name
        ? `<div class="asset-info-section">
        <div class="asset-info-label">Location</div>
        <div style="font-size:0.88rem;color:var(--text-2)">${escHtml(asset.location_name)}</div>
       </div>`
        : '';
    const notes = asset.notes
        ? `<div class="asset-info-section">
        <div class="asset-info-label">Notes</div>
        <div class="asset-info-notes">${escHtml(asset.notes)}</div>
       </div>`
        : '';
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
    </div>`;
}
function precisionLabel(precision) {
    const labels = {
        exact: 'Exact timestamp',
        day: 'Date known',
        month: 'Month known',
        year: 'Year only',
        circa: 'Approximate',
        unknown: 'Date unknown',
    };
    return labels[precision] ?? precision;
}
// ─── Filters ──────────────────────────────────────────────────────────────────
function bindFilters() {
    const search = document.getElementById('search-input');
    const person = document.getElementById('filter-person');
    const event = document.getElementById('filter-event');
    const from = document.getElementById('filter-from');
    const to = document.getElementById('filter-to');
    search.addEventListener('input', () => {
        if (searchTimeout)
            clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => applyFilters(), 300);
    });
    person.addEventListener('change', applyFilters);
    event.addEventListener('change', applyFilters);
    from.addEventListener('change', applyFilters);
    to.addEventListener('change', applyFilters);
    // Overlay nav + close
    document.getElementById('overlay-close').addEventListener('click', closeOverlay);
    document.getElementById('overlay-backdrop').addEventListener('click', closeOverlay);
    document.getElementById('overlay-prev').addEventListener('click', () => {
        if (currentIndex > 0) {
            currentIndex--;
            renderOverlay();
        }
    });
    document.getElementById('overlay-next').addEventListener('click', () => {
        if (currentIndex < filteredAssets.length - 1) {
            currentIndex++;
            renderOverlay();
        }
    });
    document.addEventListener('keydown', e => {
        const overlay = document.getElementById('asset-overlay');
        if (overlay.classList.contains('hidden'))
            return;
        if (e.key === 'Escape')
            closeOverlay();
        if (e.key === 'ArrowLeft' && currentIndex > 0) {
            currentIndex--;
            renderOverlay();
        }
        if (e.key === 'ArrowRight' && currentIndex < filteredAssets.length - 1) {
            currentIndex++;
            renderOverlay();
        }
    });
}
async function applyFilters() {
    const q = document.getElementById('search-input').value.trim();
    const person = document.getElementById('filter-person').value;
    const event = document.getElementById('filter-event').value;
    const from = document.getElementById('filter-from').value;
    const to = document.getElementById('filter-to').value;
    const params = { limit: '500' };
    if (person)
        params.person = person;
    if (event)
        params.event = event;
    if (from)
        params.from = from;
    if (to)
        params.to = to;
    const content = document.getElementById('timeline-content');
    if (q) {
        content.innerHTML = '<div class="state-loading">Searching…</div>';
        try {
            const res = await api.search({ q, ...params });
            filteredAssets = res.assets;
            renderTimeline(filteredAssets);
        }
        catch {
            content.innerHTML = '<div class="state-loading">Search failed.</div>';
        }
    }
    else {
        try {
            const res = await api.assets.list(params);
            filteredAssets = res.assets;
            allAssets = filteredAssets;
            renderTimeline(filteredAssets);
        }
        catch {
            content.innerHTML = '<div class="state-loading">Could not load assets.</div>';
        }
    }
}
// ─── Util ─────────────────────────────────────────────────────────────────────
function escHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
//# sourceMappingURL=timeline.js.map