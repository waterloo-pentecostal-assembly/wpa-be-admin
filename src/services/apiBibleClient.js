// HTTP client for API.Bible's REST API, reached through our Bible proxy
// (wpa-be-bible-proxy, base URL from BIBLE_API_BASE_URL; see
// src/config/apiBible.js). The proxy holds the API.Bible keys, caches
// responses and enforces API.Bible's terms (29-day cache limit, purges); its
// paths and response bodies are API.Bible's (`/bibles`, `/bibles/{id}/chapters/{id}`,
// ... with `meta.fumsToken`). This console has no API.Bible credentials.
//
// Every request carries a signed-in admin's Firebase ID token
// (`Authorization: Bearer ...`): the proxy only serves users with `is_admin`
// in Firestore and has no service-to-service auth. The server forwards the
// token of the admin whose request it is handling (see `withAuth`); the CLI
// scripts sign in as an admin (src/services/adminSession.js).
//
// The proxy is the real cache (its /admin routes aren't rate-limited, and a
// repeat request is a cache hit). Opening a series needs one request per
// chapter (up to ~150), so this client also keeps a copy (chapters, Bible
// details and book lists for 6 hours; a purge from the Scripture Proxy page
// clears it), and identical concurrent requests share one call. Requests can
// be paced with `rateLimit` (BIBLE_API_RATE_LIMIT; off by default). If the
// proxy ever answers 429, every request through this client pauses until its
// Retry-After. Chapter text is fetched with `content-type=json`
// and split into verses using the `verseId` attribute API.Bible puts on every
// text node (see versesFromContent).
//
// Only query parameters the proxy allowlists are sent (chapters: content-type
// and include-*; books: include-chapters); anything else is a 400.
//
// FUMS (API.Bible's fair-use view tracking) is reported for every chapter
// fetched, from the `meta.fumsToken` the proxy passes through, unless turned
// off with `fums: false`.

export const DEFAULT_BIBLE_API_BASE_URL = 'https://wpa-be-bible-proxy.onrender.com/admin/v1';
// No pacing unless BIBLE_API_RATE_LIMIT is set.
export const DEFAULT_RATE_LIMIT = null;

/**
 * Parses a rate like "5/s", "60/min" or "300/h" into { requests, perMs };
 * null for anything else.
 */
export function parseRateLimit(value) {
    const match = /^\s*(\d+)\s*\/\s*(\d*)\s*(ms|s|sec|second|m|min|minute|h|hour)\s*$/i.exec(String(value ?? ''));
    if (!match || Number(match[1]) < 1) return null;
    const unit = { ms: 1, s: 1000, sec: 1000, second: 1000, m: 60_000, min: 60_000, minute: 60_000, h: 3_600_000, hour: 3_600_000 }[match[3].toLowerCase()];
    return { requests: Number(match[1]), perMs: (Number(match[2]) || 1) * unit };
}
const FUMS_URL = 'https://fums.api.bible/f3';

export class ApiBibleError extends Error {
    /**
     * @param {string} message
     * @param {number} status - HTTP status for the admin API to return
     * @param {number} [upstreamStatus] - status the Bible proxy returned, if any
     * @param {{ retryAfter?: number|null }} [options]
     *   `retryAfter`: seconds to wait before retrying (the proxy's Retry-After)
     */
    constructor(message, status, upstreamStatus = null, { retryAfter = null } = {}) {
        super(message);
        this.name = 'ApiBibleError';
        this.status = status;
        this.upstreamStatus = upstreamStatus;
        this.retryAfter = retryAfter;
    }
}

class LruCache {
    constructor(maxEntries, ttlMs) {
        this.maxEntries = maxEntries;
        this.ttlMs = ttlMs;
        this.map = new Map();
    }

    get(key) {
        const entry = this.map.get(key);
        if (!entry) return undefined;
        if (this.ttlMs && Date.now() - entry.at > this.ttlMs) {
            this.map.delete(key);
            return undefined;
        }
        this.map.delete(key);
        this.map.set(key, entry);
        return entry.value;
    }

