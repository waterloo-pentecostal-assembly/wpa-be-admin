import fs from 'fs';

/**
 * Error raised for expected Bible lookup failures. `status` is the HTTP
 * status the API layer should return (400 for malformed input, 404 for a
 * book or chapter that does not exist).
 */
export class BibleServiceError extends Error {
    constructor(message, status) {
        super(message);
        this.name = 'BibleServiceError';
        this.status = status;
    }
}

function sortedNumericKeys(obj) {
    return Object.keys(obj).sort((a, b) => Number(a) - Number(b));
}

// Common book abbreviations accepted in passage references (e.g. "Rom 4:1-6").
// Ambiguous short forms are deliberately omitted or pinned to the most common
// convention (e.g. "Phil" = Philippians, "Phlm" = Philemon; "Jud" = Jude,
// "Judg"/"Jdg" = Judges).
const BOOK_ABBREVIATIONS = {
    Genesis: ['Gen', 'Ge', 'Gn'],
    Exodus: ['Exod', 'Exo', 'Ex'],
    Leviticus: ['Lev', 'Le', 'Lv'],
    Numbers: ['Num', 'Nu', 'Nm'],
    Deuteronomy: ['Deut', 'Dt', 'De'],
    Joshua: ['Josh', 'Jos'],
    Judges: ['Judg', 'Jdg', 'Jgs'],
    Ruth: ['Rth', 'Ru'],
    '1 Samuel': ['1 Sam', '1 Sa'],
    '2 Samuel': ['2 Sam', '2 Sa'],
    '1 Kings': ['1 Kgs', '1 Ki'],
    '2 Kings': ['2 Kgs', '2 Ki'],
    '1 Chronicles': ['1 Chron', '1 Chr', '1 Ch'],
    '2 Chronicles': ['2 Chron', '2 Chr', '2 Ch'],
    Ezra: ['Ezr'],
    Nehemiah: ['Neh', 'Ne'],
    Esther: ['Esth', 'Est'],
    Job: ['Jb'],
    Psalms: ['Psalm', 'Psa', 'Ps', 'Psm'],
    Proverbs: ['Prov', 'Pro', 'Prv'],
    Ecclesiastes: ['Eccl', 'Ecc', 'Ec'],
    'Song of Solomon': ['Song of Songs', 'Song', 'Canticles', 'Cant', 'SOS'],
    Isaiah: ['Isa', 'Is'],
    Jeremiah: ['Jer', 'Je'],
    Lamentations: ['Lam', 'La'],
    Ezekiel: ['Ezek', 'Eze', 'Ezk'],
    Daniel: ['Dan', 'Da'],
    Hosea: ['Hos', 'Ho'],
    Joel: ['Joe', 'Jl'],
    Amos: ['Am'],
    Obadiah: ['Obad', 'Ob'],
    Jonah: ['Jon', 'Jnh'],
    Micah: ['Mic', 'Mc'],
    Nahum: ['Nah', 'Na'],
    Habakkuk: ['Hab'],
    Zephaniah: ['Zeph', 'Zep'],
    Haggai: ['Hag', 'Hg'],
    Zechariah: ['Zech', 'Zec'],
    Malachi: ['Mal', 'Ml'],
    Matthew: ['Matt', 'Mt'],
    Mark: ['Mk', 'Mrk'],
    Luke: ['Lk', 'Luk'],
    John: ['Jn', 'Jhn'],
    Acts: ['Act', 'Ac'],
    Romans: ['Rom', 'Ro', 'Rm'],
    '1 Corinthians': ['1 Cor', '1 Co'],
    '2 Corinthians': ['2 Cor', '2 Co'],
    Galatians: ['Gal', 'Ga'],
    Ephesians: ['Eph', 'Ep'],
    Philippians: ['Phil', 'Php'],
    Colossians: ['Col'],
    '1 Thessalonians': ['1 Thess', '1 Thes', '1 Th'],
    '2 Thessalonians': ['2 Thess', '2 Thes', '2 Th'],
    '1 Timothy': ['1 Tim', '1 Ti'],
    '2 Timothy': ['2 Tim', '2 Ti'],
    Titus: ['Tit'],
    Philemon: ['Philem', 'Phlm', 'Phm'],
    Hebrews: ['Heb', 'He'],
    James: ['Jas', 'Jam'],
    '1 Peter': ['1 Pet', '1 Pe', '1 Pt'],
    '2 Peter': ['2 Pet', '2 Pe', '2 Pt'],
    '1 John': ['1 Jn', '1 Jhn'],
    '2 John': ['2 Jn', '2 Jhn'],
    '3 John': ['3 Jn', '3 Jhn'],
    Jude: ['Jud'],
    Revelation: ['Rev', 'Re', 'Rv'],
};

