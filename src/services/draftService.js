import admin from 'firebase-admin';

// Series builder drafts are stored as a JSON string so the draft's shape is
// never constrained by Firestore (nested arrays, undefined values) and a
// whole draft is read/written in one document.
//
// Document fields are snake_case like the rest of the database:
//   { title, day_count, start_date, end_date, data, rev, created_at, updated_at,
//     deleted, deleted_at?, series_id, publishes: [record], source?: { env, draft_id } }
// Documents written before that used camelCase; they are read through
// `normalize` and rewritten in the new shape whenever they are written.
export const DRAFTS_COLLECTION = 'admin_series_drafts';

// Firestore's document limit is 1 MiB; leave room for the summary fields.
const MAX_DRAFT_BYTES = 900 * 1024;
const LIST_LIMIT = 200;

const LEGACY_DOC_KEYS = { dayCount: 'day_count', startDate: 'start_date', endDate: 'end_date', createdAt: 'created_at', updatedAt: 'updated_at', deletedAt: 'deleted_at' };
const LEGACY_RECORD_KEYS = { failedCount: 'failed_count', startedAt: 'started_at', updatedAt: 'updated_at', finishedAt: 'finished_at', seriesId: 'series_id' };
const LEGACY_SOURCE_KEYS = { draftId: 'draft_id' };
const SUMMARY_FIELDS = ['title', 'day_count', 'start_date', 'end_date', 'rev', 'updated_at', 'deleted', 'series_id', 'publishes'];

export class DraftServiceError extends Error {
    constructor(message, status, details = {}) {
        super(message);
        this.name = 'DraftServiceError';
        this.status = status;
        this.details = details;
    }
}

/** Renames legacy camelCase keys; a snake_case key already present wins. */
function renameKeys(object, legacy) {
    const out = {};
    for (const [key, value] of Object.entries(object)) if (!(key in legacy)) out[key] = value;
    for (const [key, value] of Object.entries(object)) if (key in legacy && !(legacy[key] in out)) out[legacy[key]] = value;
    return out;
}

function hasLegacyKeys(data) {
    const has = (object, legacy) => !!object && Object.keys(object).some((k) => k in legacy);
    return has(data, LEGACY_DOC_KEYS) || has(data.source, LEGACY_SOURCE_KEYS) || (data.publishes ?? []).some((p) => has(p, LEGACY_RECORD_KEYS));
}

/** A stored draft document with snake_case keys, whichever shape it was written in. */
function normalize(data) {
    const doc = renameKeys(data, LEGACY_DOC_KEYS);
    if (doc.source) doc.source = renameKeys(doc.source, LEGACY_SOURCE_KEYS);
    doc.publishes = (doc.publishes ?? []).map((p) => renameKeys(p, LEGACY_RECORD_KEYS));
    return doc;
}

function summarize(draft) {
    const days = Array.isArray(draft?.days) ? draft.days : [];
    return {
        title: draft?.meta?.title ?? '',
        day_count: days.length,
        start_date: days[0]?.date ?? '',
        end_date: days.at(-1)?.date ?? '',
    };
}

function serialize(draft) {
    if (!draft || typeof draft !== 'object' || !Array.isArray(draft.days)) {
        throw new DraftServiceError('A draft object with a days array is required', 400);
    }
    const data = JSON.stringify(draft);
    if (Buffer.byteLength(data, 'utf8') > MAX_DRAFT_BYTES) {
        throw new DraftServiceError('Draft is too large to save', 413);
    }
    return data;
}

function toMillis(value) {
    return value?.toMillis?.() ?? (typeof value === 'number' ? value : null);
}

/**
 * The app series a draft published or was opened from (`series_id`, on a
 * normalized document). Drafts from before that field have it only on their
 * publish records, with the environment (drafts were then shared between
 * environments).
 */
function seriesIdOf(doc, env) {
    if (doc.series_id !== undefined) return doc.series_id;
    const origin = doc.publishes.filter((p) => p.series_id && p.kind !== 'update' && (!env || !p.env || p.env === env)).at(-1);
    return origin?.series_id ?? null;
}

