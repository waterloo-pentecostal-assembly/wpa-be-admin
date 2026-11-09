// Publishes a series draft to the selected environment and records the
// result on the draft document (see DraftService publish records).
//
// A draft is linked to at most one app series (its `series_id`); drafts and
// series of an environment live in that environment's own project. The
// publish record is created before any app data is written, the draft gets
// the series ID as soon as the bible_series document exists, and the record
// is then updated with progress while the content entries are written in the
// background. The HTTP request returns right after the series document is
// created, so a large publish never times out the browser and closing the tab
// doesn't lose the ID. The loader sets the series snippet once the content is
// written.
//
// Once linked (by publishing, or by opening a published series, see `link`),
// the draft updates its series in place: `previewUpdate` reports what would
// change and `applyUpdate` writes it. Records carry `kind` ('import' |
// 'update'; none for a publish) and `updated_by`, the user ID of the admin who started it.

export class PublishError extends Error {
    constructor(message, status, details = {}) {
        super(message);
        this.name = 'PublishError';
        this.status = status;
        this.details = details;
    }
}

const PROGRESS_EVERY_ENTRIES = 5;
const MAX_FAILED_RECORDED = 100;
// Matches STALE_AFTER_MS in ui/src/series/publishes.js.
const STALE_AFTER_MS = 2 * 60 * 1000;

function validateJson(json) {
    if (!json?.bible_series || typeof json.bible_series !== 'object' || !Array.isArray(json.series_content)) {
        throw new PublishError('bible_series and series_content are required', 400);
    }
    if (!json.series_content.length) throw new PublishError('The series has no content to publish', 400);
}

function isRunning(record, now = Date.now()) {
    return (record.status === 'starting' || record.status === 'publishing')
        && now - (record.updated_at ?? record.started_at ?? now) <= STALE_AFTER_MS;
}

export class PublishService {
    /**
     * @param {object} deps
     * @param {() => import('./draftService.js').DraftService|null} deps.getDrafts
     * @param {() => import('./dataLoaderService.js').DataLoaderService|null} deps.getLoader
     * @param {() => import('./publishedSeries.js').PublishedSeriesService|null} [deps.getPublished]
     * @param {() => string} deps.getEnv
     */
    constructor({ getDrafts, getLoader, getPublished = () => null, getEnv }) {
        this.getDrafts = getDrafts;
        this.getLoader = getLoader;
        this.getPublished = getPublished;
        this.getEnv = getEnv;
        this.running = new Map(); // publishId -> Promise (for tests / shutdown)
        this.updating = new Set(); // `${env}/${seriesId}` being updated
    }

    /** @param {{ updatedBy?: string }} [options] */
    async start(draftId, json, { updatedBy = null } = {}) {
        validateJson(json);
        const drafts = this.getDrafts();
        if (!drafts) throw new PublishError('Draft storage is not available', 503);
        const loader = this.getLoader();
        if (!loader) throw new PublishError('Database service not available for the selected environment', 503);

        const { seriesId: linked, publishes } = await drafts.getPublishes(draftId);
        if (publishes.some((p) => isRunning(p))) {
            throw new PublishError('This draft is still being published or updated; try again when it finishes', 409);
        }
        // A published draft updates its series; it only publishes again if that series was deleted.
        if (linked) {
            const published = this.getPublished();
            if (!published) throw new PublishError('Database service not available for the selected environment', 503);
            if ((await published.read(linked)).series) {
                throw new PublishError(`This draft is already published (series ${linked}); update it instead`, 409, { seriesId: linked });
            }
        }

        // Record first: if this fails, nothing has been written to the app yet.
        const publish = await drafts.addPublish(draftId, {
            title: json.bible_series.title ?? '',
            status: 'starting',
            total: json.series_content.length,
            written: 0,
            failed_count: 0,
            failed: [],
            updated_by: updatedBy,
        });

        let seriesId;
        try {
            seriesId = await loader.loadBibleSeries(json.bible_series);
        } catch (error) {
            await drafts.updatePublish(draftId, publish.id, { status: 'failed', error: error.message }).catch(() => {});
            throw new PublishError(`Could not create the series: ${error.message}`, 502);
        }
        try {
            await drafts.setSeriesId(draftId, seriesId);
            await drafts.updatePublish(draftId, publish.id, { status: 'publishing' });
        } catch (error) {
            // The series exists in the app; carry on and keep trying to record it.
            console.error(`Publish ${publish.id}: series ${seriesId} created but not yet recorded:`, error);
        }

        const run = this.#writeContent(drafts, loader, draftId, publish.id, seriesId, json.series_content)
            .finally(() => this.running.delete(publish.id));
        this.running.set(publish.id, run);

        return { ...publish, seriesId, status: 'publishing' };
    }