    set(key, value) {
        this.map.delete(key);
        this.map.set(key, { value, at: Date.now() });
        while (this.map.size > this.maxEntries) this.map.delete(this.map.keys().next().value);
    }

    clear() {
        this.map.clear();
    }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Seconds from a Retry-After header (delta-seconds or an HTTP date), or null. */
export function parseRetryAfter(value, now = Date.now()) {
    if (value === null || value === undefined || value === '') return null;
    const seconds = Number(value);
    if (Number.isFinite(seconds)) return Math.max(0, Math.ceil(seconds));
    const date = Date.parse(value);
    return Number.isNaN(date) ? null : Math.max(0, Math.ceil((date - now) / 1000));
}

/**
 * Credentials for proxy calls: `getToken(forceRefresh)` returns a Firebase ID
 * token. `bearerAuth` wraps a token the server received from an admin's
 * request (it can't be refreshed here: a 401 goes back to the browser, which
 * refreshes and retries).
 *
 * @typedef {{ getToken: (forceRefresh?: boolean) => Promise<string|null>, canRefresh?: boolean }} BibleAuth
 * @param {string|null} token
 * @returns {BibleAuth}
 */
export function bearerAuth(token) {
    return { getToken: async () => token ?? null, canRefresh: false };
}

const retryHint = (seconds) => (seconds ? ` in ${seconds} second${seconds === 1 ? '' : 's'}` : ' later');

/** Strips HTML tags and collapses whitespace (Bible `copyright` can contain markup). */
export function plainText(value) {
    return String(value ?? '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&copy;/g, '©')
        .replace(/\s+/g, ' ')
        .trim();
}

// Paragraph styles that are not verse text (headings, references, labels).
// Titles are also excluded with include-titles=false; this is a second guard.
const NON_VERSE_PARA = /^(s\d*|ms\d*|mr|r|sr|sp|cl|mt\d*|imt\d*|is\d*|ip|iot|io\d*|rem|h\d*|toc\d*)$/;
const NON_VERSE_CHAR = new Set(['f', 'fe', 'x', 'fr', 'ft', 'fq', 'fqa', 'xo', 'xt']);

/**
 * Splits API.Bible JSON content (content-type=json) into verse text keyed by
 * verse number. Text nodes carry `attrs.verseId` ("ROM.4.1"); nodes without
 * it belong to the verse whose marker came last. Verse-number markers,
 * footnotes and headings are left out, and whitespace is collapsed so each
 * verse is one line like the rest of the stored scripture.
 *
 * A verse bridge ("1-2") keeps its text on the first verse and records the
 * other verses with empty text, so ranges touching them still resolve.
 *
 * @param {Array<object>} content
 * @returns {Record<string, string>}
 */
export function versesFromContent(content) {
    const pieces = new Map(); // verse number -> string[]
    let current = null;

    const verseNumberOf = (verseId) => {
        const match = /\.(\d+)(?:-\d+)?$/.exec(String(verseId ?? ''));
        return match ? match[1] : null;
    };
    const add = (verse, text) => {
        if (!verse) return;
        if (!pieces.has(verse)) pieces.set(verse, []);
        pieces.get(verse).push(text);
    };
    const visit = (node) => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) {
            node.forEach(visit);
            return;
        }
        if (node.type === 'text') {
            add(verseNumberOf(node.attrs?.verseId) ?? current, node.text ?? '');
            return;
        }
        const style = node.attrs?.style ?? '';
        if (node.name === 'verse') {
            const [first, last] = String(node.attrs?.number ?? '').split('-').map((n) => Number.parseInt(n, 10));
            if (Number.isInteger(first)) {
                current = String(first);
                add(current, '');
                for (let v = first + 1; Number.isInteger(last) && v <= last; v++) add(String(v), '');
            }
            return; // the marker's own text is the verse number
        }
        if (node.name === 'note' || (node.name === 'char' && NON_VERSE_CHAR.has(style))) return;
        if (node.name === 'para' && NON_VERSE_PARA.test(style)) return;
        if (node.name === 'chapter') return;
        // Paragraph/line breaks separate words that have no space between them.
        if (node.name === 'para') add(current, ' ');
        visit(node.items);
        if (node.name === 'para') add(current, ' ');
    };
    visit(content);

