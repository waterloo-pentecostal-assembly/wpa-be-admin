import express from 'express';
import { DraftServiceError } from '../services/draftService.js';
import { PublishError } from '../services/publishService.js';
import { MAX_IMAGE_BYTES, StorageServiceError } from '../services/storageService.js';

function sendError(res, error, fallbackMessage) {
    if (error instanceof DraftServiceError || error instanceof StorageServiceError || error instanceof PublishError) {
        return res.status(error.status).json({ error: error.message, ...(error.details ?? {}) });
    }
    console.error(fallbackMessage, error);
    return res.status(500).json({ error: error.message || fallbackMessage });
}

/**
 * Draft persistence for the series builder. Mount at `/api/drafts`.
 * Drafts belong to the selected environment.
 *
 * @param {() => { service: import('../services/draftService.js').DraftService|null, projectId: string|null, env?: string }} getDrafts
 *   The selected environment's drafts; called per request so a late Firebase initialization or env switch is picked up.
 * @param {import('../services/publishService.js').PublishService} [publisher]
 * @param {(env: string) => import('../services/draftService.js').DraftService|null} [getDraftsFor]
 *   Another environment's drafts, for copying a draft across.
 */
export function createDraftRouter(getDrafts, publisher = null, getDraftsFor = () => null) {
    const router = express.Router();

    const withService = (handler) => async (req, res) => {
        const { service } = getDrafts();
        if (!service) return res.status(503).json({ error: 'Draft storage is not available (no Firebase credentials)' });
        try {
            return await handler(service, req, res);
        } catch (error) {
            return sendError(res, error, 'Draft storage error');
        }
    };

    router.get('/status', (req, res) => {
        const { service, projectId, env = null } = getDrafts();
        res.json({ available: !!service, projectId, env });
    });

    router.get('/', withService(async (service, req, res) => res.json(await service.list())));

    router.post('/', withService(async (service, req, res) => res.status(201).json(await service.create(req.body?.draft))));

    router.get('/:id', withService(async (service, req, res) => res.json(await service.get(req.params.id))));

    router.put('/:id', withService(async (service, req, res) => {
        const { draft, rev, force } = req.body ?? {};
        res.json(await service.save(req.params.id, draft, rev, { force: !!force }));
    }));

    // The linked series and publish records live on the draft document; the browser polls these.
    router.get('/:id/publishes', withService(async (service, req, res) => res.json(await service.getPublishes(req.params.id))));

    // Starts publishing; returns once the series document exists (202) and
    // writes the content in the background, recording progress on the draft.
    router.post('/:id/publish', withService(async (service, req, res) => {
        if (!publisher) return res.status(503).json({ error: 'Publishing is not available' });
        res.status(202).json(await publisher.start(req.params.id, req.body?.json, { updatedBy: req.body?.updatedBy }));
    }));

    // Updating the series this draft is linked to: preview the changes, then
    // apply them (with the preview's planHash).
    router.post('/:id/update-preview', withService(async (service, req, res) => {
        if (!publisher) return res.status(503).json({ error: 'Publishing is not available' });
        res.json(await publisher.previewUpdate(req.params.id, req.body?.json));
    }));

    router.post('/:id/update', withService(async (service, req, res) => {
        if (!publisher) return res.status(503).json({ error: 'Publishing is not available' });
        const { json, planHash, updatedBy } = req.body ?? {};
        res.json(await publisher.applyUpdate(req.params.id, json, planHash, { updatedBy }));
    }));

    // Links a draft opened from a published series to that series.
    router.post('/:id/link', withService(async (service, req, res) => {
        if (!publisher) return res.status(503).json({ error: 'Publishing is not available' });
        res.status(201).json(await publisher.link(req.params.id, req.body?.seriesId, { updatedBy: req.body?.updatedBy }));
    }));

    // Copies a draft to the other environment's drafts (see DraftService.copyIn).
    router.post('/:id/copy-to', withService(async (service, req, res) => {
        const { env: from } = getDrafts();
        const { env: to, replace } = req.body ?? {};
        if (to !== 'prod' && to !== 'dev') return res.status(400).json({ error: 'env must be "prod" or "dev"' });
        if (to === from) return res.status(400).json({ error: `This draft is already in ${to}` });
        const target = getDraftsFor(to);
        if (!target) return res.status(503).json({ error: `Draft storage for ${to} is not available (no ${to} credentials)` });
        const { draft } = await service.get(req.params.id);
        const result = await target.copyIn(draft, { env: from, draft_id: req.params.id }, { replace: !!replace });
        res.status(result.replaced ? 200 : 201).json({ ...result, env: to });
    }));

    router.delete('/:id', withService(async (service, req, res) => {
        await service.remove(req.params.id);
        res.json({ success: true });
    }));

    return router;
}

