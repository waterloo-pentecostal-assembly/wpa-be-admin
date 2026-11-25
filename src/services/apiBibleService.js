// Bible lookups for the admin console, backed by API.Bible through the Bible
// proxy (see apiBibleClient.js). Calls need an admin's credentials: use
// `withAuth(auth)` for a copy that sends them (it shares this service's caches).
//
// Every method takes the API.Bible ID of the translation to use ("default"
// means the configured default). References are parsed by BibleService over
// a per-translation skeleton (every book and chapter, no text); only the
// chapters a reference touches are fetched (through ApiBibleClient's cache)
// and filled in while the lookup runs. Results have the same shape as
// BibleService's, plus `bible` (the translation's id, abbreviation, name and
// copyright) on passages.
//
// Chapter lists come from API.Bible's book list (one call per translation, kept
// for an hour);
// per-chapter verse counts come from src/data/verse_counts.json so the
// typeahead never has to fetch a chapter just to count its verses.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BibleService, BibleServiceError } from './bibleService.js';
import { BOOKS, BOOK_ABBREVIATIONS, bookIdFor } from './bibleCanon.js';
import { ApiBibleError } from './apiBibleClient.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VERSE_COUNTS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'verse_counts.json'), 'utf8'));

// A whole-book reference would cost one API call per chapter.
export const MAX_CHAPTERS_PER_REFERENCE = 40;
const MAX_REFERENCES = 500;
// How long a translation's book list (its "engine") is kept before refetching.
const ENGINE_TTL_MS = 60 * 60 * 1000;

export const DEFAULT_BIBLE = 'default';

/** Thrown for configuration problems (no default Bible, Bible not allowed). */
export class BibleConfigError extends BibleServiceError {}

export class ApiBibleService {
    /**
     * @param {import('./apiBibleClient.js').ApiBibleClient} client
     * @param {{ defaultBibleId?: string|null, allowedBibleIds?: string[] }} [options]
     *   `allowedBibleIds` limits the translations admins can pick (and the
     *   API will serve); empty means any Bible the proxy can serve.
     */
    constructor(client, { defaultBibleId = null, allowedBibleIds = [], engines = null } = {}) {
        this.client = client;
        this.allowedBibleIds = [...new Set((allowedBibleIds ?? []).filter(Boolean))];
        this.defaultBibleId = defaultBibleId || this.allowedBibleIds[0] || null;
        this.engines = engines ?? new Map(); // bibleId -> { promise: Promise<{ engine, bible }>, at }
    }

    /**
     * A copy whose proxy calls send `auth`'s ID token (see apiBibleClient's
     * BibleAuth), sharing this service's caches.
     */
    withAuth(auth) {
        return new ApiBibleService(this.client.withAuth(auth), {
            defaultBibleId: this.defaultBibleId,
            allowedBibleIds: this.allowedBibleIds,
            engines: this.engines,
        });
    }

    /** Forgets cached Bible data here (the proxy's cache is purged separately). */
    clearCache() {
        this.engines.clear();
        this.client.clearCache?.();
    }

    /** The concrete Bible ID for a requested one ("default", blank or an allowed ID). */
    resolveBibleId(bibleId) {
        const requested = typeof bibleId === 'string' ? bibleId.trim() : '';
        if (!requested || requested === DEFAULT_BIBLE) {
            if (!this.defaultBibleId) {
                throw new BibleConfigError('No default Bible is configured (set API_BIBLE_DEFAULT_BIBLE_ID)', 503);
            }
            return this.defaultBibleId;
        }
        if (this.allowedBibleIds.length && !this.allowedBibleIds.includes(requested)) {
            throw new BibleConfigError(`Bible ${requested} is not enabled for this console`, 400);
        }
        return requested;
    }