    const verses = {};
    for (const [verse, parts] of [...pieces.entries()].sort((a, b) => Number(a[0]) - Number(b[0]))) {
        verses[verse] = parts.join('').replace(/\s+/g, ' ').replace(/\s+([,.;:!?’”)])/g, '$1').trim();
    }
    return verses;
}

export class ApiBibleClient {
    /**
     * @param {object} [options]
     * @param {string} [options.baseUrl] - the proxy's API.Bible base URL (…/admin/v1)
     * @param {BibleAuth|null} [options.auth] - whose ID token to send (see withAuth)
     * @param {typeof fetch} [options.fetch]
     * @param {number} [options.maxRetries] - retries for network errors, 5xx, and
     *   429/502/503 whose Retry-After is at most `maxRetryAfterMs`
     * @param {number} [options.maxRetryAfterMs] - longest Retry-After waited out here;
     *   longer ones are returned to the caller (with `retryAfter`)
     * @param {number} [options.concurrency] - parallel requests to the proxy
     * @param {number} [options.chapterCacheSize]
     * @param {number} [options.chapterTtlMs]
     * @param {number} [options.metadataTtlMs] - Bible details and book lists
     * @param {boolean} [options.fums] - report FUMS views for fetched chapters
     * @param {string} [options.fumsDeviceId]
     */
    constructor({
        baseUrl = DEFAULT_BIBLE_API_BASE_URL,
        auth = null,
        fetch: fetchImpl = globalThis.fetch,
        maxRetries = 3,
        maxRetryAfterMs = 20_000,
        concurrency = 4,
        chapterCacheSize = 1500,
        chapterTtlMs = 6 * 60 * 60 * 1000,
        metadataTtlMs = 6 * 60 * 60 * 1000,
        fums = true,
        fumsDeviceId = 'wpa-be-admin',
        retryDelayMs = 500,
        rateLimit = DEFAULT_RATE_LIMIT,
        shared = null,
    } = {}) {
        this.options = {
            baseUrl, fetch: fetchImpl, maxRetries, maxRetryAfterMs, concurrency, chapterCacheSize,
            chapterTtlMs, metadataTtlMs, fums, fumsDeviceId, retryDelayMs, rateLimit,
        };
        this.baseUrl = baseUrl.replace(/\/+$/, '');
        this.auth = auth;
        this.fetch = fetchImpl;
        this.maxRetries = maxRetries;
        this.maxRetryAfterMs = maxRetryAfterMs;
        this.retryDelayMs = retryDelayMs;
        this.rateLimit = rateLimit;
        this.concurrency = concurrency;
        this.fums = fums;
        this.fumsDeviceId = fumsDeviceId;
        // Caches, in-flight requests, the concurrency limit and the request
        // count are shared by every copy made with withAuth.
        this.shared = shared ?? {
            cache: new LruCache(500, metadataTtlMs),
            chapters: new LruCache(chapterCacheSize, chapterTtlMs),
            inFlight: new Map(),
            active: 0,
            queue: [],
            requestCount: 0,
            // Set by a 429: no request is sent before this time (ms).
            pausedUntil: 0,
            // Start times of recent requests, for pacing (see #pace).
            sentAt: [],
            fumsSessionId: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
        };
    }

    /** Requests made to the proxy (not counting FUMS), for logging. */
    get requestCount() {
        return this.shared.requestCount;
    }

    /** A copy that sends `auth`'s token, sharing this client's caches. */
    withAuth(auth) {
        return new ApiBibleClient({ ...this.options, auth, shared: this.shared });
    }

    /** Forgets cached responses (e.g. after purging the proxy's cache). */
    clearCache() {
        this.shared.cache.clear();
        this.shared.chapters.clear();
    }

