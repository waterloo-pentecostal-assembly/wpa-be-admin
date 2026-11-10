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

export async function request(url, { method = 'GET', json, body, headers } = {}) {
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
/** Copies a draft to the other environment's drafts; 409 (with `draftId`) if it was copied before, unless `replace`. */
export const copyDraftToEnv = (id, env, replace = false) =>
    request(`/api/drafts/${encodeURIComponent(id)}/copy-to`, { method: 'POST', json: { env, replace } });
/** The draft's linked series and publish records: { seriesId, publishes }. */
export const getPublishes = (id) => request(`/api/drafts/${encodeURIComponent(id)}/publishes`);
// `updatedBy` (the signed-in admin's Firebase Auth user ID) is recorded on the publish record.
/** Starts a server-side publish; resolves once the series document exists. */
export const publishDraft = (id, json, updatedBy) =>
    request(`/api/drafts/${encodeURIComponent(id)}/publish`, { method: 'POST', json: { json, updatedBy } });
/** What updating the draft's series would change; nothing is written. */
export const previewSeriesUpdate = (id, json) =>
    request(`/api/drafts/${encodeURIComponent(id)}/update-preview`, { method: 'POST', json: { json } });
/** Applies the previewed update (`planHash` from the preview). */
export const applySeriesUpdate = (id, json, planHash, updatedBy) =>
    request(`/api/drafts/${encodeURIComponent(id)}/update`, { method: 'POST', json: { json, planHash, updatedBy } });
/** Links a draft opened from a published series to that series. */
export const linkDraftToSeries = (id, seriesId, updatedBy) =>
    request(`/api/drafts/${encodeURIComponent(id)}/link`, { method: 'POST', json: { seriesId, updatedBy } });

// ---------- Published series (selected environment) ----------
export const listPublishedSeries = () => request('/api/published');
export const getPublishedSeries = (seriesId) => request(`/api/published/${encodeURIComponent(seriesId)}`);

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
/** Switches the server's environment (for every open tab). */
export const switchEnv = (env) => request('/api/env/switch', { method: 'POST', json: { env } });
/** Synchronous publish without a record; used for browser-only drafts. */
export const publishSeries = (json) => request('/api/series/upload', { method: 'POST', json });