function normalizeBookPhrase(phrase) {
    return phrase.toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
}

// Builds the matchable book phrases (canonical names + abbreviations, with
// spaced and compact spellings) sorted longest-first so that e.g. "Jonah"
// wins over "Jon" and "Psalms" wins over "Ps". A phrase that would map to two
// different books is dropped rather than resolved arbitrarily.
function buildBookCandidates(bibleData) {
    const byPhrase = new Map();
    const add = (phrase, canonical) => {
        const normalized = normalizeBookPhrase(phrase);
        const variants = new Set([normalized, normalized.replace(/ /g, '')]);
        if (normalized.startsWith('1 ')) variants.add(`i ${normalized.slice(2)}`);
        if (normalized.startsWith('2 ')) variants.add(`ii ${normalized.slice(2)}`);
        if (normalized.startsWith('3 ')) variants.add(`iii ${normalized.slice(2)}`);
        for (const variant of variants) {
            if (byPhrase.has(variant) && byPhrase.get(variant) !== canonical) {
                byPhrase.set(variant, null);
            } else {
                byPhrase.set(variant, canonical);
            }
        }
    };
    for (const canonical of Object.keys(bibleData)) {
        add(canonical, canonical);
        for (const abbreviation of BOOK_ABBREVIATIONS[canonical] ?? []) {
            add(abbreviation, canonical);
        }
    }
    return [...byPhrase.entries()]
        .filter(([, canonical]) => canonical !== null)
        .map(([phrase, book]) => ({ phrase, book }))
        .sort((a, b) => b.phrase.length - a.phrase.length || a.phrase.localeCompare(b.phrase));
}

/**
 * Serves Bible lookups from parsed `niv.json` data shaped as
 * `{ [book]: { [chapter]: { [verse]: text } } }`, with books in canonical
 * order and chapter/verse keys as numeric strings.
 */
export class BibleService {
    /**
     * @param {Object} bibleData - Parsed niv.json content
     * @param {{ version?: string }} [options]
     */
    constructor(bibleData, { version = 'NIV' } = {}) {
        if (!bibleData || typeof bibleData !== 'object' || Object.keys(bibleData).length === 0) {
            throw new Error('BibleService requires non-empty bible data');
        }
        this.bibleData = bibleData;
        this.version = version;
        this.bookCandidates = buildBookCandidates(bibleData);
    }

    /**
     * Resolves a requested book name to the canonical key in the data.
     * Matching is case-insensitive (ignoring surrounding whitespace) and the
     * singular "Psalm" resolves to "Psalms", matching populateBibleVerses.
     *
     * @param {string} book
     * @returns {string|null} Canonical book name, or null when unknown
     */
    resolveBookName(book) {
        if (typeof book !== 'string') return null;
        const requested = book.trim();
        if (!requested) return null;
        if (Object.hasOwn(this.bibleData, requested)) return requested;

        const normalized = requested.toLowerCase();
        const alias = normalized === 'psalm' ? 'Psalms' : null;
        if (alias && Object.hasOwn(this.bibleData, alias)) return alias;

        return Object.keys(this.bibleData).find(
            (name) => name.toLowerCase() === normalized,
        ) ?? null;
    }

    /** @returns {{ version: string, books: Array<{ name: string, chapterCount: number }> }} */
    getBooks() {
        return {
            version: this.version,
            books: Object.keys(this.bibleData).map((name) => ({
                name,
                chapterCount: Object.keys(this.bibleData[name]).length,
            })),
        };
    }

    /**
     * Common abbreviations for each book in the data, for typeahead.
     * @returns {{ version: string, aliases: Record<string, string[]> }}
     */
    getBookAliases() {
        const aliases = {};
        for (const name of Object.keys(this.bibleData)) aliases[name] = BOOK_ABBREVIATIONS[name] ?? [];
        return { version: this.version, aliases };
    }

    /**
     * Resolves many references at once. Each result is either
     * `{ ok: true, passage }` or `{ ok: false, error, status }`, so one bad
     * reference does not fail the batch.
     *
     * @param {string[]} references
     * @returns {{ version: string, results: Record<string, object> }}
     */
    getPassages(references) {
        if (!Array.isArray(references)) {
            throw new BibleServiceError('refs must be an array of strings', 400);
        }
        if (references.length > 500) {
            throw new BibleServiceError('Too many references (max 500)', 400);
        }
        const results = {};
        for (const reference of references) {
            if (typeof reference !== 'string' || Object.hasOwn(results, reference)) continue;
            try {
                results[reference] = { ok: true, passage: this.getPassage(reference) };
            } catch (error) {
                if (!(error instanceof BibleServiceError)) throw error;
                results[reference] = { ok: false, error: error.message, status: error.status };
            }
        }
        return { version: this.version, results };
    }

