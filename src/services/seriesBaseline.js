// What a published series looks like after opening it in the series builder
// and compiling it again without changes.
//
// Opening a series keeps scripture as references and rebuilds entries from
// templates, so the result can differ from what is stored (older series were
// written by hand: blank scripture titles, another translation's or NIV
// edition's verse text, trailing spaces). Updates compare the draft with this
// baseline so those differences are not mistaken for edits.

import { compileDraft, collectRefs, createLookup } from '../../ui/src/series/compile.js';
import { importSeriesJson } from '../../ui/src/series/importSeries.js';
import { splitReference } from '../../ui/src/series/scriptureRefs.js';

/**
 * @param {{ getPassages: (bibleId: string, refs: string[]) => Promise<{ results: Record<string, object> }>, withAuth?: Function }|null} bible
 *   ApiBibleService (or anything with the same getPassages)
 * @returns {((json: { bible_series: object, series_content: object[] }, options?: { auth?: object }) => Promise<{ bible_series: object, series_content: object[] }>) | null}
 *   Compiles a series as the builder would after opening it, in the
 *   translation the opened draft uses; null without a Bible API. `auth` is
 *   the admin whose ID token the Bible proxy is called with.
 */
export function createRecompiler(bible) {
    if (!bible) return null;
    return async (json, { auth = null } = {}) => {
        const { draft } = importSeriesJson(json);
        const parts = [...new Set(collectRefs(draft).flatMap(splitReference))];
        const scoped = auth && bible.withAuth ? bible.withAuth(auth) : bible;
        const { results } = parts.length
            ? await scoped.getPassages(draft.meta.bible_id || 'default', parts)
            : { results: {} };
        const singles = new Map(parts.map((part) => [part, results[part] ?? { ok: false, error: `Could not resolve "${part}"` }]));
        return compileDraft(draft, createLookup(singles)).json;
    };
}
