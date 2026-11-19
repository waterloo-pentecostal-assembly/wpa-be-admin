// Client for the Bible API served by server.js (see src/routes/bibleRoutes.js),
// backed by API.Bible. `bibleId` is an API.Bible translation ID or 'default'.
// Each function returns the parsed response body and throws an Error carrying
// the server's message on a non-200 response.

import { request } from './seriesBuilderApi';

const BASE_URL = '/api/bible';

// Signed in like every API call; errors carry the server's message.
const fetchJson = (url) => request(url);

const bibleBase = (bibleId) => `${BASE_URL}/${encodeURIComponent(bibleId || 'default')}`;

/** @returns {Promise<{ default: string|null, bibles: Array<{ id: string, abbreviation: string, name: string, language: string }> }>} */
export function fetchTranslations() {
    return fetchJson(`${BASE_URL}/translations`);
}

/** @returns {Promise<{ version: string, bible: object, books: Array<{ name: string, chapterCount: number }> }>} */
export function fetchBibleBooks(bibleId) {
    return fetchJson(`${bibleBase(bibleId)}/books`);
}

/** @returns {Promise<{ version: string, book: string, chapters: Array<{ chapter: number, verseCount: number|null }> }>} */
export function fetchBibleChapters(book, bibleId) {
    return fetchJson(`${bibleBase(bibleId)}/books/${encodeURIComponent(book)}/chapters`);
}

/** @returns {Promise<{ version: string, book: string, chapter: number, verses: Array<{ verse: number, text: string }> }>} */
export function fetchBibleVerses(book, chapter, bibleId) {
    return fetchJson(
        `${bibleBase(bibleId)}/books/${encodeURIComponent(book)}/chapters/${encodeURIComponent(chapter)}/verses`,
    );
}

/**
 * Resolves a free-text reference such as "Romans 4:1-6" (single verses,
 * whole chapters, multiple ranges, and cross-chapter ranges included).
 *
 * @returns {Promise<{ version: string, reference: string, book: string, bookId: string, chapter: number|null,
 *   chapters: number[], verses: Array<{ chapter: number, verse: number, text: string }>, bible: object }>}
 */
export function fetchBiblePassage(reference, bibleId) {
    return fetchJson(`${bibleBase(bibleId)}/passage?ref=${encodeURIComponent(reference)}`);
}

// ---------- Bible proxy operations (src/routes/bibleRoutes.js, /api/bible-proxy) ----------

/** The proxy's cache hit rate, upstream call count and masked key status. */
export const fetchBibleProxyStats = () => request('/api/bible-proxy/stats');
/** Who the proxy thinks the signed-in admin is. */
export const fetchBibleProxyWhoami = () => request('/api/bible-proxy/whoami');
/** Purges the proxy's cache: `{ all: true }`, `{ bibleId }` or `{ audioBibleId }`. */
export const purgeBibleProxyCache = (target) => request('/api/bible-proxy/cache/purge', { method: 'POST', json: target });