    /**
     * @param {string} book - Book name as requested (canonical name is returned)
     * @returns {{ version: string, book: string, chapters: Array<{ chapter: number, verseCount: number }> }}
     */
    getChapters(book) {
        const canonicalBook = this.#requireBook(book);
        const chapters = this.bibleData[canonicalBook];
        return {
            version: this.version,
            book: canonicalBook,
            chapters: sortedNumericKeys(chapters).map((chapter) => ({
                chapter: Number(chapter),
                verseCount: Object.keys(chapters[chapter]).length,
            })),
        };
    }

    /**
     * @param {string} book - Book name as requested (canonical name is returned)
     * @param {string|number} chapter - Chapter number (positive integer)
     * @returns {{ version: string, book: string, chapter: number, verses: Array<{ verse: number, text: string }> }}
     */
    getVerses(book, chapter) {
        const canonicalBook = this.#requireBook(book);
        const chapterNumber = this.#parseChapter(chapter);
        const verses = this.bibleData[canonicalBook][String(chapterNumber)];
        if (!verses) {
            throw new BibleServiceError(
                `Chapter not found: ${canonicalBook} ${chapterNumber}`,
                404,
            );
        }
        return {
            version: this.version,
            book: canonicalBook,
            chapter: chapterNumber,
            verses: sortedNumericKeys(verses).map((verse) => ({
                verse: Number(verse),
                text: verses[verse],
            })),
        };
    }

    /**
     * Resolves a free-text passage reference to its verses. Accepted forms
     * (book names are case-insensitive and common abbreviations work):
     * "Romans 4:1-6", "John 3:16", "Romans 4" (whole chapter),
     * "Romans 4:1-3, 5" (multiple ranges), "Romans 4:23-5:2"
     * (cross-chapter), and "Romans 4-5" (whole chapters).
     * Verses are returned in Bible order, de-duplicated. `chapter` is the
     * single chapter covered, or null when the passage spans chapters;
     * `chapters` always lists every chapter covered.
     *
     * @param {string} reference
     * @returns {{ version: string, reference: string, book: string, chapter: number|null,
     *   chapters: number[], verses: Array<{ chapter: number, verse: number, text: string }> }}
     */
    getPassage(reference) {
        const { book, segments } = this.#parsePassageReference(reference);
        const byCoordinate = new Map();
        for (const segment of segments) {
            for (const coordinate of this.#expandSegment(book, segment)) {
                byCoordinate.set(`${coordinate.chapter}:${coordinate.verse}`, coordinate);
            }
        }
        const coordinates = [...byCoordinate.values()].sort(
            (a, b) => a.chapter - b.chapter || a.verse - b.verse,
        );
        const chapters = [...new Set(coordinates.map((c) => c.chapter))];
        return {
            version: this.version,
            reference: this.#formatReference(book, coordinates),
            book,
            chapter: chapters.length === 1 ? chapters[0] : null,
            chapters,
            verses: coordinates.map(({ chapter, verse }) => ({
                chapter,
                verse,
                text: this.bibleData[book][String(chapter)][String(verse)],
            })),
        };
    }

    #parsePassageReference(reference) {
        if (typeof reference !== 'string' || reference.trim() === '') {
            throw new BibleServiceError('Reference is required', 400);
        }
        const normalizedRef = reference
            .trim()
            .replace(/[\u2013\u2014]/g, '-')
            .replace(/\./g, '')
            .replace(/\s+/g, ' ');
        const { book, body } = this.#extractBook(normalizedRef, reference);
        return { book, segments: this.#parseSegments(body, reference) };
    }

