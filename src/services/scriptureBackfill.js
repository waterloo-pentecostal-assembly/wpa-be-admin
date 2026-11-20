// Rewrites scripture already stored in Firebase in an API.Bible translation
// (see scripts/backfill-scripture.js for the command line).
//
// Each `body_type: 'scripture'` block in bible_series/{id}/series_content
// keeps its shape, book names, chapters, verse numbers and titles; the verse
// text, `attribution` and `bible_version` are replaced with the translation's,
// and the block gets the root `passage_ids` an updated app fetches through the
// Bible proxy (see ui/src/series/scriptureRefs.js; IDs an earlier run put on
// each chapter entry are moved there). Only `body` is
// written on content entries, so document IDs (and the user completions that
// reference them) and the series snippet are untouched.
//
// Once every scripture block of a series is in the translation, the series
// document's admin-only `scripture_bible_id` is set to it; later runs skip
// that series (without any API.Bible calls) unless forced.
//
// Verses the translation doesn't have (e.g. Matthew 17:21 in many modern
// translations) are dropped from the entry and reported. A block with a book
// or chapter the translation lacks is left as it is and reported.

import { scriptureBodyBlock, passageIdsFor } from '../../ui/src/series/scriptureRefs.js';

// Firestore allows 500 writes per batch.
const BATCH_SIZE = 450;

/** JSON with sorted object keys, so equal values compare equal whatever order Firestore returns map keys in. */
function canonical(value) {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
    }
    return JSON.stringify(value ?? null);
}

const chapterKey = (book, chapter) => `${String(book ?? '').trim().toLowerCase()}|${String(chapter ?? '').trim()}`;

function isScriptureBlock(block) {
    return block?.body_type === 'scripture' && Array.isArray(block.scriptures);
}

/**
 * Whether any scripture block in these entries is in an older layout: no
 * root `passage_ids`, or fields an earlier version put on each entry
 * (`passage_ids`, `book_id`). Such series are redone even when they are
 * recorded as being in the translation.
 */
export function needsLayoutUpdate(entries) {
    return entries.some((entry) => Array.isArray(entry.body) && entry.body.some((block) => isScriptureBlock(block)
        && block.scriptures.length
        && (!Array.isArray(block.passage_ids) || block.scriptures.some((s) => 'passage_ids' in s || 'book_id' in s))));
}

/** Every (book, chapter) the stored scripture in these entries uses, for estimating API calls. */
export function chaptersUsed(entries) {
    const keys = new Set();
    for (const entry of entries) {
        for (const block of entry.body ?? []) {
            if (!isScriptureBlock(block)) continue;
            for (const s of block.scriptures) if (s?.book && s?.chapter) keys.add(chapterKey(s.book, s.chapter));
        }
    }
    return keys;
}

/**
 * The block rewritten in the translation.
 *
 * @param {object} block - stored scripture block
 * @param {import('./apiBibleService.js').ApiBibleService} bible
 * @param {string} bibleId - concrete API.Bible ID
 * @returns {Promise<{ block: object, warnings: string[], error: string|null }>}
 *   `error` set (and the block returned unchanged) when it can't be rewritten.
 */
export async function rewriteScriptureBlock(block, bible, bibleId) {
    const warnings = [];
    const scriptures = [];
    let translation = null;
    for (const s of block.scriptures) {
        const label = `${s?.book ?? '?'} ${s?.chapter ?? '?'}`;
        const text = s?.book && s?.chapter ? await bible.getChapterText(bibleId, s.book, s.chapter) : null;
        if (!text) return { block, warnings, error: `${label} is not in this translation` };
        translation ??= text.bible;

        const stored = Object.keys(s.verses ?? {}).map(Number).filter(Number.isInteger);
        // An entry without verses stands for the whole chapter.
        const wanted = (stored.length ? stored : Object.keys(text.verses).map(Number)).sort((a, b) => a - b);
        const verses = {};
        const missing = [];
        for (const n of wanted) {
            if (Object.hasOwn(text.verses, String(n))) verses[String(n)] = text.verses[String(n)];
            else missing.push(n);
        }
        if (missing.length) warnings.push(`${label}:${missing.join(', ')} not in ${translation.abbreviation || bibleId}; removed`);
        if (!Object.keys(verses).length) return { block, warnings, error: `${label} has none of its verses in this translation` };

        const numbers = Object.keys(verses).map(Number);
        // `book_id` was stored by an earlier version (the passage IDs carry the
        // book), and so were per-entry `passage_ids`: scriptureBodyBlock puts
        // the new ones at the block's root.
        const { book_id: _bookId, passage_ids: _oldIds, ...entry } = s;
        scriptures.push({
            ...entry,
            verses,
            passage_ids: passageIdsFor(text.bookId, text.chapter, numbers),
        });
    }
    if (!translation) return { block, warnings, error: 'Block has no scripture' };
    // `bible` was stored on blocks by an earlier version of this tool.
    const { bible: _old, ...rest } = block;
    return { block: { ...rest, ...scriptureBodyBlock(scriptures, translation) }, warnings, error: null };
}

/**
 * Plans and applies the backfill for one environment.
 */
export class ScriptureBackfill {
    /**
     * @param {import('firebase-admin').firestore.Firestore} firestore
     * @param {import('./apiBibleService.js').ApiBibleService} bible
     * @param {{ bibleId?: string, force?: boolean }} [options]
     *   `force` also rewrites series already recorded as in this translation.
     */
    constructor(firestore, bible, { bibleId = 'default', force = false } = {}) {
        this.firestore = firestore;
        this.bible = bible;
        this.bibleId = bible.resolveBibleId(bibleId);
        this.force = force;
    }

