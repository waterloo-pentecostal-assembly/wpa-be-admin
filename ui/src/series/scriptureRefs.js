// Helpers for scripture references stored in drafts. Drafts keep only the
// reference text (e.g. "Matthew 1:18-25"); verse text is resolved from the
// NIV data when previewing or publishing.

export const NIV_BIBLE_VERSION = 'Scripture quotations taken from The Holy Bible, New International Version® NIV®';
export const NIV_ATTRIBUTION = 'Copyright © 1973 1978 1984 2011 by Biblica, Inc. TM\nUsed by permission. All rights reserved worldwide';

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
 * Converts resolved passages (Bible API `getPassage` results) to the
 * output `scriptures` array: one entry per chapter, verses keyed by number.
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
            scriptures.push({
                book: passage.book,
                chapter: String(chapter),
                title: `${passage.book} ${chapter}:${formatVerseRanges(verses.map((v) => v.verse))}`,
                verses: verseMap,
            });
        }
    }
    if (title && scriptures.length) scriptures[0].title = title;
    return scriptures;
}

export function scriptureBodyBlock(scriptures) {
    return {
        attribution: NIV_ATTRIBUTION,
        bible_version: NIV_BIBLE_VERSION,
        body_type: 'scripture',
        scriptures,
    };
}
