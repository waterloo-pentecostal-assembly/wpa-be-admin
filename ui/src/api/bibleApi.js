// Client for the NIV Bible API served by server.js (see src/routes/bibleRoutes.js).
// Each function returns the parsed response body and throws an Error carrying
// the server's message on a non-200 response.

import { request } from './seriesBuilderApi';

const BASE_URL = '/api/bible/niv';

// Signed in like every API call; errors carry the server's message.
const fetchJson = (url) => request(url);

/** @returns {Promise<{ version: string, books: Array<{ name: string, chapterCount: number }> }>} */
export function fetchBibleBooks() {
    return fetchJson(`${BASE_URL}/books`);
}

/** @returns {Promise<{ version: string, book: string, chapters: Array<{ chapter: number, verseCount: number }> }>} */
export function fetchBibleChapters(book) {
    return fetchJson(`${BASE_URL}/books/${encodeURIComponent(book)}/chapters`);
}

/** @returns {Promise<{ version: string, book: string, chapter: number, verses: Array<{ verse: number, text: string }> }>} */
export function fetchBibleVerses(book, chapter) {
    return fetchJson(
        `${BASE_URL}/books/${encodeURIComponent(book)}/chapters/${encodeURIComponent(chapter)}/verses`,
    );
}

/**
 * Resolves a free-text reference such as "Romans 4:1-6" (single verses,
 * whole chapters, multiple ranges, and cross-chapter ranges included).
 *
 * @returns {Promise<{ version: string, reference: string, book: string, chapter: number|null,
 *   chapters: number[], verses: Array<{ chapter: number, verse: number, text: string }> }>}
 */
export function fetchBiblePassage(reference) {
    return fetchJson(`${BASE_URL}/passage?ref=${encodeURIComponent(reference)}`);
}