/**
 * Series already in the app (selected environment), for opening one in the
 * builder. Mount at `/api/published`.
 *
 * @param {() => { service: import('../services/publishedSeries.js').PublishedSeriesService|null, env: string }} getPublished
 */
export function createPublishedRouter(getPublished) {
    const router = express.Router();

    const withService = (handler) => async (req, res) => {
        const { service, env } = getPublished();
        if (!service) return res.status(503).json({ error: 'Database service not available for the selected environment' });
        try {
            return await handler(service, env, req, res);
        } catch (error) {
            return sendError(res, error, 'Could not read published series');
        }
    };

    router.get('/', withService(async (service, env, req, res) => res.json({ env, series: await service.list() })));

    router.get('/:id', withService(async (service, env, req, res) => {
        const json = await service.export(req.params.id);
        if (!json) return res.status(404).json({ error: 'Series not found' });
        res.json({ env, seriesId: req.params.id, ...json });
    }));

    return router;
}

/**
 * Cover image upload/preview. Mount at `/api/storage`.
 *
 * @param {() => { service: import('../services/storageService.js').StorageService|null, env: string }} getStorage
 */
export function createStorageRouter(getStorage) {
    const router = express.Router();
    const rawImage = express.raw({ type: 'image/*', limit: MAX_IMAGE_BYTES + 1024 });

    router.post('/series-image', rawImage, async (req, res) => {
        const { service, env } = getStorage();
        if (!service) return res.status(503).json({ error: 'Firebase Storage is not available' });
        try {
            const result = await service.uploadSeriesImage({
                seriesTitle: req.query.series,
                filename: req.query.filename,
                contentType: req.get('content-type'),
                buffer: Buffer.isBuffer(req.body) ? req.body : null,
            });
            res.status(201).json({ ...result, env });
        } catch (error) {
            sendError(res, error, 'Image upload failed');
        }
    });

    router.get('/preview', async (req, res) => {
        const { service } = getStorage();
        if (!service) return res.status(503).json({ error: 'Firebase Storage is not available' });
        try {
            res.json({ url: await service.previewUrl(req.query.gs) });
        } catch (error) {
            sendError(res, error, 'Image preview failed');
        }
    });

    return router;
}

const OEMBED_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be']);

/**
 * Looks up a YouTube video's title so pasting a song link fills in the
 * link text. Only YouTube URLs are fetched. Mount at `/api/oembed`.
 */
export function createOembedRouter(fetchImpl = fetch) {
    const router = express.Router();
    router.get('/', async (req, res) => {
        let url;
        try {
            url = new URL(String(req.query.url ?? ''));
        } catch {
            return res.status(400).json({ error: 'Invalid URL' });
        }
        if (!OEMBED_HOSTS.has(url.hostname)) return res.status(400).json({ error: 'Only YouTube links are supported' });
        try {
            const response = await fetchImpl(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url.href)}`, {
                signal: AbortSignal.timeout(5000),
            });
            if (!response.ok) return res.status(404).json({ error: 'Video not found' });
            const data = await response.json();
            res.set('Cache-Control', 'public, max-age=86400');
            res.json({ title: data.title ?? '', author: data.author_name ?? '' });
        } catch (error) {
            res.status(502).json({ error: `Lookup failed: ${error.message}` });
        }
    });
    return router;
}
