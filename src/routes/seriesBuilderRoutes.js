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
 *
 * @param {() => { service: import('../services/draftService.js').DraftService|null, projectId: string|null }} getDrafts
 *   Called per request so a late Firebase initialization is picked up.
 * @param {import('../services/publishService.js').PublishService} [publisher]
 */
export function createDraftRouter(getDrafts, publisher = null) {
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
        const { service, projectId } = getDrafts();
        res.json({ available: !!service, projectId });
    });

    router.get('/', withService(async (service, req, res) => res.json(await service.list())));

    router.post('/', withService(async (service, req, res) => res.status(201).json(await service.create(req.body?.draft))));

    router.get('/:id', withService(async (service, req, res) => res.json(await service.get(req.params.id))));

    router.put('/:id', withService(async (service, req, res) => {
        const { draft, rev, force } = req.body ?? {};
        res.json(await service.save(req.params.id, draft, rev, { force: !!force }));
    }));

    // Publish records live on the draft document; the browser polls these.
    router.get('/:id/publishes', withService(async (service, req, res) => res.json(await service.getPublishes(req.params.id))));

    // Starts publishing; returns once the series document exists (202) and
    // writes the content in the background, recording progress on the draft.
    router.post('/:id/publish', withService(async (service, req, res) => {
        if (!publisher) return res.status(503).json({ error: 'Publishing is not available' });
        res.status(202).json(await publisher.start(req.params.id, req.body?.json));
    }));

    router.delete('/:id', withService(async (service, req, res) => {
        await service.remove(req.params.id);
        res.json({ success: true });
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
