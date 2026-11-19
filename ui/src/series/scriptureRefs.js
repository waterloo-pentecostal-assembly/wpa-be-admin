// Helpers for scripture references stored in drafts. Drafts keep only the
// reference text (e.g. "Matthew 1:18-25"); verse text is resolved through the
// server's Bible API (API.Bible) in the series' translation when previewing
// or publishing.
//
// Stored scripture blocks keep the format existing app versions read
// (`attribution`, `bible_version`, `scriptures[].verses` with the text in the
// series' translation), and give each chapter entry the API.Bible passage
// IDs an app can fetch in whatever translation it chooses (each starts with
// the USFM book code, e.g. "ROM"):
//
//   {
//     body_type: 'scripture',
//     attribution: '<translation copyright>',
//     bible_version: 'Scripture quotations taken from <name> (<abbr>)',
//     scriptures: [{
//       book: 'Romans', chapter: '4', title: 'Romans 4:1-3, 5',
//       verses: { '1': '...', '2': '...', '3': '...', '5': '...' },
//       passage_ids: ['ROM.4.1-ROM.4.3', 'ROM.4.5-ROM.4.5'],
//     }],
//   }
//
// Passage IDs don't depend on the translation: an app fetches each with
// GET /bibles/{its bible ID}/passages/{passage_id} through the Bible proxy (not
// API.Bible directly; apps hold no API.Bible key).
// Which translation the stored text is in is recorded once per series, in the
// admin-only `scripture_bible_id` field of the bible_series document.

// A reference part starts a new book when it begins with a book name, which
// may carry a numeric prefix ("1 Kings", "2 Cor"). Parts like "4:1-34" or
// "5" continue the previous book.
const BOOK_START = /^\s*(?:[1-3]\s*)?[A-Za-z]/;

/**
 * Splits a reference that may span several books into single-book
 * references the Bible API can resolve:
 *   "Psalm 1; Psalm 2"        -> ["Psalm 1", "Psalm 2"]
 *   "1 Kings 3:1-28; 4:1-34"  -> ["1 Kings 3:1-28; 4:1-34"]
 */
export function splitReference(ref) {
    if (typeof ref !== 'string') return [];
    const parts = ref.split(/([;,])/);
    const refs = [];
    let current = '';
    for (let i = 0; i < parts.length; i += 2) {
        const part = parts[i];
        const separator = i > 0 ? parts[i - 1] : '';
        if (part.trim() === '') continue;
        if (current && !BOOK_START.test(part)) {
            current += `${separator}${part}`;
        } else {
            if (current.trim()) refs.push(current.trim());
            current = part;
        }
    }
    if (current.trim()) refs.push(current.trim());
    return refs;
}

/** Formats sorted verse numbers as compact ranges: [1,2,3,5] -> "1-3, 5". */
export function formatVerseRanges(verseNumbers) {
    const nums = [...new Set(verseNumbers.map(Number))].filter(Number.isFinite).sort((a, b) => a - b);
    const runs = [];
    for (const n of nums) {
        const last = runs.at(-1);
        if (last && n === last[1] + 1) last[1] = n;
        else runs.push([n, n]);
    }
    return runs.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(', ');
}

/**
 * Builds a reference string from output-format scripture objects
 * ({ book, chapter, verses: { n: text } }), grouping chapters of the same
 * book: [1 Kings 3:1-28, 1 Kings 4:1-34] -> "1 Kings 3:1-28; 4:1-34".
 */
export function referenceFromScriptures(scriptures) {
    const groups = [];
    for (const s of scriptures ?? []) {
        if (!s?.book) continue;
        const verses = formatVerseRanges(Object.keys(s.verses ?? {}));
        const chapterPart = verses ? `${s.chapter}:${verses}` : `${s.chapter}`;
        const last = groups.at(-1);
        if (last && last.book === s.book) last.parts.push(chapterPart);
        else groups.push({ book: s.book, parts: [chapterPart] });
    }
    return groups.map((g) => `${g.book} ${g.parts.join('; ')}`).join('; ');
}

/**
 * API.Bible passage IDs for verses of one chapter, one per run of
 * consecutive verses: ('ROM', 4, [1, 2, 3, 5]) -> ['ROM.4.1-ROM.4.3', 'ROM.4.5-ROM.4.5'].
 * Always "<start>-<end>", the documented passage ID form.
 */
export function passageIdsFor(bookId, chapter, verseNumbers) {
    if (!bookId) return [];
    const ranges = formatVerseRanges(verseNumbers);
    if (!ranges) return [];
    return ranges.split(', ').map((run) => {
        const [start, end = start] = run.split('-');
        return `${bookId}.${chapter}.${start}-${bookId}.${chapter}.${end}`;
    });
}

/**
 * Converts resolved passages (Bible API `getPassage` results) to the
 * output `scriptures` array: one entry per chapter, verses keyed by number,
 * with the chapter's API.Bible book ID and passage IDs.
 */
export function passagesToScriptures(passages, title = '') {
    const scriptures = [];
    for (const passage of passages) {
        const byChapter = new Map();
        for (const v of passage.verses) {
            if (!byChapter.has(v.chapter)) byChapter.set(v.chapter, []);
            byChapter.get(v.chapter).push(v);
        }
        for (const [chapter, verses] of byChapter) {
            const verseMap = {};
            for (const v of verses) verseMap[String(v.verse)] = v.text;
            const numbers = verses.map((v) => v.verse);
            scriptures.push({
                book: passage.book,
                chapter: String(chapter),
                title: `${passage.book} ${chapter}:${formatVerseRanges(numbers)}`,
                verses: verseMap,
                ...(passage.bookId ? { passage_ids: passageIdsFor(passage.bookId, chapter, numbers) } : {}),
            });
        }
    }
    if (title && scriptures.length) scriptures[0].title = title;
    return scriptures;
}

/** The `bible_version` line existing app versions show under scripture. */
export function bibleVersionLine(bible) {
    if (!bible?.name) return bible?.abbreviation ?? '';
    const abbreviation = bible.abbreviation && !bible.name.includes(bible.abbreviation) ? ` (${bible.abbreviation})` : '';
    return `Scripture quotations taken from ${bible.name}${abbreviation}`;
}

/**
 * A stored scripture block. `bible` is the translation the verses came from
 * (`passage.bible` from the Bible API: { id, abbreviation, name, copyright }).
 */
export function scriptureBodyBlock(scriptures, bible = null) {
    return {
        attribution: bible?.copyright ?? '',
        bible_version: bibleVersionLine(bible),
        body_type: 'scripture',
        scriptures,
    };
}
