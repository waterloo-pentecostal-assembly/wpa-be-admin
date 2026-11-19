// Verse selection for the scripture picker, spanning any number of books and
// chapters (e.g. Ezra 4:2-6 and Genesis 1:1-4).
//
// selection = [{ book, chapter: number, verses: { [verse]: text } }], one item
// per chapter in the order chapters were first picked; empty chapters are
// dropped. All functions return new arrays.

import { formatVerseRanges } from './scriptureRefs.js';

const same = (item, book, chapter) => item.book === book && item.chapter === Number(chapter);

/** Selected verses ({ [verse]: text }) in one chapter. */
export function chapterSelection(selection, book, chapter) {
    return selection.find((item) => same(item, book, chapter))?.verses ?? {};
}

/**
 * Adds and removes verses in one chapter. `changes` maps verse numbers to
 * their text (select) or null (deselect).
 */
export function updateChapter(selection, book, chapter, changes) {
    const index = selection.findIndex((item) => same(item, book, chapter));
    const verses = { ...(index >= 0 ? selection[index].verses : {}) };
    for (const [verse, text] of Object.entries(changes)) {
        if (text == null) delete verses[verse];
        else verses[verse] = text;
    }
    const next = [...selection];
    if (!Object.keys(verses).length) {
        if (index >= 0) next.splice(index, 1);
    } else if (index >= 0) {
        next[index] = { ...selection[index], verses };
    } else {
        next.push({ book, chapter: Number(chapter), verses });
    }
    return next;
}

/** Removes a whole chapter from the selection. */
export function removeChapter(selection, book, chapter) {
    return selection.filter((item) => !same(item, book, chapter));
}

export function countVerses(selection) {
    return selection.reduce((n, item) => n + Object.keys(item.verses).length, 0);
}

/** Number of verses selected per book: { Genesis: 4, Ezra: 5 }. */
export function countsByBook(selection) {
    const counts = {};
    for (const item of selection) counts[item.book] = (counts[item.book] ?? 0) + Object.keys(item.verses).length;
    return counts;
}

/** "Ezra 4:2-6" for one selected chapter. */
export function chapterLabel(item) {
    return `${item.book} ${item.chapter}:${formatVerseRanges(Object.keys(item.verses))}`;
}

/**
 * The selection as output-format scriptures ({ book, chapter, title, verses }),
 * books in the order they were first picked and each book's chapters in
 * order, so the reference reads "Genesis 1:1-4; 2:1-3; Ezra 4:2-6". `title`
 * goes on the first entry.
 */
export function selectionToScriptures(selection, title = '') {
    const books = [];
    for (const item of selection) if (!books.includes(item.book)) books.push(item.book);
    const scriptures = books.flatMap((book) => selection
        .filter((item) => item.book === book)
        .sort((a, b) => a.chapter - b.chapter)
        .map((item) => {
            const verses = {};
            for (const n of Object.keys(item.verses).sort((a, b) => Number(a) - Number(b))) verses[n] = item.verses[n];
            return { book, chapter: String(item.chapter), title: '', verses };
        }));
    if (scriptures.length) scriptures[0].title = title;
    return scriptures;
}

/** A selection from output-format scriptures (one object or an array), e.g. to reopen the picker. */
export function selectionFromScriptures(scriptures) {
    const list = Array.isArray(scriptures) ? scriptures : scriptures ? [scriptures] : [];
    let selection = [];
    for (const s of list) {
        if (!s?.book || s.chapter == null || !Number.isInteger(Number(s.chapter))) continue;
        selection = updateChapter(selection, s.book, s.chapter, s.verses ?? {});
    }
    return selection;
}
