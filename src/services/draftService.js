import admin from 'firebase-admin';

// Series builder drafts are stored as a JSON string so the draft's shape is
// never constrained by Firestore (nested arrays, undefined values) and a
// whole draft is read/written in one document.
export const DRAFTS_COLLECTION = 'admin_series_drafts';

// Firestore's document limit is 1 MiB; leave room for the summary fields.
const MAX_DRAFT_BYTES = 900 * 1024;

export class DraftServiceError extends Error {
    constructor(message, status, details = {}) {
        super(message);
        this.name = 'DraftServiceError';
        this.status = status;
        this.details = details;
    }
}

function summarize(draft) {
    const days = Array.isArray(draft?.days) ? draft.days : [];
    return {
        title: draft?.meta?.title ?? '',
        dayCount: days.length,
        startDate: days[0]?.date ?? '',
        endDate: days.at(-1)?.date ?? '',
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

function serializePublish(p) {
    return { ...p, startedAt: toMillis(p.startedAt), updatedAt: toMillis(p.updatedAt), finishedAt: toMillis(p.finishedAt) };
}

/**
 * Stores series builder drafts in Firestore with optimistic concurrency:
 * every save must name the revision it was based on, so two tabs editing
 * the same draft cannot silently overwrite each other.
 */
export class DraftService {
    constructor(firestore, { collection = DRAFTS_COLLECTION, now = () => admin.firestore.Timestamp.now() } = {}) {
        this.firestore = firestore;
        this.collection = firestore.collection(collection);
        this.now = now;
    }

    async list() {
        const snapshot = await this.collection.orderBy('updatedAt', 'desc').limit(200).get();
        return snapshot.docs
            .map((doc) => ({ id: doc.id, ...doc.data() }))
            .filter((d) => !d.deleted)
            .map(({ id, title, dayCount, startDate, endDate, publishes, rev, updatedAt }) => ({
                id,
                title,
                dayCount,
                startDate,
                endDate,
                publishedCount: (publishes ?? []).filter((p) => p.seriesId).length,
                rev,
                updatedAt: toMillis(updatedAt),
            }));
    }

    async get(id) {
        const doc = await this.collection.doc(id).get();
        if (!doc.exists || doc.data().deleted) throw new DraftServiceError('Draft not found', 404);
        const data = doc.data();
        return { id: doc.id, rev: data.rev, updatedAt: toMillis(data.updatedAt), draft: JSON.parse(data.data) };
    }

    async create(draft) {
        const data = serialize(draft);
        const updatedAt = this.now();
        const ref = this.collection.doc();
        await ref.set({ ...summarize(draft), data, rev: 1, createdAt: updatedAt, updatedAt, deleted: false, publishes: [] });
        return { id: ref.id, rev: 1, updatedAt: toMillis(updatedAt) };
    }

    /**
     * Saves `draft` if the stored revision is still `baseRev` (or `force`).
     * Throws a 409 DraftServiceError carrying the current revision otherwise.
     */
    async save(id, draft, baseRev, { force = false } = {}) {
        const data = serialize(draft);
        const ref = this.collection.doc(id);
        return this.firestore.runTransaction(async (tx) => {
            const doc = await tx.get(ref);
            if (!doc.exists || doc.data().deleted) throw new DraftServiceError('Draft not found', 404);
            const current = doc.data();
            if (!force && current.rev !== baseRev) {
                throw new DraftServiceError('Draft was changed in another window', 409, {
                    rev: current.rev,
                    updatedAt: toMillis(current.updatedAt),
                });
            }
            const rev = current.rev + 1;
            const updatedAt = this.now();
            tx.update(ref, { ...summarize(draft), data, rev, updatedAt });
            return { id, rev, updatedAt: toMillis(updatedAt) };
        });
    }

    // ---------- Publish records ----------
    // Kept in the `publishes` field of the draft document and written only by
    // the server, so they are visible in the console, outside the draft data
    // (undo, autosave and conflict resolution never touch them) and survive
    // the browser closing mid-publish.

    async getPublishes(id) {
        const doc = await this.collection.doc(id).get();
        if (!doc.exists || doc.data().deleted) throw new DraftServiceError('Draft not found', 404);
        return (doc.data().publishes ?? []).map(serializePublish);
    }

    /** Adds a publish record and returns it (with its generated `id`). */
    async addPublish(id, record) {
        const publish = { id: `p_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, ...record, startedAt: this.now(), updatedAt: this.now() };
        await this.#updatePublishes(id, (list) => [...list, publish]);
        return serializePublish(publish);
    }

    /** Merges `patch` into one publish record. */
    async updatePublish(id, publishId, patch) {
        const now = this.now();
        const finished = patch.status === 'done' || patch.status === 'failed' ? { finishedAt: now } : {};
        await this.#updatePublishes(id, (list) => list.map((p) => (p.id === publishId ? { ...p, ...patch, ...finished, updatedAt: now } : p)));
    }

    async #updatePublishes(id, fn) {
        const ref = this.collection.doc(id);
        await this.firestore.runTransaction(async (tx) => {
            const doc = await tx.get(ref);
            if (!doc.exists || doc.data().deleted) throw new DraftServiceError('Draft not found', 404);
            // Only `publishes` changes, so draft saves (rev) are unaffected.
            tx.update(ref, { publishes: fn(doc.data().publishes ?? []) });
        });
    }

    // Soft delete so an accidental delete can be recovered from the console.
    async remove(id) {
        const ref = this.collection.doc(id);
        const doc = await ref.get();
        if (!doc.exists) throw new DraftServiceError('Draft not found', 404);
        await ref.update({ deleted: true, deletedAt: this.now() });
    }
}
