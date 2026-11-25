// A resolved passage (from fetchBiblePassage) as the single API.Bible passage
// ID and reference a featured verse stores.

/**
 * @param {{ book: string, bookId: string, verses: Array<{ chapter: number, verse: number }> }} passage
 * @returns {{ passageId: string, reference: string }}
 * @throws {Error} if the verses aren't one continuous passage
 */
export function featuredPassage(passage) {
    const verses = [...(passage?.verses ?? [])].sort((a, b) => a.chapter - b.chapter || a.verse - b.verse);
    if (!passage?.bookId || !verses.length) throw new Error('No verses found for this reference');
    for (let i = 1; i < verses.length; i++) {
        const [prev, cur] = [verses[i - 1], verses[i]];
        const next = (cur.chapter === prev.chapter && cur.verse === prev.verse + 1) || (cur.chapter === prev.chapter + 1 && cur.verse === 1);
        if (!next) throw new Error('Pick one continuous passage (no gaps), e.g. Philippians 4:6-7');
    }
    const first = verses[0];
    const last = verses.at(-1);
    const id = (v) => `${passage.bookId}.${v.chapter}.${v.verse}`;
    const passageId = verses.length === 1 ? id(first) : `${id(first)}-${id(last)}`;
    let reference = `${passage.book} ${first.chapter}:${first.verse}`;
    if (last.chapter !== first.chapter) reference += `-${last.chapter}:${last.verse}`;
    else if (last.verse !== first.verse) reference += `-${last.verse}`;
    return { passageId, reference };
}