    /** Series to backfill: the given IDs, or every series in the environment. */
    async listSeries(seriesIds = null) {
        const collection = this.firestore.collection('bible_series');
        if (seriesIds?.length) {
            const docs = await Promise.all(seriesIds.map((id) => collection.doc(id).get()));
            return docs.map((doc, i) => (doc.exists ? summary(doc) : { id: seriesIds[i], title: null, missing: true }));
        }
        const snapshot = await collection.get();
        return snapshot.docs.map(summary);
    }

    async readContent(seriesId) {
        const snapshot = await this.firestore.collection('bible_series').doc(seriesId).collection('series_content').get();
        return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    }

    /**
     * Whether a series is done (and so is skipped unless forced): recorded as
     * being in this translation and, when its content is given, with every
     * scripture block in the current layout (see needsLayoutUpdate).
     */
    isCurrent(series, content = null) {
        if (this.force || series?.scripture_bible_id !== this.bibleId) return false;
        return !(content && needsLayoutUpdate(content));
    }

    /**
     * Works out the new body of every entry that changes in one series.
     *
     * @param {{ id: string, scripture_bible_id?: string|null }} series - from listSeries
     * @returns {Promise<{ seriesId, previousBibleId, skipped: boolean, entries: number, blocks: number,
     *   updates: Array<{ id, path, before, after }>, markSeries: boolean, warnings: string[], errors: string[] }>}
     *   `markSeries`: every block is in the translation, so the series can be recorded as such.
     */
    async planSeries(series, content = null) {
        const seriesId = series.id;
        const result = {
            seriesId,
            previousBibleId: series.scripture_bible_id ?? null,
            skipped: false,
            entries: 0,
            blocks: 0,
            updates: [],
            markSeries: false,
            warnings: [],
            errors: [],
        };
        const entries = content ?? await this.readContent(seriesId);
        if (this.isCurrent(series, entries)) {
            result.skipped = true;
            return result;
        }
        result.entries = entries.length;
        for (const entry of entries) {
            if (!Array.isArray(entry.body)) continue;
            let changed = false;
            const body = [];
            for (const [index, block] of entry.body.entries()) {
                if (!isScriptureBlock(block)) {
                    body.push(block);
                    continue;
                }
                result.blocks++;
                const where = `${seriesId}/${entry.id} block ${index}`;
                const rewritten = await rewriteScriptureBlock(block, this.bible, this.bibleId);
                for (const w of rewritten.warnings) result.warnings.push(`${where}: ${w}`);
                if (rewritten.error) {
                    result.errors.push(`${where}: ${rewritten.error}; left unchanged`);
                    body.push(block);
                    continue;
                }
                if (canonical(rewritten.block) !== canonical(block)) changed = true;
                body.push(rewritten.block);
            }
            if (changed) {
                result.updates.push({
                    id: entry.id,
                    path: `bible_series/${seriesId}/series_content/${entry.id}`,
                    before: entry.body,
                    after: body,
                });
            }
        }
        result.markSeries = !result.errors.length && result.previousBibleId !== this.bibleId;
        return result;
    }

    /**
     * Writes planned bodies (only the `body` field) and records the
     * translation on fully converted series, in batches. Each series document
     * is written after its content.
     *
     * @returns {Promise<{ entries: number, series: number }>}
     */
    async apply(plans) {
        const ops = [];
        for (const plan of plans) {
            for (const { path, after } of plan.updates) ops.push((batch) => batch.update(contentDoc(this.firestore, path), { body: after }));
            if (plan.markSeries) {
                ops.push((batch) => batch.update(this.firestore.collection('bible_series').doc(plan.seriesId), { scripture_bible_id: this.bibleId }));
            }
        }
        await commitInBatches(this.firestore, ops);
        return {
            entries: plans.reduce((n, p) => n + p.updates.length, 0),
            series: plans.filter((p) => p.markSeries).length,
        };
    }
}

function summary(doc) {
    const data = doc.data();
    return { id: doc.id, title: data.title ?? '', scripture_bible_id: data.scripture_bible_id ?? null };
}

async function commitInBatches(firestore, ops) {
    for (let i = 0; i < ops.length; i += BATCH_SIZE) {
        const batch = firestore.batch();
        for (const op of ops.slice(i, i + BATCH_SIZE)) op(batch);
        await batch.commit();
    }
}

function contentDoc(firestore, path) {
    const [collection, seriesId, sub, entryId, ...rest] = String(path).split('/');
    if (collection !== 'bible_series' || sub !== 'series_content' || !seriesId || !entryId || rest.length) {
        throw new Error(`Unexpected document path: ${path}`);
    }
    return firestore.collection('bible_series').doc(seriesId).collection('series_content').doc(entryId);
}

/**
 * Puts a backup back: entry bodies (`[{ path, body }]`) and each series'
 * previous `scripture_bible_id` (`[{ id, scripture_bible_id }]`, null when
 * it had none).
 */
export async function restoreBodies(firestore, docs, series = []) {
    await commitInBatches(firestore, [
        ...docs.map(({ path, body }) => (batch) => batch.update(contentDoc(firestore, path), { body })),
        ...series.map(({ id, scripture_bible_id }) => (batch) => batch.update(
            firestore.collection('bible_series').doc(id),
            { scripture_bible_id: scripture_bible_id ?? null },
        )),
    ]);
    return docs.length;
}
