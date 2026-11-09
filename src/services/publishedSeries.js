// Reads and edits series that are already in the app's `bible_series`
// collection, and keeps each series' `series_content_snippet`, `start_date`
// and `end_date` in step with its content. (A Cloud Function used to build the
// snippet as entries were added one by one; every write path now rebuilds it
// here instead, in the series' own order.)
//
// Content entries are edited in place: user `completions` reference entries
// by document ID, so an entry is only deleted when it no longer exists in the
// draft. A field is only written when the draft really changed it: it must
// differ from what is stored and from the baseline (the stored series opened
// and compiled again, see seriesBaseline.js).

import { createHash } from 'node:crypto';
import { DateTime } from 'luxon';
import admin from 'firebase-admin';
import { entryLines } from '../../ui/src/series/entryDiff.js';

export const SERIES_ZONE = 'America/Toronto';
const SERIES_FIELDS = ['title', 'sub_title', 'image_gs_location', 'is_active', 'is_visible'];
const BOOLEAN_FIELDS = new Set(['is_active', 'is_visible']);
const CONTENT_FIELDS = ['date', 'content_type', 'title', 'body'];
// Firestore allows 500 writes per batch.
const BATCH_SIZE = 450;

/** 'yyyy-MM-dd' -> Timestamp at midnight in the series time zone. */
export function contentTimestamp(isoDate) {
    const date = DateTime.fromFormat(isoDate ?? '', 'yyyy-MM-dd', { zone: SERIES_ZONE });
    if (!date.isValid) throw new Error(`Invalid date "${isoDate}"`);
    return admin.firestore.Timestamp.fromMillis(date.toMillis());
}

/** Timestamp -> 'yyyy-MM-dd' in the series time zone ('' if not a timestamp). */
export function isoDateOf(timestamp) {
    const millis = timestamp?.toMillis?.();
    return typeof millis === 'number' ? DateTime.fromMillis(millis, { zone: SERIES_ZONE }).toFormat('yyyy-MM-dd') : '';
}

/**
 * Builds the bible_series snippet from content entries given in series order
 * (day by day, then engagement order). Days are sorted by date; entries keep
 * their order within a day.
 *
 * @param {Array<{ id: string, content_type: string, date: import('firebase-admin').firestore.Timestamp }>} entries
 */
export function buildSnippet(entries) {
    const days = new Map();
    for (const { id, content_type, date } of entries) {
        if (!date) continue;
        const key = date.toMillis();
        if (!days.has(key)) days.set(key, { content_types: [], date });
        days.get(key).content_types.push({ content_type, content_id: id });
    }
    const snippet = [...days.entries()].sort(([a], [b]) => a - b).map(([, day]) => day);
    return {
        series_content_snippet: snippet,
        start_date: snippet[0]?.date ?? null,
        end_date: snippet.at(-1)?.date ?? null,
    };
}

function snippetKey(snippet) {
    return JSON.stringify((snippet ?? []).map((day) => [
        day.date?.toMillis?.() ?? null,
        (day.content_types ?? []).map((c) => [c.content_type, c.content_id]),
    ]));
}

/** JSON with sorted object keys, so equal values compare equal whatever order Firestore returns map keys in. */
function canonical(value) {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
    }
    return JSON.stringify(value ?? null);
}

function seriesValue(field, value) {
    return BOOLEAN_FIELDS.has(field) ? !!value : (value ?? '');
}

/** The app document fields the series builder writes, as plain JSON. */
function seriesJson(series) {
    return Object.fromEntries(SERIES_FIELDS.map((f) => [f, seriesValue(f, series?.[f])]));
}

/**
 * Pairs the draft's entries with the published ones. Entries on the same
 * date with the same type are the same entry; whatever is left is paired by
 * type in date order, so moving an entry to another day keeps its document
 * (and the completions recorded against it).
 *
 * @returns {Map<number, object>} draft entry index -> published entry
 */
