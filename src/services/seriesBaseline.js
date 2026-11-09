// What a published series looks like after opening it in the series builder
// and compiling it again without changes.
//
// Opening a series keeps scripture as references and rebuilds entries from
// templates, so the result can differ from what is stored (older series were
// written by hand: blank scripture titles, another NIV edition's verse text,
// trailing spaces). Updates compare the draft with this baseline so those
// differences are not mistaken for edits.

import { compileDraft, collectRefs, createLookup } from '../../ui/src/series/compile.js';
import { importSeriesJson } from '../../ui/src/series/importSeries.js';
import { splitReference } from '../../ui/src/series/scriptureRefs.js';

/**
 * @param {import('./bibleService.js').BibleService|null} bibleService
 * @returns {((json: { bible_series: object, series_content: object[] }) => { bible_series: object, series_content: object[] }) | null}
 *   Compiles a series as the builder would after opening it; null without Bible data.
 */
export function createRecompiler(bibleService) {
    if (!bibleService) return null;
    return (json) => {
        const { draft } = importSeriesJson(json);
        const singles = new Map();
        for (const ref of collectRefs(draft)) {
            for (const part of splitReference(ref)) {
                try {
                    singles.set(part, { ok: true, passage: bibleService.getPassage(part) });
                } catch (error) {
                    singles.set(part, { ok: false, error: error.message });
                }
            }
        }
        return compileDraft(draft, createLookup(singles)).json;
    };
}
