// Copies a published bible series from prod to dev, for testing: the series
// document and its series_content entries, under the same IDs (so the
// snippet's content IDs still match), plus its cover image, which is copied to
// the dev bucket at the same path so the dev app can load it.
//
// Only series content is copied, never user data (completions, forums,
// groups). The copy is always written inactive: making a series active starts
// the app's automation (other series made inactive, notifications to every
// user), so that's left to the Active switch in dev.

import admin from 'firebase-admin';

// Firestore allows 500 writes per batch.
const BATCH_SIZE = 450;
const GS_URI = /^gs:\/\/([^/]+)\/(.+)$/;

export class SeriesCopyError extends Error {
    constructor(message, status, details = null) {
        super(message);
        this.status = status;
        this.details = details;
    }
}

/** `value` with document references pointing at the same paths in `firestore`. */
function rebase(value, firestore) {
    if (value instanceof admin.firestore.DocumentReference) return firestore.doc(value.path);
    if (Array.isArray(value)) return value.map((v) => rebase(v, firestore));
    if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rebase(v, firestore)]));
    }
    return value;
}

export class SeriesCopyService {
    /**
     * @param {{ getFirestore: (env: string) => import('firebase-admin').firestore.Firestore|null,
     *           getBucket?: (env: string) => import('@google-cloud/storage').Bucket|null }} options
     */
    constructor({ getFirestore, getBucket = () => null }) {
        this.getFirestore = getFirestore;
        this.getBucket = getBucket;
    }

    #db(env) {
        const db = this.getFirestore(env);
        if (!db) throw new SeriesCopyError(`No ${env} credentials, so ${env} can't be read or written`, 503);
        return db;
    }

    /**
     * Copies the series. Fails with 409 (details: the target's title and
     * is_active) if it's already in `to`, unless `replace`, which overwrites
     * it and deletes its entries that aren't in the source.
     *
     * @returns {Promise<{ seriesId, title, from, to, entries: number, removed: number, replaced: boolean,
     *   image: { gs: string, copied: boolean, warning: string|null } }>}
     */
    async copy(seriesId, { from = 'prod', to = 'dev', replace = false } = {}) {
        if (to === 'prod') throw new SeriesCopyError('Series can only be copied to dev, never to prod', 400);
        if (from === to) throw new SeriesCopyError(`The series is already in ${to}`, 400);
        const source = this.#db(from).collection('bible_series').doc(seriesId);
        const targetDb = this.#db(to);
        const target = targetDb.collection('bible_series').doc(seriesId);

        const [seriesDoc, contentSnapshot, existing] = await Promise.all([
            source.get(), source.collection('series_content').get(), target.get(),
        ]);
        if (!seriesDoc.exists) throw new SeriesCopyError(`Series ${seriesId} was not found in ${from}`, 404);
        const series = seriesDoc.data();
        if (existing.exists && !replace) {
            const { title = '', is_active = false } = existing.data();
            throw new SeriesCopyError(`This series is already in ${to}`, 409, { title, is_active: !!is_active });
        }

        const image = await this.copyImage(series.image_gs_location, from, to);

        const ops = [];
        const sourceIds = new Set(contentSnapshot.docs.map((doc) => doc.id));
        let removed = 0;
        if (existing.exists) {
            for (const doc of (await target.collection('series_content').get()).docs) {
                if (sourceIds.has(doc.id)) continue;
                ops.push((batch) => batch.delete(target.collection('series_content').doc(doc.id)));
                removed++;
            }
        }
        for (const doc of contentSnapshot.docs) {
            ops.push((batch) => batch.set(target.collection('series_content').doc(doc.id), rebase(doc.data(), targetDb)));
        }
        // The series document last, so it never points at entries not written yet.
        const data = { ...rebase(series, targetDb), is_active: false };
        if (series.image_gs_location !== undefined) data.image_gs_location = image.gs;
        ops.push((batch) => batch.set(target, data));

        for (let i = 0; i < ops.length; i += BATCH_SIZE) {
            const batch = targetDb.batch();
            for (const op of ops.slice(i, i + BATCH_SIZE)) op(batch);
            await batch.commit();
        }
        return {
            seriesId, title: series.title ?? '', from, to,
            entries: contentSnapshot.docs.length, removed, replaced: existing.exists, image,
        };
    }

    /**
     * Copies a cover image in `from`'s bucket to the same path in `to`'s (if
     * it isn't there already) and returns its new gs:// location. Locations
     * in other buckets are kept as they are; so is one that can't be copied,
     * with a `warning` saying why. Also used when copying a draft.
     *
     * @returns {Promise<{ gs: string, copied: boolean, warning: string|null }>}
     */
    async copyImage(gs, from, to) {
        if (to === 'prod') throw new SeriesCopyError('Images can only be copied to dev, never to prod', 400);
        const keep = (warning = null) => ({ gs: gs ?? '', copied: false, warning });
        const match = GS_URI.exec(gs ?? '');
        if (!match) return keep();
        const [, bucketName, objectPath] = match;
        const fromBucket = this.getBucket(from);
        const toBucket = this.getBucket(to);
        if (toBucket && bucketName === toBucket.name) return keep();
        if (!fromBucket || !toBucket) return keep(`The cover image wasn't copied (no ${!fromBucket ? from : to} storage), so it still points at ${bucketName}`);
        if (bucketName !== fromBucket.name) return keep(`The cover image is in ${bucketName}, not the ${from} bucket, so it was left as is`);
        try {
            const dest = toBucket.file(objectPath);
            const [exists] = await dest.exists();
            if (!exists) {
                const file = fromBucket.file(objectPath);
                const [[buffer], [metadata]] = await Promise.all([file.download(), file.getMetadata()]);
                await dest.save(buffer, {
                    resumable: false,
                    contentType: metadata.contentType,
                    metadata: { cacheControl: metadata.cacheControl ?? 'public, max-age=31536000' },
                });
            }
            return { gs: `gs://${toBucket.name}/${objectPath}`, copied: !exists, warning: null };
        } catch (error) {
            return keep(`The cover image couldn't be copied (${error.message}), so it still points at ${bucketName}`);
        }
    }
}
