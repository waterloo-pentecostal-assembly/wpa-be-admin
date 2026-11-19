// Book list + abbreviations for scripture typeahead, fetched once per translation.
import { fetchBookAliases, fetchBookList } from '../api/seriesBuilderApi';
import { fetchBibleChapters } from '../api/bibleApi';

const booksPromises = new Map(); // bibleId -> Promise
const chapterCache = new Map(); // `${bibleId}|${book}` -> Promise

/** @returns {Promise<Array<{ name: string, chapterCount: number, aliases: string[] }>>} */
export function loadBooks(bibleId = 'default') {
    if (!booksPromises.has(bibleId)) {
        booksPromises.set(bibleId, Promise.all([fetchBookList(bibleId), fetchBookAliases().catch(() => ({ aliases: {} }))])
            .then(([{ books }, { aliases }]) => books.map((b) => ({ ...b, aliases: aliases[b.name] ?? [] })))
            .catch((error) => {
                booksPromises.delete(bibleId);
                throw error;
            }));
    }
    return booksPromises.get(bibleId);
}

/** @returns {Promise<Array<{ chapter: number, verseCount: number|null }>>} */
export function loadChapters(book, bibleId = 'default') {
    const key = `${bibleId}|${book}`;
    if (!chapterCache.has(key)) {
        chapterCache.set(key, fetchBibleChapters(book, bibleId).then((d) => d.chapters).catch((error) => {
            chapterCache.delete(key);
            throw error;
        }));
    }
    return chapterCache.get(key);
}

const norm = (s) => s.toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
const compact = (s) => norm(s).replace(/ /g, '');

/**
 * Books matching what has been typed so far, best first. Matches the start
 * of the name ("mat" -> Matthew), an abbreviation ("jn" -> John), compact
 * numbered forms ("1co" -> 1 Corinthians) or the start of any word.
 */
export function suggestBooks(books, query, limit = 7) {
    const q = norm(query);
    if (!q) return [];
    const qc = compact(query);
    const scored = [];
    for (const book of books) {
        const name = norm(book.name);
        let score = 0;
        if (name === q) score = 100;
        else if (name.startsWith(q) || compact(book.name).startsWith(qc)) score = 80;
        else if (book.aliases.some((a) => norm(a) === q || compact(a) === qc)) score = 75;
        else if (book.aliases.some((a) => norm(a).startsWith(q))) score = 60;
        else if (name.split(' ').some((w) => w.startsWith(q))) score = 40;
        if (score) scored.push({ book, score });
    }
    return scored.sort((a, b) => b.score - a.score || a.book.name.length - b.book.name.length).slice(0, limit).map((s) => s.book);
}

/** Splits typed text into a book part and the chapter/verse part. */
export function splitTyped(text) {
    const match = /^\s*((?:[1-3]\s*)?[A-Za-z][A-Za-z .]*?)\s*(\d[\d:,;\s-]*)?$/.exec(text ?? '');
    if (!match) return { bookText: text ?? '', rest: '' };
    return { bookText: match[1] ?? '', rest: match[2] ?? '' };
}

export function findBook(books, bookText) {
    const q = norm(bookText);
    const qc = compact(bookText);
    if (!q) return null;
    return books.find((b) => norm(b.name) === q || compact(b.name) === qc)
        ?? books.find((b) => b.aliases.some((a) => norm(a) === q || compact(a) === qc))
        ?? null;
}
