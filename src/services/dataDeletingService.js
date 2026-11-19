/** @typedef {import("@google-cloud/firestore").Firestore} Firestore */
import { DateTime } from 'luxon';
import { SERIES_ZONE } from './publishedSeries.js';

/** User content that can be deleted by age: collection -> what it's called. Each is dated by `date`. */
export const OLD_CONTENT_KINDS = {
    prayer_requests: { label: 'Prayer requests', noun: 'prayer requests' },
    testimonies: { label: 'Testimonies', noun: 'testimonies' },
};

export class DataDeletingError extends Error {
    constructor(message, status = 400) {
        super(message);
        this.status = status;
    }
}

/**
 * The start of a YYYY-MM-DD day in the app's time zone (America/Toronto), so
 * "before 2025-01-01" means before local midnight wherever the server runs.
 * Later than tomorrow is refused: that would delete everything.
 * @returns {Date}
 */
export function cutoffFromDay(day, { zone = SERIES_ZONE, now = () => DateTime.now() } = {}) {
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(String(day ?? '')) ? DateTime.fromISO(day, { zone }) : null;
    if (!parsed?.isValid) throw new DataDeletingError('Choose a date as YYYY-MM-DD');
    if (parsed > now().setZone(zone).startOf('day').plus({ days: 1 })) throw new DataDeletingError('The date can\'t be in the future');
    return parsed.startOf('day').toJSDate();
}

export class DataDeletingService {
    /**
     * @param {Firestore} firestore 
     */
    constructor(firestore) {
        this.firestore = firestore;
    }

    #kind(collection) {
        if (!Object.hasOwn(OLD_CONTENT_KINDS, collection)) throw new DataDeletingError(`Unknown kind of content: ${collection}`);
        return collection;
    }

    /** Documents in `collection` dated before `before` (documents without a `date` aren't included). */
    #older(collection, before) {
        return this.firestore.collection(this.#kind(collection)).where('date', '<', before);
    }

    /**
     * How many documents in each kind are dated before `before`, and how many there are in all.
     * @param {Date} before
     * @param {string[]} [kinds] - collections (default: all of OLD_CONTENT_KINDS)
     * @returns {Promise<Record<string, { label: string, older: number, total: number }>>}
     */
    async countOldContent(before, kinds = Object.keys(OLD_CONTENT_KINDS)) {
        const entries = await Promise.all(kinds.map(async (collection) => {
            const [older, total] = await Promise.all([
                this.#older(collection, before).count().get(),
                this.firestore.collection(collection).count().get(),
            ]);
            return [collection, { label: OLD_CONTENT_KINDS[collection].label, older: older.data().count, total: total.data().count }];
        }));
        return Object.fromEntries(entries);
    }

    /**
     * Deletes the documents in `collection` dated before `before`, with any subcollections.
     * @param {string} collection - a key of OLD_CONTENT_KINDS
     * @param {Date} before
     * @param {{ concurrency?: number, onProgress?: (deleted: number, total: number) => void }} [options]
     * @returns {Promise<number>} how many were deleted
     */
    async deleteOldContent(collection, before, { concurrency = 20, onProgress } = {}) {
        const snapshot = await this.#older(collection, before).select().get();
        const refs = snapshot.docs.map((doc) => this.firestore.collection(collection).doc(doc.id));
        let deleted = 0;
        let next = 0;
        const worker = async () => {
            while (next < refs.length) {
                const ref = refs[next++];
                await this.firestore.recursiveDelete(ref);
                deleted++; // not inside onProgress?.(): its arguments are skipped when it's unset
                onProgress?.(deleted, refs.length);
            }
        };
        await Promise.all(Array.from({ length: Math.min(concurrency, refs.length) }, worker));
        return deleted;
    }

    /** Counts prayer requests dated before `before`. @returns {Promise<number>} */
    async countOldPrayerRequests(before) {
        return (await this.countOldContent(before, ['prayer_requests'])).prayer_requests.older;
    }

    /** Deletes prayer requests dated before `before`, with any subcollections. @returns {Promise<number>} */
    deleteOldPrayerRequests(before, options) {
        return this.deleteOldContent('prayer_requests', before, options);
    }

    /** Counts testimonies dated before `before`. @returns {Promise<number>} */
    async countOldTestimonies(before) {
        return (await this.countOldContent(before, ['testimonies'])).testimonies.older;
    }

    /** Deletes testimonies dated before `before`, with any subcollections. @returns {Promise<number>} */
    deleteOldTestimonies(before, options) {
        return this.deleteOldContent('testimonies', before, options);
    }
}