function matchEntries(published, entries) {
    const matches = new Map();
    const used = new Set();

    const byKey = new Map();
    for (const doc of published) {
        const key = `${doc.isoDate}|${doc.content_type}`;
        if (!byKey.has(key)) byKey.set(key, []);
        byKey.get(key).push(doc);
    }
    entries.forEach((entry, index) => {
        const doc = byKey.get(`${entry.date}|${entry.content_type}`)?.shift();
        if (doc) {
            matches.set(index, doc);
            used.add(doc.id);
        }
    });

    const leftoverByType = new Map();
    for (const doc of published) {
        if (used.has(doc.id)) continue;
        if (!leftoverByType.has(doc.content_type)) leftoverByType.set(doc.content_type, []);
        leftoverByType.get(doc.content_type).push(doc);
    }
    entries.forEach((entry, index) => {
        if (matches.has(index)) return;
        const doc = leftoverByType.get(entry.content_type)?.shift();
        if (doc) matches.set(index, doc);
    });
    return matches;
}

/** Stored series as builder JSON ({ bible_series, series_content } with ISO dates). */
function toBuilderJson({ series, content }) {
    return {
        bible_series: seriesJson(series),
        series_content: content.map((doc) => {
            const entry = { ...doc, date: isoDateOf(doc.date) };
            delete entry.id;
            return entry;
        }),
    };
}

/**
 * Pairs each stored entry with its counterpart in the recompiled series (same
 * date and type, in order). Entries the builder can't compile have none.
 *
 * @returns {{ series: object, content: Map<string, object> }} baseline series fields and content by document ID
 */
export function baselineFor(current, recompiled) {
    const byKey = new Map();
    for (const entry of recompiled.series_content) {
        const key = `${entry.date}|${entry.content_type}`;
        if (!byKey.has(key)) byKey.set(key, []);
        byKey.get(key).push(entry);
    }
    const content = new Map();
    for (const doc of current.content) {
        const entry = byKey.get(`${isoDateOf(doc.date)}|${doc.content_type}`)?.shift();
        if (entry) content.set(doc.id, entry);
    }
    return { series: seriesJson(recompiled.bible_series), content };
}

/**
 * The body to store for an entry the draft changed: blocks the draft didn't
 * change (same as the baseline) keep their stored form, so editing one
 * question doesn't also rewrite the entry's scripture. Falls back to the
 * draft's body when the blocks don't line up.
 */
function mergeBody(stored, opened, draft) {
    if (!Array.isArray(stored) || !Array.isArray(opened) || !Array.isArray(draft)) return draft;
    if (stored.length !== opened.length || opened.length !== draft.length) return draft;
    return draft.map((block, i) => (canonical(block) === canonical(opened[i]) ? stored[i] : block));
}

/**
 * Works out the writes that make a published series match a compiled draft.
 *
 * @param {{ series: object, content: Array<{ id: string } & object> }} current  from PublishedSeriesService.read
 * @param {{ bible_series: object, series_content: Array<object> }} json  compiled draft (ISO dates)
 * @param {{ newId: () => string, completions?: Map<string, number>, baseline?: ReturnType<typeof baselineFor> }} options
 * @returns {{ writes: object, summary: object }} `writes` is passed to PublishedSeriesService.apply;
 *   `summary` is plain JSON describing the changes, with a `planHash` identifying them.
 */
