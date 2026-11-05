// Client for the series builder endpoints in server.js
// (src/routes/seriesBuilderRoutes.js and the Bible/series routes).

export class ApiError extends Error {
    constructor(message, status, body) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.body = body;
    }
}

async function request(url, { method = 'GET', json, body, headers } = {}) {
    let res;
    try {
        res = await fetch(url, {
            method,
            headers: json !== undefined ? { 'Content-Type': 'application/json', ...headers } : headers,
            body: json !== undefined ? JSON.stringify(json) : body,
        });
    } catch (error) {
        throw new ApiError(`Network error: ${error.message}`, 0, null);
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new ApiError(data?.error || `Request failed (${res.status})`, res.status, data);
    return data;
}

// ---------- Drafts ----------
export const getDraftsStatus = () => request('/api/drafts/status');
export const listDrafts = () => request('/api/drafts');
export const getDraft = (id) => request(`/api/drafts/${encodeURIComponent(id)}`);
export const createDraftRemote = (draft) => request('/api/drafts', { method: 'POST', json: { draft } });
export const saveDraftRemote = (id, draft, rev, force = false) =>
    request(`/api/drafts/${encodeURIComponent(id)}`, { method: 'PUT', json: { draft, rev, force } });
export const deleteDraftRemote = (id) => request(`/api/drafts/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const getPublishes = (id) => request(`/api/drafts/${encodeURIComponent(id)}/publishes`);
/** Starts a server-side publish; resolves once the series document exists. */
export const publishDraft = (id, json) => request(`/api/drafts/${encodeURIComponent(id)}/publish`, { method: 'POST', json: { json } });

// ---------- Bible ----------
export const fetchBookList = () => request('/api/bible/niv/books');
export const fetchBookAliases = () => request('/api/bible/niv/aliases');
export const resolvePassages = (refs) => request('/api/bible/niv/passages', { method: 'POST', json: { refs } });

// ---------- Existing series files / AI ----------
export const listRepoSeries = () => request('/api/series');
export const getRepoSeries = (filename) => request(`/api/series/${encodeURIComponent(filename)}`);

// ---------- Storage / links ----------
export function uploadSeriesImage(file, seriesTitle) {
    const params = new URLSearchParams({ series: seriesTitle || 'untitled', filename: file.name });
    return request(`/api/storage/series-image?${params}`, {
        method: 'POST',
        body: file,
        headers: { 'Content-Type': file.type },
    });
}
export const getImagePreviewUrl = (gs) => request(`/api/storage/preview?gs=${encodeURIComponent(gs)}`);
export const fetchLinkInfo = (url) => request(`/api/oembed?url=${encodeURIComponent(url)}`);

// ---------- Environment / publishing ----------
export const getCurrentEnv = () => request('/api/env/current');
/** Synchronous publish without a record; used for browser-only drafts. */
export const publishSeries = (json) => request('/api/series/upload', { method: 'POST', json });