    async #slot(fn) {
        const shared = this.shared;
        if (shared.active >= this.concurrency) await new Promise((resolve) => shared.queue.push(resolve));
        shared.active++;
        try {
            return await fn();
        } finally {
            shared.active--;
            shared.queue.shift()?.();
        }
    }

    /**
     * Waits while a 429 has paused requests. A pause longer than
     * `maxRetryAfterMs` fails at once (with the time left) rather than
     * holding the request.
     */
    /**
     * Waits for a free spot in the pacing window: at most
     * `rateLimit.requests` requests start in any `rateLimit.perMs`. Shared by
     * every withAuth copy, so all admins' requests from this server count.
     */
    async #pace() {
        if (!this.rateLimit) return;
        const { requests, perMs } = this.rateLimit;
        const sentAt = this.shared.sentAt;
        for (;;) {
            const now = Date.now();
            while (sentAt.length && sentAt[0] <= now - perMs) sentAt.shift();
            if (sentAt.length < requests) {
                sentAt.push(now);
                return;
            }
            await sleep(sentAt[0] + perMs - now);
        }
    }

    async #waitForRateLimit() {
        for (;;) {
            const left = this.shared.pausedUntil - Date.now();
            if (left <= 0) return;
            if (left > this.maxRetryAfterMs) {
                const retryAfter = Math.ceil(left / 1000);
                throw new ApiBibleError(`Too many scripture requests: waiting out an earlier rate limit from the Bible proxy. Try again${retryHint(retryAfter)}`, 429, 429, { retryAfter });
            }
            await sleep(left);
        }
    }

    /**
     * Reads an error response once: the message, and who sent it. The proxy
     * app answers `{ statusCode, error, message }` JSON; an HTML page means
     * Cloudflare/Render in front of it answered instead.
     */
    async #readError(res) {
        const text = await res.text().catch(() => '');
        let json = null;
        try {
            json = text ? JSON.parse(text) : null;
        } catch {
            // not JSON
        }
        const contentType = res.headers?.get?.('content-type') ?? '';
        const fromProxy = json !== null && typeof json === 'object' && 'statusCode' in json;
        const source = fromProxy
            ? 'Bible proxy'
            : /html/i.test(contentType) || /^\s*</.test(text)
                ? 'Cloudflare/Render in front of the proxy, not the proxy app'
                : 'unknown (not the proxy\'s JSON error format)';
        const detail = json?.message || json?.error || (fromProxy ? '' : text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160)) || res.statusText || '';
        return { detail, source, fromProxy };
    }

    // Pauses every request through this client (and its withAuth copies)
    // until the proxy's Retry-After has passed, and logs who sent the 429 and
    // what it said about the limit.
    #pauseForRateLimit(retryAfter, res, url, { detail, source }) {
        const seconds = retryAfter ?? 5;
        const until = Date.now() + seconds * 1000;
        if (until <= this.shared.pausedUntil) return;
        const wasPaused = this.shared.pausedUntil > Date.now();
        this.shared.pausedUntil = until;
        if (wasPaused) return;
        const limits = ['ratelimit-limit', 'ratelimit-remaining', 'ratelimit-reset', 'ratelimit-policy', 'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset']
            .map((name) => [name, res.headers?.get?.(name)])
            .filter(([, value]) => value !== null && value !== undefined)
            .map(([name, value]) => `${name}=${value}`);
        console.warn(`429 on ${url.pathname} from ${source}${detail ? ` ("${detail}")` : ''} after ${this.shared.requestCount} requests from this server; pausing ${seconds}s`
            + `${retryAfter === null ? ' (no Retry-After)' : ''}${limits.length ? ` [${limits.join(', ')}]` : ''}`);
    }

    async #token(forceRefresh = false) {
        const token = this.auth ? await this.auth.getToken(forceRefresh) : null;
        if (!token) throw new ApiBibleError('Sign in again to load scripture (no admin credentials for the Bible proxy)', 401);
        return token;
    }

    /**
     * Calls the proxy with the admin's ID token and returns `{ status, headers, body }`.
     * `pathname` is relative to the base URL (`/bibles/...`); `absolute` paths
     * (`/admin/...`) are relative to the proxy's origin.
     */
    async send(pathname, { method = 'GET', params = {}, json, absolute = false } = {}) {
        const url = new URL(absolute ? pathname : `${this.baseUrl}${pathname}`, this.baseUrl);
        for (const [key, value] of Object.entries(params)) {
            if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
        }
        return this.#slot(async () => {
            let refreshed = false;
            for (let attempt = 0; ; attempt++) {
                await this.#waitForRateLimit();
                await this.#pace();
                const token = await this.#token(refreshed);
                let res;
                try {
                    this.shared.requestCount++;
                    res = await this.fetch(url, {
                        method,
                        headers: {
                            accept: 'application/json',
                            authorization: `Bearer ${token}`,
                            ...(json !== undefined && { 'content-type': 'application/json' }),
                        },
                        ...(json !== undefined && { body: JSON.stringify(json) }),
                    });
                } catch (error) {
                    if (attempt < this.maxRetries) {
                        await sleep(this.retryDelayMs * 2 ** attempt);
                        continue;
                    }
                    throw new ApiBibleError(`Could not reach the Bible proxy: ${error.message}`, 502);
                }
                if (res.ok) return { status: res.status, headers: res.headers, body: await res.json() };

                // An expired token: a refreshable session (the CLI) refreshes
                // once; a forwarded token goes back to the browser to refresh.
                if (res.status === 401 && !refreshed && this.auth?.canRefresh) {
                    refreshed = true;
                    continue;
                }
                const retryAfter = parseRetryAfter(res.headers?.get?.('retry-after'));
                const failure = await this.#readError(res);
                if (res.status === 429) {
                    this.#pauseForRateLimit(retryAfter, res, url, failure);
                    if (attempt < this.maxRetries && this.shared.pausedUntil - Date.now() <= this.maxRetryAfterMs) continue;
                }
                const waitable = retryAfter !== null && retryAfter * 1000 <= this.maxRetryAfterMs;
                const retryable = res.status === 429 || res.status === 502 || res.status === 503
                    ? waitable
                    : res.status >= 500;
                if (retryable && attempt < this.maxRetries) {
                    await sleep(retryAfter !== null ? retryAfter * 1000 : this.retryDelayMs * 2 ** attempt);
                    continue;
                }
                throw this.#error(res.status, failure, retryAfter, url);
            }
        });
    }

    /** GET a path under the base URL; returns the parsed body ({ data, meta }). */
    async request(pathname, params = {}) {
        return (await this.send(pathname, { params })).body;
    }

    // Maps the proxy's errors ({ statusCode, error, message }) to what the
    // console's API returns.
    #error(status, { detail, source, fromProxy }, retryAfter, url) {
        const suffix = detail ? ` (${detail})` : '';
        if (status === 400) {
            // An unsupported query parameter or a malformed ID: a bug in the request.
            console.error(`Bible proxy rejected ${url.pathname}${url.search}${suffix}`);
            return new ApiBibleError(`The Bible proxy rejected the request${suffix}`, 400, status);
        }
        if (status === 401) return new ApiBibleError(`Your session has expired; sign in again${suffix}`, 401, status);
        if (status === 403) return new ApiBibleError(`The Bible proxy only serves administrators${suffix}`, 403, status);
        if (status === 404) return new ApiBibleError(`Not found in API.Bible${suffix}`, 404, status);
        if (status === 429) {
            const from = fromProxy ? `the Bible proxy's rate limit${suffix}` : `rate limited by ${source}${suffix}`;
            return new ApiBibleError(`Too many scripture requests: ${from}. Try again${retryHint(retryAfter)}`, 429, status, { retryAfter });
        }
        if (status === 502 || status === 503) {
            return new ApiBibleError(`Scripture is temporarily unavailable; try again${retryHint(retryAfter)}${suffix}`, 503, status, { retryAfter });
        }
        return new ApiBibleError(`Bible proxy request failed (${status})${suffix}`, 502, status);
    }

    async #cached(key, load, store = this.shared.cache) {
        const hit = store.get(key);
        if (hit !== undefined) return hit;
        const { inFlight } = this.shared;
        if (inFlight.has(key)) return inFlight.get(key);
        const promise = load()
            .then((value) => {
                store.set(key, value);
                return value;
            })
            .finally(() => inFlight.delete(key));
        inFlight.set(key, promise);
        return promise;
    }

    /**
     * Bibles available through the proxy. `ids` limits the list; without it
     * every Bible the proxy's API.Bible account can use is returned.
     *
     * @returns {Promise<Array<{ id, abbreviation, name, language }>>}
     */
    listBibles({ ids = null, language = null } = {}) {
        const key = `bibles|${ids?.join(',') ?? ''}|${language ?? ''}`;
        return this.#cached(key, async () => {
            const { data } = await this.request('/bibles', {
                ids: ids?.length ? ids.join(',') : undefined,
                language: language || undefined,
            });
            return (data ?? []).map((b) => ({
                id: b.id,
                abbreviation: b.abbreviationLocal || b.abbreviation || '',
                name: b.nameLocal || b.name || '',
                language: b.language?.name ?? '',
                description: b.descriptionLocal || b.description || '',
            }));
        });
    }

    /** @returns {Promise<{ id, abbreviation, name, language, copyright }>} */
    getBible(bibleId) {
        return this.#cached(`bible|${bibleId}`, async () => {
            const { data } = await this.request(`/bibles/${encodeURIComponent(bibleId)}`);
            return {
                id: data.id,
                abbreviation: data.abbreviationLocal || data.abbreviation || '',
                name: data.nameLocal || data.name || '',
                language: data.language?.name ?? '',
                copyright: plainText(data.copyright),
            };
        });
    }

    /**
     * Books with their numbered chapters (intro chapters are left out).
     * @returns {Promise<Array<{ id: string, name: string, chapters: number[] }>>}
     */
    getBooks(bibleId) {
        return this.#cached(`books|${bibleId}`, async () => {
            const { data } = await this.request(`/bibles/${encodeURIComponent(bibleId)}/books`, { 'include-chapters': true });
            return (data ?? []).map((book) => ({
                id: book.id,
                name: book.name,
                chapters: (book.chapters ?? [])
                    .map((c) => Number(c.number))
                    .filter((n) => Number.isInteger(n) && n > 0)
                    .sort((a, b) => a - b),
            }));
        });
    }

    /**
     * One chapter's verse text. `chapterId` is "<BOOK>.<n>", e.g. "ROM.4".
     * @returns {Promise<{ id: string, reference: string, copyright: string, verses: Record<string, string> }>}
     */
    getChapter(bibleId, chapterId) {
        return this.#cached(`chapter|${bibleId}|${chapterId}`, async () => {
            const body = await this.request(
                `/bibles/${encodeURIComponent(bibleId)}/chapters/${encodeURIComponent(chapterId)}`,
                {
                    'content-type': 'json',
                    'include-notes': false,
                    'include-titles': false,
                    'include-chapter-numbers': false,
                    'include-verse-numbers': true,
                    'include-verse-spans': false,
                },
            );
            const data = body?.data ?? {};
            this.#reportView(body?.meta?.fumsToken);
            return {
                id: data.id ?? chapterId,
                reference: data.reference ?? '',
                copyright: plainText(data.copyright),
                verses: versesFromContent(Array.isArray(data.content) ? data.content : []),
            };
        }, this.shared.chapters);
    }

    // Fire-and-forget: a failed FUMS report must never fail a lookup.
    #reportView(token) {
        if (!this.fums || !token) return;
        const url = new URL(FUMS_URL);
        url.searchParams.append('t', token);
        url.searchParams.set('dId', this.fumsDeviceId);
        url.searchParams.set('sId', this.shared.fumsSessionId);
        Promise.resolve()
            .then(() => this.fetch(url))
            .catch(() => {});
    }
}