export function planSeriesUpdate(current, json, { newId, completions = new Map(), baseline = null }) {
    const published = current.content.map((doc) => ({ ...doc, isoDate: isoDateOf(doc.date) }));
    const entries = json.series_content;
    const matches = matchEntries(published, entries);
    const matchedIds = new Set([...matches.values()].map((doc) => doc.id));

    const updates = [];
    const adds = [];
    const ordered = [];
    const summary = { series: [], updated: [], added: [], removed: [], unchanged: 0 };

    entries.forEach((entry, index) => {
        const doc = matches.get(index);
        if (!doc) {
            const id = newId();
            const data = { ...entry, date: contentTimestamp(entry.date) };
            adds.push({ id, data });
            ordered.push({ id, content_type: data.content_type, date: data.date });
            summary.added.push({ index, date: entry.date, content_type: entry.content_type, title: entry.title ?? '', lines: entryLines(entry) });
            return;
        }
        const patch = {};
        const opened = baseline?.content.get(doc.id);
        for (const field of CONTENT_FIELDS) {
            if (field === 'date') {
                if (entry.date !== doc.isoDate) patch.date = contentTimestamp(entry.date);
            } else if (canonical(entry[field]) !== canonical(doc[field])
                && (!opened || canonical(entry[field]) !== canonical(opened[field]))) {
                const next = field === 'body' && opened ? mergeBody(doc.body, opened.body, entry.body) : entry[field];
                if (canonical(next) !== canonical(doc[field])) patch[field] = next;
            }
        }
        const fields = Object.keys(patch);
        if (fields.length) {
            updates.push({ id: doc.id, patch });
            summary.updated.push({
                id: doc.id,
                index,
                date: entry.date,
                content_type: entry.content_type,
                title: entry.title ?? '',
                fields,
                ...(patch.date ? { fromDate: doc.isoDate } : {}),
                ...(patch.content_type ? { fromType: doc.content_type } : {}),
                // Before/after text for the review's diff, when the text changed.
                ...('title' in patch || 'body' in patch ? { before: entryLines(doc), after: entryLines({ ...doc, ...patch }) } : {}),
            });
        } else {
            summary.unchanged++;
        }
        ordered.push({ id: doc.id, content_type: entry.content_type, date: patch.date ?? doc.date });
    });

    const deletes = [];
    for (const doc of published) {
        if (matchedIds.has(doc.id)) continue;
        deletes.push(doc.id);
        summary.removed.push({
            id: doc.id,
            date: doc.isoDate,
            content_type: doc.content_type ?? '',
            title: doc.title ?? '',
            completions: completions.get(doc.id) ?? 0,
            lines: entryLines(doc),
        });
    }

    const seriesPatch = {};
    const target = seriesJson(json.bible_series);
    for (const field of SERIES_FIELDS) {
        const from = seriesValue(field, current.series[field]);
        if (from !== target[field] && (!baseline || baseline.series[field] !== target[field])) {
            seriesPatch[field] = target[field];
            summary.series.push({ field, from, to: target[field] });
        }
    }

    const snippet = buildSnippet(ordered);
    // New entries get fresh IDs on every plan, so only compare when nothing is added.
    summary.snippetChanged = adds.length > 0 || snippetKey(snippet.series_content_snippet) !== snippetKey(current.series.series_content_snippet)
        || current.series.start_date?.toMillis?.() !== snippet.start_date?.toMillis()
        || current.series.end_date?.toMillis?.() !== snippet.end_date?.toMillis();
    summary.writeCount = updates.length + adds.length + deletes.length
        + (summary.series.length || summary.snippetChanged ? 1 : 0);
    summary.planHash = createHash('sha1').update(canonical(summary)).digest('hex').slice(0, 16);

    return {
        writes: {
            updates,
            adds,
            deletes,
            series: summary.series.length || summary.snippetChanged ? { ...seriesPatch, ...snippet } : null,
        },
        summary,
    };
}

export class PublishedSeriesService {
    /**
     * @param {import('firebase-admin').firestore.Firestore} firestore
     * @param {{ recompile?: ReturnType<typeof import('./seriesBaseline.js').createRecompiler> }} [options]
     *   Without `recompile`, every difference from the stored series counts as a change.
     */
    constructor(firestore, { recompile = null } = {}) {
        this.firestore = firestore;
        this.recompile = recompile;
    }

