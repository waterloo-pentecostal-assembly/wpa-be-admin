// Publishes a series draft to the selected environment and records the
// result on the draft document (see DraftService publish records).
//
// The record is created before any app data is written, gets the Firestore
// series ID as soon as the bible_series document exists, and is then updated
// with progress while the content entries are written in the background.
// The HTTP request returns right after the series document is created, so a
// slow publish (the loader writes one entry every 2 s) never times out the
// browser and closing the tab doesn't lose the ID.

export class PublishError extends Error {
    constructor(message, status) {
        super(message);
        this.name = 'PublishError';
        this.status = status;
    }
}

const PROGRESS_EVERY_ENTRIES = 5;
const MAX_FAILED_RECORDED = 100;

export class PublishService {
    /**
     * @param {object} deps
     * @param {() => import('./draftService.js').DraftService|null} deps.getDrafts
     * @param {() => import('./dataLoaderService.js').DataLoaderService|null} deps.getLoader
     * @param {() => string} deps.getEnv
     */
    constructor({ getDrafts, getLoader, getEnv }) {
        this.getDrafts = getDrafts;
        this.getLoader = getLoader;
        this.getEnv = getEnv;
        this.running = new Map(); // publishId -> Promise (for tests / shutdown)
    }

    async start(draftId, json) {
        if (!json?.bible_series || typeof json.bible_series !== 'object' || !Array.isArray(json.series_content)) {
            throw new PublishError('bible_series and series_content are required', 400);
        }
        if (!json.series_content.length) throw new PublishError('The series has no content to publish', 400);
        const drafts = this.getDrafts();
        if (!drafts) throw new PublishError('Draft storage is not available', 503);
        const loader = this.getLoader();
        if (!loader) throw new PublishError('Database service not available for the selected environment', 503);
        const env = this.getEnv();

        // Record first: if this fails, nothing has been written to the app yet.
        const publish = await drafts.addPublish(draftId, {
            env,
            title: json.bible_series.title ?? '',
            status: 'starting',
            seriesId: null,
            total: json.series_content.length,
            written: 0,
            failedCount: 0,
            failed: [],
        });

        let seriesId;
        try {
            seriesId = await loader.loadBibleSeries(json.bible_series);
        } catch (error) {
            await drafts.updatePublish(draftId, publish.id, { status: 'failed', error: error.message }).catch(() => {});
            throw new PublishError(`Could not create the series: ${error.message}`, 502);
        }
        try {
            await drafts.updatePublish(draftId, publish.id, { seriesId, status: 'publishing' });
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
                        .then(() => drafts.updatePublish(draftId, publishId, { written, failedCount: failed }))
                        .catch((error) => console.error(`Publish ${publishId}: progress update failed:`, error.message));
                },
            });
            await progressQueue;
            await drafts.updatePublish(draftId, publishId, {
                status: 'done',
                seriesId,
                written: report.written,
                failedCount: report.failed.length,
                failed: report.failed.slice(0, MAX_FAILED_RECORDED),
            });
        } catch (error) {
            await progressQueue;
            console.error(`Publish ${publishId} failed:`, error);
            await drafts.updatePublish(draftId, publishId, { status: 'failed', seriesId, error: error.message }).catch(() => {});
        }
    }
}