function serializePublish(p) {
    return { ...p, started_at: toMillis(p.started_at), updated_at: toMillis(p.updated_at), finished_at: toMillis(p.finished_at) };
}

/**
 * Stores series builder drafts in Firestore with optimistic concurrency:
 * every save must name the revision it was based on, so two tabs editing
 * the same draft cannot silently overwrite each other.
 */
export class DraftService {
    /**
     * @param {object} [options]
     * @param {string} [options.env] environment these drafts belong to (for messages and copies)
     */
    constructor(firestore, { collection = DRAFTS_COLLECTION, now = () => admin.firestore.Timestamp.now(), env = null } = {}) {
        this.firestore = firestore;
        this.collection = firestore.collection(collection);
        this.now = now;
        this.env = env;
    }

    #notFound() {
        return new DraftServiceError(`Draft not found${this.env ? ` in ${this.env}` : ''}`, 404);
    }

    /** Normalized documents with the given fields (and their legacy names). */
    async #scan(fields) {
        const legacy = Object.entries(LEGACY_DOC_KEYS).filter(([, key]) => fields.includes(key)).map(([name]) => name);
        const snapshot = await this.collection.select(...fields, ...legacy).get();
        return snapshot.docs.map((doc) => ({ id: doc.id, ...normalize(doc.data()) }));
    }

    async list() {
        // Sorted here, not by the query: documents not yet migrated have no `updated_at`.
        return (await this.#scan(SUMMARY_FIELDS))
            .filter((d) => !d.deleted)
            .sort((a, b) => (toMillis(b.updated_at) ?? 0) - (toMillis(a.updated_at) ?? 0))
            .slice(0, LIST_LIMIT)
            .map((d) => ({
                id: d.id,
                title: d.title,
                dayCount: d.day_count,
                startDate: d.start_date,
                endDate: d.end_date,
                seriesId: seriesIdOf(d, this.env),
                rev: d.rev,
                updatedAt: toMillis(d.updated_at),
            }));
    }

    /** ID of a (not deleted) draft linked to the series, or null. */
    async findLinked(seriesId) {
        const doc = (await this.#scan(['series_id', 'publishes', 'deleted'])).find((d) => !d.deleted && seriesIdOf(d, this.env) === seriesId);
        return doc?.id ?? null;
    }

    async get(id) {
        const snapshot = await this.collection.doc(id).get();
        if (!snapshot.exists || snapshot.data().deleted) throw this.#notFound();
        const doc = normalize(snapshot.data());
        return { id: snapshot.id, rev: doc.rev, updatedAt: toMillis(doc.updated_at), draft: JSON.parse(doc.data) };
    }

    async create(draft, extra = {}) {
        const data = serialize(draft);
        const now = this.now();
        const ref = this.collection.doc();
        await ref.set({ ...summarize(draft), data, rev: 1, created_at: now, updated_at: now, deleted: false, series_id: null, publishes: [], ...extra });
        return { id: ref.id, rev: 1, updatedAt: toMillis(now) };
    }

    /**
     * Stores a copy of a draft from another environment. Copies remember their
     * source, so copying the same draft again replaces the earlier copy (only
     * with `replace`; otherwise a 409 names it). The linked series and publish
     * records aren't copied: they belong to the source environment.
     *
     * @param {{ env: string, draft_id: string }} source
     */
    async copyIn(draft, source, { replace = false } = {}) {
        const existing = (await this.#scan(['source', 'deleted', 'title']))
            .find((d) => !d.deleted && d.source?.env === source.env && d.source?.draft_id === source.draft_id);
        if (existing && !replace) {
            throw new DraftServiceError(`This draft was already copied to ${this.env ?? 'the other environment'}`, 409, {
                draftId: existing.id,
                title: existing.title ?? '',
            });
        }
        if (existing) return { ...(await this.save(existing.id, draft, null, { force: true })), replaced: true };
        return { ...(await this.create(draft, { source })), replaced: false };
    }

    /**
     * Saves `draft` if the stored revision is still `baseRev` (or `force`).
     * Throws a 409 DraftServiceError carrying the current revision otherwise.
     */
    async save(id, draft, baseRev, { force = false } = {}) {
        const data = serialize(draft);
        let result;
        await this.#write(id, (doc) => {
            if (!force && doc.rev !== baseRev) {
                throw new DraftServiceError('Draft was changed in another window', 409, {
                    rev: doc.rev,
                    updatedAt: toMillis(doc.updated_at),
                });
            }
            const rev = doc.rev + 1;
            const now = this.now();
            result = { id, rev, updatedAt: toMillis(now) };
            return { ...summarize(draft), data, rev, updated_at: now };
        });
        return result;
    }

    // ---------- Publish records ----------
    // Kept in the `publishes` field of the draft document and written only by
    // the server, so they are visible in the console, outside the draft data
    // (undo, autosave and conflict resolution never touch them) and survive
    // the browser closing mid-publish. Records:
    //   { id, kind?, title, status, total, written, failed_count, failed, updated?,
    //     added?, removed?, updated_by, error?, started_at, updated_at, finished_at? }

    /** @returns {Promise<{ seriesId: string|null, publishes: object[] }>} */
    async getPublishes(id) {
        const snapshot = await this.collection.doc(id).get();
        if (!snapshot.exists || snapshot.data().deleted) throw this.#notFound();
        const doc = normalize(snapshot.data());
        return { seriesId: seriesIdOf(doc, this.env), publishes: doc.publishes.map(serializePublish) };
    }

    /** Links the draft to an app series (`series_id`). */
    async setSeriesId(id, seriesId) {
        await this.#write(id, () => ({ series_id: seriesId }));
    }

    /** Adds a publish record and returns it (with its generated `id`). */
    async addPublish(id, record) {
        const now = this.now();
        const publish = { id: `p_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, ...record, started_at: now, updated_at: now };
        await this.#write(id, (doc) => ({ publishes: [...doc.publishes, publish] }));
        return serializePublish(publish);
    }

    /** Merges `patch` into one publish record. */
    async updatePublish(id, publishId, patch) {
        const now = this.now();
        const finished = patch.status === 'done' || patch.status === 'failed' ? { finished_at: now } : {};
        await this.#write(id, (doc) => ({
            publishes: doc.publishes.map((p) => (p.id === publishId ? { ...p, ...patch, ...finished, updated_at: now } : p)),
        }));
    }

    // Soft delete so an accidental delete can be recovered from the console.
    async remove(id) {
        await this.#write(id, () => ({ deleted: true, deleted_at: this.now() }), { allowDeleted: true });
    }

    /**
     * Rewrites documents still in the camelCase shape (including deleted
     * ones). Safe to run repeatedly.
     *
     * @returns {Promise<number>} documents rewritten
     */
    async migrateKeys() {
        const snapshot = await this.collection.get();
        let count = 0;
        for (const doc of snapshot.docs) {
            if (!hasLegacyKeys(doc.data()) && doc.data().series_id !== undefined) continue;
            await this.#write(doc.id, () => ({}), { allowDeleted: true });
            count++;
        }
        return count;
    }

    /**
     * Read-modify-write of one document in a transaction. `fn` gets the
     * normalized document and returns the fields to change; the whole
     * document is written back in the snake_case shape.
     */
    async #write(id, fn, { allowDeleted = false } = {}) {
        const ref = this.collection.doc(id);
        await this.firestore.runTransaction(async (tx) => {
            const snapshot = await tx.get(ref);
            if (!snapshot.exists || (snapshot.data().deleted && !allowDeleted)) throw this.#notFound();
            const doc = normalize(snapshot.data());
            const next = { ...doc, ...fn(doc) };
            if (next.series_id === undefined) next.series_id = seriesIdOf(doc, this.env);
            tx.set(ref, next);
        });
    }
}