    #series(id) {
        return this.firestore.collection('bible_series').doc(id);
    }

    newContentId(seriesId) {
        return this.#series(seriesId).collection('series_content').doc().id;
    }

    /** Series in the app, newest first, without their snippets. */
    async list() {
        const snapshot = await this.firestore
            .collection('bible_series')
            .select(...SERIES_FIELDS, 'start_date', 'end_date')
            .get();
        return snapshot.docs
            .map((doc) => {
                const data = doc.data();
                return {
                    id: doc.id,
                    ...seriesJson(data),
                    startDate: isoDateOf(data.start_date),
                    endDate: isoDateOf(data.end_date),
                };
            })
            .sort((a, b) => b.startDate.localeCompare(a.startDate) || a.title.localeCompare(b.title));
    }

    /**
     * The series document and its content entries in series order (by date,
     * then by position in the snippet). `series` is null when it doesn't exist.
     */
    async read(seriesId) {
        const ref = this.#series(seriesId);
        const [seriesDoc, contentSnapshot] = await Promise.all([ref.get(), ref.collection('series_content').get()]);
        if (!seriesDoc.exists) return { series: null, content: [] };
        const series = seriesDoc.data();
        const position = new Map();
        for (const day of series.series_content_snippet ?? []) {
            for (const item of day.content_types ?? []) position.set(item.content_id, position.size);
        }
        const content = contentSnapshot.docs
            .map((doc) => ({ id: doc.id, ...doc.data() }))
            .sort((a, b) => ((a.date?.toMillis?.() ?? 0) - (b.date?.toMillis?.() ?? 0))
                || ((position.get(a.id) ?? Infinity) - (position.get(b.id) ?? Infinity))
                || a.id.localeCompare(b.id));
        return { series, content };
    }

    /** A published series as builder JSON ({ bible_series, series_content } with ISO dates), or null. */
    async export(seriesId) {
        const current = await this.read(seriesId);
        return current.series ? toBuilderJson(current) : null;
    }

    /** content_id -> number of user completions recorded against it. */
    async completionCounts(seriesId) {
        const snapshot = await this.firestore
            .collection('completions')
            .where('series_id', '==', seriesId)
            .select('content_id')
            .get();
        const counts = new Map();
        snapshot.forEach((doc) => {
            const id = doc.data().content_id;
            counts.set(id, (counts.get(id) ?? 0) + 1);
        });
        return counts;
    }

    /** Plans the update of `seriesId` to match `json`; throws if the series doesn't exist. */
    async plan(seriesId, json) {
        const [current, completions] = await Promise.all([this.read(seriesId), this.completionCounts(seriesId)]);
        if (!current.series) {
            const error = new Error(`Series ${seriesId} was not found`);
            error.code = 'not-found';
            throw error;
        }
        const baseline = this.recompile ? baselineFor(current, this.recompile(toBuilderJson(current))) : null;
        return planSeriesUpdate(current, json, { newId: () => this.newContentId(seriesId), completions, baseline });
    }

    /**
     * Applies a plan's writes. The series document (with the rebuilt snippet)
     * is written in the last batch, so a series whose content fails part-way
     * keeps its old snippet; planning again picks up from the actual state.
     */
    async apply(seriesId, writes) {
        const ref = this.#series(seriesId);
        const content = ref.collection('series_content');
        const ops = [
            ...writes.deletes.map((id) => (batch) => batch.delete(content.doc(id))),
            ...writes.updates.map(({ id, patch }) => (batch) => batch.update(content.doc(id), patch)),
            ...writes.adds.map(({ id, data }) => (batch) => batch.set(content.doc(id), data)),
            ...(writes.series ? [(batch) => batch.update(ref, writes.series)] : []),
        ];
        for (let i = 0; i < ops.length; i += BATCH_SIZE) {
            const batch = this.firestore.batch();
            for (const op of ops.slice(i, i + BATCH_SIZE)) op(batch);
            await batch.commit();
        }
        return ops.length;
    }
}