    /**
     * Translations admins can choose from.
     * @returns {Promise<{ default: string|null, bibles: Array<{ id, abbreviation, name, language }> }>}
     */
    async listTranslations() {
        const bibles = await this.client.listBibles(this.allowedBibleIds.length ? { ids: this.allowedBibleIds } : {});
        const order = new Map(this.allowedBibleIds.map((id, i) => [id, i]));
        const sorted = [...bibles].sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity)
            || a.abbreviation.localeCompare(b.abbreviation));
        return { default: this.defaultBibleId, bibles: sorted };
    }

    /** @returns {Promise<{ id, abbreviation, name, language, copyright }>} */
    async getBible(bibleId) {
        return (await this.#engineFor(this.resolveBibleId(bibleId))).bible;
    }

    async #engineFor(id) {
        const cached = this.engines.get(id);
        if (cached && Date.now() - cached.at > ENGINE_TTL_MS) this.engines.delete(id);
        if (!this.engines.has(id)) {
            const promise = Promise.all([this.client.getBible(id), this.client.getBooks(id)])
                .then(([bible, books]) => {
                    const available = new Map(books.map((b) => [b.id, b]));
                    const skeleton = {};
                    for (const { name, id: bookId } of BOOKS) {
                        const book = available.get(bookId);
                        if (!book?.chapters.length) continue;
                        skeleton[name] = Object.fromEntries(book.chapters.map((n) => [String(n), null]));
                    }
                    if (!Object.keys(skeleton).length) {
                        throw new ApiBibleError(`Bible ${id} has none of the 66 canonical books`, 404);
                    }
                    return { engine: new BibleService(skeleton, { version: bible.abbreviation || id }), bible };
                })
                .catch((error) => {
                    if (this.engines.get(id)?.promise === promise) this.engines.delete(id); // retry on the next request
                    if (error instanceof ApiBibleError && error.upstreamStatus === 404) {
                        throw new ApiBibleError(`Bible not found in API.Bible: ${id}`, 404, 404);
                    }
                    throw error;
                });
            this.engines.set(id, { promise, at: Date.now() });
        }
        return this.engines.get(id).promise;
    }

    /**
     * Runs `fn` with the given chapters of `book` filled in. Chapters that
     * don't exist in the translation are skipped, so the engine reports them
     * as not found. The fill and `fn` run synchronously after all fetches,
     * so concurrent lookups never see each other's chapters.
     */
    async #withChapters(id, book, chapterNumbers, fn) {
        const { engine, bible } = await this.#engineFor(id);
        const chapters = engine.bibleData[book];
        const wanted = chapterNumbers.filter((n) => chapters && Object.hasOwn(chapters, String(n)));
        const bookId = bookIdFor(book);
        const loaded = await Promise.all(wanted.map((n) => this.client.getChapter(id, `${bookId}.${n}`)));
        try {
            wanted.forEach((n, i) => { chapters[String(n)] = loaded[i].verses; });
            return fn(engine, { bible, copyright: loaded.find((c) => c.copyright)?.copyright || bible.copyright, loaded });
        } finally {
            for (const n of wanted) chapters[String(n)] = null;
        }
    }

    /** @returns {Promise<{ version, bible, books: Array<{ name, chapterCount }> }>} */
    async getBooks(bibleId) {
        const { engine, bible } = await this.#engineFor(this.resolveBibleId(bibleId));
        return { ...engine.getBooks(), bible };
    }

    /** Abbreviations for typeahead; the same for every translation. */
    getBookAliases() {
        return { aliases: { ...BOOK_ABBREVIATIONS } };
    }

    /**
     * Chapters of a book with their usual verse counts (from the bundled
     * versification table, so nothing is fetched).
     */
    async getChapters(bibleId, book) {
        const { engine } = await this.#engineFor(this.resolveBibleId(bibleId));
        const name = engine.resolveBookName(book);
        if (!name) throw new BibleServiceError(`Book not found: ${book}`, 404);
        const counts = VERSE_COUNTS[bookIdFor(name)] ?? [];
        return {
            version: engine.version,
            book: name,
            chapters: Object.keys(engine.bibleData[name])
                .map(Number)
                .sort((a, b) => a - b)
                .map((chapter) => ({ chapter, verseCount: counts[chapter - 1] ?? null })),
        };
    }

    /** One chapter's verses, plus its headings for display (one API call unless cached). */
    async getVerses(bibleId, book, chapter) {
        const id = this.resolveBibleId(bibleId);
        const { engine } = await this.#engineFor(id);
        const name = engine.resolveBookName(book);
        if (!name) throw new BibleServiceError(`Book not found: ${book}`, 404);
        const chapterNumber = Number(chapter);
        if (!Number.isInteger(chapterNumber) || chapterNumber <= 0 || !/^\s*\d+\s*$/.test(String(chapter))) {
            throw new BibleServiceError('Chapter must be a positive integer', 400);
        }
        return this.#withChapters(id, name, [chapterNumber], (e, { loaded }) => ({
            ...e.getVerses(name, chapterNumber),
            headings: loaded[0]?.headings ?? [],
        }));
    }

    /**
     * Resolves a free-text reference (see BibleService.getPassage) in the
     * given translation. The passage also carries `bible` and `copyright`.
     */
    async getPassage(bibleId, reference) {
        const id = this.resolveBibleId(bibleId);
        const { engine } = await this.#engineFor(id);
        const { book, chapters } = engine.chaptersForReference(reference);
        if (chapters.length > MAX_CHAPTERS_PER_REFERENCE) {
            throw new BibleServiceError(`Passage is too long (${chapters.length} chapters; at most ${MAX_CHAPTERS_PER_REFERENCE})`, 400);
        }
        return this.#withChapters(id, book, chapters, (e, { bible, copyright }) => ({
            ...e.getPassage(reference),
            bible: { ...bible, copyright },
        }));
    }

    /**
     * Resolves many references; each result is `{ ok: true, passage }` or
     * `{ ok: false, error, status }`, so one bad reference doesn't fail the
     * batch. Configuration and API.Bible outages fail the whole batch.
     */
    async getPassages(bibleId, references) {
        if (!Array.isArray(references)) throw new BibleServiceError('refs must be an array of strings', 400);
        if (references.length > MAX_REFERENCES) throw new BibleServiceError(`Too many references (max ${MAX_REFERENCES})`, 400);
        const id = this.resolveBibleId(bibleId);
        const { engine } = await this.#engineFor(id);
        const unique = [...new Set(references.filter((r) => typeof r === 'string'))];
        const results = {};
        await Promise.all(unique.map(async (reference) => {
            try {
                results[reference] = { ok: true, passage: await this.getPassage(id, reference) };
            } catch (error) {
                const perReference = (error instanceof BibleServiceError && !(error instanceof BibleConfigError))
                    || (error instanceof ApiBibleError && (error.status === 404 || error.status === 400));
                if (!perReference) throw error;
                results[reference] = { ok: false, error: error.message, status: error.status };
            }
        }));
        return { version: engine.version, results };
    }

    /**
     * A chapter's verse text with no reference parsing, for rewriting stored
     * scripture whose verses may not all exist in this translation.
     *
     * @returns {Promise<{ book: string, bookId: string, chapter: number, verses: Record<string, string>, bible: object } | null>}
     *   null when the book or chapter isn't in the translation.
     */
    async getChapterText(bibleId, book, chapter) {
        const id = this.resolveBibleId(bibleId);
        const { engine } = await this.#engineFor(id);
        const name = engine.resolveBookName(String(book ?? '').trim());
        const chapterNumber = Number(chapter);
        if (!name || !Number.isInteger(chapterNumber) || !Object.hasOwn(engine.bibleData[name], String(chapterNumber))) return null;
        const bookId = bookIdFor(name);
        return this.#withChapters(id, name, [chapterNumber], (e, { bible, copyright }) => ({
            book: name,
            bookId,
            chapter: chapterNumber,
            verses: { ...e.bibleData[name][String(chapterNumber)] },
            bible: { ...bible, copyright },
        }));
    }
}
