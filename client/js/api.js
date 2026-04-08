// Typed API wrappers for all server endpoints
// ─── HTTP helpers ─────────────────────────────────────────────────────────────
async function get(path, params) {
    const url = new URL('/api' + path, window.location.origin);
    if (params) {
        for (const [k, v] of Object.entries(params)) {
            if (v !== undefined && v !== '')
                url.searchParams.set(k, v);
        }
    }
    const res = await fetch(url.toString());
    if (!res.ok)
        throw new Error(`${res.status} ${res.statusText}`);
    return res.json();
}
async function post(path, body) {
    const res = await fetch('/api' + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok)
        throw new Error(`${res.status} ${res.statusText}`);
    return res.json();
}
async function del(path) {
    const res = await fetch('/api' + path, { method: 'DELETE' });
    if (!res.ok)
        throw new Error(`${res.status} ${res.statusText}`);
    return res.json();
}
async function patch(path, body) {
    const res = await fetch('/api' + path, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok)
        throw new Error(`${res.status} ${res.statusText}`);
    return res.json();
}
// ─── API surface ──────────────────────────────────────────────────────────────
export const api = {
    health: () => get('/health'),
    assets: {
        list: (params) => get('/assets', params),
        get: (id) => get(`/assets/${id}`),
        update: (id, body) => patch(`/assets/${id}`, body),
        upload: (formData) => fetch('/api/assets/upload', { method: 'POST', body: formData }).then(r => r.json()),
        delete: (id) => del(`/assets/${id}`),
    },
    people: {
        list: () => get('/people'),
        create: (data) => post('/people', data),
    },
    events: {
        list: () => get('/events'),
        create: (data) => post('/events', data),
    },
    search: (params) => get('/search', params),
    dashboard: {
        stats: () => get('/dashboard/stats'),
    },
};
// ─── URL helpers ──────────────────────────────────────────────────────────────
export function thumbnailUrl(asset) {
    if (!asset.thumbnail_path)
        return null;
    return `/uploads/${asset.thumbnail_path}`;
}
export function originalUrl(asset) {
    if (!asset.local_path)
        return null;
    return `/uploads/${asset.local_path}`;
}
export function formatDate(asset) {
    if (!asset.taken_at)
        return 'Unknown date';
    const t = asset.taken_at;
    const precision = asset.date_precision;
    if (precision === 'year' || t.length === 4)
        return t;
    if (precision === 'month' || t.length === 7) {
        const [year, month] = t.split('-');
        return new Date(parseInt(year), parseInt(month) - 1).toLocaleString('default', {
            month: 'long',
            year: 'numeric',
        });
    }
    try {
        const d = new Date(t);
        if (isNaN(d.getTime()))
            return t;
        if (precision === 'exact') {
            return d.toLocaleDateString('default', { year: 'numeric', month: 'long', day: 'numeric' });
        }
        return d.toLocaleDateString('default', { year: 'numeric', month: 'long', day: 'numeric' });
    }
    catch {
        return t;
    }
}
export function formatFileSize(bytes) {
    if (!bytes)
        return '';
    if (bytes < 1024)
        return `${bytes} B`;
    if (bytes < 1024 * 1024)
        return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
export function mimeIcon(mimeType) {
    if (!mimeType)
        return '📄';
    if (mimeType.startsWith('image/'))
        return '🖼';
    if (mimeType.startsWith('video/'))
        return '🎬';
    if (mimeType.startsWith('audio/'))
        return '🎵';
    return '📄';
}
//# sourceMappingURL=api.js.map