    #extractBook(normalizedRef, originalReference) {
        const lowerRef = normalizedRef.toLowerCase();
        for (const { phrase, book } of this.bookCandidates) {
            if (!lowerRef.startsWith(phrase)) continue;
            const remainder = normalizedRef.slice(phrase.length).trim();
            if (remainder === '') {
                throw new BibleServiceError(
                    `Invalid Bible reference: ${originalReference.trim()}`,
                    400,
                );
            }
            if (/^\d/.test(remainder)) {
                return { book, body: remainder };
            }
        }
        const fallback = normalizedRef.match(/^(.+?)\s+(\d.*)$/);
        if (fallback) {
            throw new BibleServiceError(`Book not found: ${fallback[1].trim()}`, 404);
        }
        throw new BibleServiceError(
            `Invalid Bible reference: ${originalReference.trim()}`,
            400,
        );
    }

    // Parses the part after the book name into segments. Each segment is
    // { startChapter, startVerse, endChapter, endVerse } where a null verse
    // means "the first/last verse of that chapter" (whole-chapter bounds).
    // Bare numbers after a verse segment are verses in the same chapter
    // ("4:1-3, 5"); bare numbers after a chapter segment are chapters
    // ("4, 5").
    #parseSegments(body, originalReference) {
        const invalid = () => new BibleServiceError(
            `Invalid Bible reference: ${originalReference.trim()}`,
            400,
        );
        const positiveInt = (value) => {
            const number = Number(value);
            if (!Number.isInteger(number) || number <= 0) throw invalid();
            return number;
        };
        const segments = [];
        let currentChapter = null;
        let lastKind = null; // 'verse' | 'chapter'

        for (const rawSegment of body.split(/[;,]/)) {
            const segment = rawSegment.replace(/\s+/g, '');
            if (segment === '') throw invalid();
            let match;
            if ((match = segment.match(/^(\d+):(\d+)-(\d+):(\d+)$/))) {
                const [, startChapter, startVerse, endChapter, endVerse] = match.map(positiveIntOrSelf);
                segments.push({ startChapter, startVerse, endChapter, endVerse });
                currentChapter = endChapter;
                lastKind = 'verse';
            } else if ((match = segment.match(/^(\d+)-(\d+):(\d+)$/))) {
                const [, first, endChapter, endVerse] = match.map(positiveIntOrSelf);
                if (lastKind === 'verse') {
                    segments.push({ startChapter: currentChapter, startVerse: first, endChapter, endVerse });
                } else {
                    segments.push({ startChapter: first, startVerse: null, endChapter, endVerse });
                }
                currentChapter = endChapter;
                lastKind = 'verse';
            } else if ((match = segment.match(/^(\d+):(\d+)(?:-(\d+))?$/))) {
                const chapter = positiveInt(match[1]);
                const startVerse = positiveInt(match[2]);
                const endVerse = match[3] === undefined ? startVerse : positiveInt(match[3]);
                segments.push({ startChapter: chapter, startVerse, endChapter: chapter, endVerse });
                currentChapter = chapter;
                lastKind = 'verse';
            } else if ((match = segment.match(/^(\d+)(?:-(\d+))?$/))) {
                const first = positiveInt(match[1]);
                const second = match[2] === undefined ? first : positiveInt(match[2]);
                if (lastKind === 'verse') {
                    segments.push({
                        startChapter: currentChapter, startVerse: first,
                        endChapter: currentChapter, endVerse: second,
                    });
                } else {
                    segments.push({
                        startChapter: first, startVerse: null,
                        endChapter: second, endVerse: null,
                    });
                    currentChapter = second;
                    lastKind = 'chapter';
                }
            } else {
                throw invalid();
            }
        }
        return segments;

        function positiveIntOrSelf(value, index) {
            return index === 0 ? value : positiveInt(value);
        }
    }

    #requireBook(book) {
        const canonicalBook = this.resolveBookName(book);
        if (!canonicalBook) {
            throw new BibleServiceError(`Book not found: ${book}`, 404);
        }
        return canonicalBook;
    }

    #parseChapter(chapter) {
        const raw = typeof chapter === 'string' ? chapter.trim() : chapter;
        const isPositiveInteger =
            (typeof raw === 'number' && Number.isInteger(raw) && raw > 0) ||
            (typeof raw === 'string' && /^[0-9]+$/.test(raw) && Number(raw) > 0);
        if (!isPositiveInteger) {
            throw new BibleServiceError('Chapter must be a positive integer', 400);
        }
        return Number(raw);
    }

    #requireChapterVerses(book, chapter) {
        const verses = this.bibleData[book][String(chapter)];
        if (!verses) {
            throw new BibleServiceError(`Chapter not found: ${book} ${chapter}`, 404);
        }
        return verses;
    }

    #firstVerse(book, chapter) {
        return Number(sortedNumericKeys(this.#requireChapterVerses(book, chapter))[0]);
    }

    #lastVerse(book, chapter) {
        return Number(sortedNumericKeys(this.#requireChapterVerses(book, chapter)).at(-1));
    }

    // Expands one parsed segment to its verse coordinates, validating that
    // every chapter and verse it touches exists. Out-of-range references are
    // errors (404), never silently clamped to the chapter end.
    #expandSegment(book, segment) {
        const {
            startChapter, startVerse: givenStartVerse,
            endChapter, endVerse: givenEndVerse,
        } = segment;
        const startVerses = this.#requireChapterVerses(book, startChapter);
        const endVerses = this.#requireChapterVerses(book, endChapter);
        const startVerse = givenStartVerse ?? this.#firstVerse(book, startChapter);
        const endVerse = givenEndVerse ?? this.#lastVerse(book, endChapter);

        const requireVerse = (verses, chapter, verse) => {
            if (verses[String(verse)] === undefined) {
                throw new BibleServiceError(
                    `Verse not found: ${book} ${chapter}:${verse}`,
                    404,
                );
            }
        };
        requireVerse(startVerses, startChapter, startVerse);
        requireVerse(endVerses, endChapter, endVerse);

        if (startChapter > endChapter
            || (startChapter === endChapter && startVerse > endVerse)) {
            throw new BibleServiceError(
                `Invalid Bible reference: ${book} ${startChapter}:${startVerse}-${endChapter}:${endVerse}`,
                400,
            );
        }

        const coordinates = [];
        for (let chapter = startChapter; chapter <= endChapter; chapter++) {
            const verses = this.#requireChapterVerses(book, chapter);
            const from = chapter === startChapter ? startVerse : this.#firstVerse(book, chapter);
            const to = chapter === endChapter ? endVerse : this.#lastVerse(book, chapter);
            for (let verse = from; verse <= to; verse++) {
                requireVerse(verses, chapter, verse);
                coordinates.push({ chapter, verse });
            }
        }
        return coordinates;
    }

    // Formats the canonical reference for a sorted, de-duplicated coordinate
    // list, merging contiguous verses (including across chapter boundaries
    // and whole-chapter spans) so the reference describes exactly the verses
    // returned.
    #formatReference(book, coordinates) {
        const isContiguous = (prev, next) => (
            (next.chapter === prev.chapter && next.verse === prev.verse + 1)
            || (next.chapter === prev.chapter + 1
                && prev.verse === this.#lastVerse(book, prev.chapter)
                && next.verse === this.#firstVerse(book, next.chapter))
        );
        const runs = [];
        let runStart = coordinates[0];
        let previous = coordinates[0];
        for (const coordinate of coordinates.slice(1)) {
            if (!isContiguous(previous, coordinate)) {
                runs.push({ start: runStart, end: previous });
                runStart = coordinate;
            }
            previous = coordinate;
        }
        runs.push({ start: runStart, end: previous });

        const formattedRuns = runs.map(({ start, end }) => {
            const coversWholeChapters = start.verse === this.#firstVerse(book, start.chapter)
                && end.verse === this.#lastVerse(book, end.chapter);
            if (coversWholeChapters) {
                return {
                    kind: 'chapters',
                    text: start.chapter === end.chapter
                        ? `${start.chapter}`
                        : `${start.chapter}-${end.chapter}`,
                };
            }
            if (start.chapter === end.chapter) {
                return {
                    kind: 'verses',
                    chapter: start.chapter,
                    verseText: start.verse === end.verse
                        ? `${start.verse}`
                        : `${start.verse}-${end.verse}`,
                };
            }
            return {
                kind: 'cross',
                text: `${start.chapter}:${start.verse}-${end.chapter}:${end.verse}`,
            };
        });

        const groups = [];
        for (const run of formattedRuns) {
            const last = groups.at(-1);
            if (run.kind === 'verses' && last?.kind === 'verses' && last.chapter === run.chapter) {
                last.verseTexts.push(run.verseText);
            } else if (run.kind === 'verses') {
                groups.push({ kind: 'verses', chapter: run.chapter, verseTexts: [run.verseText] });
            } else {
                groups.push(run);
            }
        }
        const groupTexts = groups.map((group) => (
            group.kind === 'verses'
                ? `${group.chapter}:${group.verseTexts.join(', ')}`
                : group.text
        ));
        return `${book} ${groupTexts.join('; ')}`;
    }
}

/**
 * Loads a BibleService from a niv.json file. Throws when the file is
 * missing or cannot be parsed; callers that must keep running without
 * Bible data should catch and pass `null` to createBibleRouter instead.
 *
 * @param {string} filePath - Path to niv.json
 * @returns {BibleService}
 */
export function loadBibleService(filePath) {
    const bibleData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return new BibleService(bibleData);
}