    async #writeContent(drafts, loader, draftId, publishId, seriesId, content) {
        // Progress writes run one at a time and finish before the final
        // update, so a late progress write can never overwrite the result.
        let progressQueue = Promise.resolve();
        try {
            const report = await loader.loadSeriesContent(content, seriesId, {
                onProgress: ({ written, failed, total }) => {
                    const done = written + failed;
                    if (done % PROGRESS_EVERY_ENTRIES !== 0 || done >= total) return;
                    progressQueue = progressQueue
                        .then(() => drafts.updatePublish(draftId, publishId, { written, failed_count: failed }))
                        .catch((error) => console.error(`Publish ${publishId}: progress update failed:`, error.message));
                },
            });
            await progressQueue;
            // Recorded here too in case it couldn't be when the series was created.
            await drafts.setSeriesId(draftId, seriesId).catch(() => {});
            await drafts.updatePublish(draftId, publishId, {
                status: 'done',
                written: report.written,
                failed_count: report.failed.length,
                failed: report.failed.slice(0, MAX_FAILED_RECORDED),
            });
        } catch (error) {
            await progressQueue;
            console.error(`Publish ${publishId} failed:`, error);
            await drafts.updatePublish(draftId, publishId, { status: 'failed', error: error.message }).catch(() => {});
        }
    }

    #services() {
        const drafts = this.getDrafts();
        if (!drafts) throw new PublishError('Draft storage is not available', 503);
        const published = this.getPublished();
        if (!published) throw new PublishError('Database service not available for the selected environment', 503);
        return { drafts, published, env: this.getEnv() };
    }

    /** The series this draft is linked to; throws if none or if it is busy. */
    async #target(drafts, draftId, env) {
        const { seriesId, publishes } = await drafts.getPublishes(draftId);
        if (!seriesId) throw new PublishError("This draft hasn't been published yet", 404);
        if (publishes.some((p) => isRunning(p)) || this.updating.has(`${env}/${seriesId}`)) {
            throw new PublishError('This series is still being published or updated; try again when it finishes', 409);
        }
        return seriesId;
    }

    async #plan(published, seriesId, json) {
        try {
            return await published.plan(seriesId, json);
        } catch (error) {
            if (error.code === 'not-found') {
                throw new PublishError(`Series ${seriesId} no longer exists; it may have been deleted in Firebase`, 404, { seriesMissing: true });
            }
            throw new PublishError(`Could not read the published series: ${error.message}`, 502);
        }
    }

    /** What updating the draft's series to match `json` would change (nothing is written). */
    async previewUpdate(draftId, json) {
        validateJson(json);
        const { drafts, published, env } = this.#services();
        const seriesId = await this.#target(drafts, draftId, env);
        const { summary } = await this.#plan(published, seriesId, json);
        return { ...summary, seriesId, env };
    }

    /**
     * Updates the draft's series in place to match `json`. `planHash` (from
     * the preview) makes sure what is written is what the admin reviewed.
     *
     * @param {{ updatedBy?: string }} [options]
     */
    async applyUpdate(draftId, json, planHash, { updatedBy = null } = {}) {
        validateJson(json);
        const { drafts, published, env } = this.#services();
        const seriesId = await this.#target(drafts, draftId, env);
        const key = `${env}/${seriesId}`;
        this.updating.add(key);
        try {
            const { writes, summary } = await this.#plan(published, seriesId, json);
            if (planHash && summary.planHash !== planHash) {
                throw new PublishError('The published series changed since the preview; review the changes again', 409);
            }
            const result = { ...summary, seriesId, env };
            if (!summary.writeCount) return { ...result, record: null };

            const record = await drafts.addPublish(draftId, {
                kind: 'update',
                title: json.bible_series.title ?? '',
                status: 'publishing',
                total: summary.writeCount,
                written: 0,
                failed_count: 0,
                failed: [],
                updated: summary.updated.length,
                added: summary.added.length,
                removed: summary.removed.length,
                updated_by: updatedBy,
            });
            try {
                await published.apply(seriesId, writes);
            } catch (error) {
                await drafts.updatePublish(draftId, record.id, { status: 'failed', error: error.message }).catch(() => {});
                throw new PublishError(`Update failed: ${error.message}`, 502);
            }
            const patch = { status: 'done', written: summary.writeCount };
            await drafts.updatePublish(draftId, record.id, patch).catch((error) => {
                console.error(`Update ${record.id} of ${seriesId} succeeded but was not recorded:`, error);
            });
            return { ...result, record: { ...record, ...patch } };
        } finally {
            this.updating.delete(key);
        }
    }

    /**
     * Links a draft opened from a published series to it, so the draft can
     * update that series. One draft per series, so edits can't be split
     * across drafts. Recorded as a publish record with kind: 'import'.
     *
     * @param {{ updatedBy?: string }} [options]
     */
    async link(draftId, seriesId, { updatedBy = null } = {}) {
        if (!seriesId || typeof seriesId !== 'string') throw new PublishError('seriesId is required', 400);
        const { drafts, published, env } = this.#services();
        const { seriesId: linked } = await drafts.getPublishes(draftId);
        if (linked === seriesId) return { seriesId };
        if (linked) throw new PublishError(`This draft is already linked to series ${linked}`, 409);
        const other = await drafts.findLinked(seriesId);
        if (other) throw new PublishError(`Series ${seriesId} is already open in another draft`, 409, { draftId: other });
        const { series, content } = await published.read(seriesId);
        if (!series) throw new PublishError(`Series ${seriesId} was not found in ${env}`, 404);
        await drafts.setSeriesId(draftId, seriesId);
        const record = await drafts.addPublish(draftId, {
            kind: 'import',
            title: series.title ?? '',
            status: 'done',
            total: content.length,
            written: content.length,
            failed_count: 0,
            failed: [],
            updated_by: updatedBy,
        });
        return { seriesId, record };
    }
}
