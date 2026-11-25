// Client for the series builder endpoints in server.js
// (src/routes/seriesBuilderRoutes.js and the Bible/series routes), and the
// request helper every API client uses.
import { endExpiredSession, getIdToken } from '../firebase';

export class ApiError extends Error {
    /**
     * @param {string} message
     * @param {number} status
     * @param {object|null} body
     * @param {number|null} [retryAfter] - seconds from the response's Retry-After
     */
    constructor(message, status, body, retryAfter = null) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.body = body;
        this.retryAfter = retryAfter;
    }
}

// A rate limit this short is waited out and the request retried once; longer
// ones are reported (with `retryAfter`) for the user to try again.
const MAX_AUTO_RETRY_AFTER_S = 10;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Seconds from a Retry-After header (seconds or an HTTP date), or null. */
export function parseRetryAfter(value) {
    if (!value) return null;
    const seconds = Number(value);
    if (Number.isFinite(seconds)) return Math.max(0, Math.ceil(seconds));
    const date = Date.parse(value);
    return Number.isNaN(date) ? null : Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

async function tokenFor(forceRefresh) {
    try {
        return await getIdToken(forceRefresh);
    } catch {
        // Firebase couldn't start; the server will say the call needs signing in.
        return null;
    }
}

/**
 * Calls the API with the signed-in admin's ID token (the server requires it on
 * every route but the few loaded before signing in, and forwards it to the
 * Bible proxy for scripture) and returns the parsed body, throwing an ApiError
 * with the server's message on failure.
 *
 * - 401 (token missing, expired or revoked): gets a fresh token and retries
 *   once; if that is rejected too, signs out so the user signs in again.
 * - 429 (rate limit): waits out a short Retry-After and retries once.
 * - 502/503 (scripture unavailable): the error says to try again later and
 *   carries `retryAfter` when the server sent one.
 */
export async function request(url, { method = 'GET', json, body, headers } = {}) {
    const send = async (forceRefresh) => {
        const token = await tokenFor(forceRefresh);
        try {
            return await fetch(url, {
                method,
                headers: {
                    ...(json !== undefined && { 'Content-Type': 'application/json' }),
                    ...(token && { Authorization: `Bearer ${token}` }),
                    ...headers,
                },
                body: json !== undefined ? JSON.stringify(json) : body,
            });
        } catch (error) {
            throw new ApiError(`Network error: ${error.message}`, 0, null);
        }
    };

    let res = await send(false);
    if (res.status === 401) {
        res = await send(true);
        if (res.status === 401) await endExpiredSession().catch(() => {});
    }
    if (res.status === 429) {
        const wait = parseRetryAfter(res.headers.get('Retry-After'));
        if (wait !== null && wait <= MAX_AUTO_RETRY_AFTER_S) {
            await sleep(wait * 1000);
            res = await send(false);
        }
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) {
        const retryAfter = parseRetryAfter(res.headers.get('Retry-After'));
        let message = data?.error || `Request failed (${res.status})`;
        if ((res.status === 502 || res.status === 503) && !data?.error) message = 'The service is temporarily unavailable; try again later.';
        throw new ApiError(message, res.status, data, retryAfter);
    }
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
// The publish record's `updated_by` is the signed-in admin, taken by the server from their ID token.
/** Starts a server-side publish; resolves once the series document exists. */
export const publishDraft = (id, json) =>
    request(`/api/drafts/${encodeURIComponent(id)}/publish`, { method: 'POST', json: { json } });
/** What updating the draft's series would change; nothing is written. */
export const previewSeriesUpdate = (id, json) =>
    request(`/api/drafts/${encodeURIComponent(id)}/update-preview`, { method: 'POST', json: { json } });
/** Applies the previewed update (`planHash` from the preview). */
export const applySeriesUpdate = (id, json, planHash) =>
    request(`/api/drafts/${encodeURIComponent(id)}/update`, { method: 'POST', json: { json, planHash } });
/** Links a draft opened from a published series to that series. */
export const linkDraftToSeries = (id, seriesId) =>
    request(`/api/drafts/${encodeURIComponent(id)}/link`, { method: 'POST', json: { seriesId } });

// ---------- Published series (selected environment) ----------
export const listPublishedSeries = () => request('/api/published');
export const getPublishedSeries = (seriesId) => request(`/api/published/${encodeURIComponent(seriesId)}`);
/**
 * Copies a published series from prod (the selected environment) to dev, for testing; it's copied inactive.
 * 409 (with the dev copy's `title` and `is_active`) if it's already in dev, unless `replace`.
 */
export const copySeriesToEnv = (seriesId, env, replace = false) =>
    request(`/api/published/${encodeURIComponent(seriesId)}/copy-to`, { method: 'POST', json: { env, replace } });
/** A series' { is_active, is_visible }. */
export const getSeriesFlags = (seriesId) => request(`/api/published/${encodeURIComponent(seriesId)}/flags`);
/**
 * Sets is_active and/or is_visible on a series; resolves to the flags afterwards.
 * Making a series active starts the app's automation (other series made inactive, notifications sent).
 */
export const setSeriesFlags = (seriesId, flags) =>
    request(`/api/published/${encodeURIComponent(seriesId)}/flags`, { method: 'PATCH', json: flags });

// ---------- Bible ----------
// `bibleId` is an API.Bible translation ID or 'default' (see src/routes/bibleRoutes.js).
const bibleBase = (bibleId) => `/api/bible/${encodeURIComponent(bibleId || 'default')}`;
export const fetchBookList = (bibleId) => request(`${bibleBase(bibleId)}/books`);
export const fetchBookAliases = () => request('/api/bible/aliases');
export const resolvePassages = (refs, bibleId) => request(`${bibleBase(bibleId)}/passages`, { method: 'POST', json: { refs } });

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
