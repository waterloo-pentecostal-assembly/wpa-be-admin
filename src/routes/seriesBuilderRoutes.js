import express from 'express';
import { DraftServiceError } from '../services/draftService.js';
import { PublishError } from '../services/publishService.js';
import { SeriesCopyError } from '../services/seriesCopy.js';
import { MAX_AUDIO_BYTES, MAX_IMAGE_BYTES, StorageServiceError } from '../services/storageService.js';
import { bibleAuthFor } from './bibleRoutes.js';

/** Who made a change: the signed-in admin the API's auth check verified (never the request body). */
const actor = (req) => req.admin?.uid ?? null;

function sendError(res, error, fallbackMessage) {
    if (error instanceof DraftServiceError || error instanceof StorageServiceError || error instanceof PublishError || error instanceof SeriesCopyError) {
        if (error.retryAfter !== null && error.retryAfter !== undefined) res.set('Retry-After', String(error.retryAfter));
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
 * @param {{ copyImage?: import('../services/seriesCopy.js').SeriesCopyService['copyImage'] }} [options]
 *   `copyImage` moves a copied draft's cover image into the target environment's bucket.
 */
export function createDraftRouter(getDrafts, publisher = null, getDraftsFor = () => null, { copyImage = null } = {}) {
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
        res.status(202).json(await publisher.start(req.params.id, req.body?.json, { updatedBy: actor(req) }));
    }));

    // Updating the series this draft is linked to: preview the changes, then
    // apply them (with the preview's planHash).
    router.post('/:id/update-preview', withService(async (service, req, res) => {
        if (!publisher) return res.status(503).json({ error: 'Publishing is not available' });
        res.json(await publisher.previewUpdate(req.params.id, req.body?.json, { bibleAuth: bibleAuthFor(req) }));
    }));

    router.post('/:id/update', withService(async (service, req, res) => {
        if (!publisher) return res.status(503).json({ error: 'Publishing is not available' });
        const { json, planHash } = req.body ?? {};
        res.json(await publisher.applyUpdate(req.params.id, json, planHash, { updatedBy: actor(req), bibleAuth: bibleAuthFor(req) }));
    }));

    // Links a draft opened from a published series to that series.
    router.post('/:id/link', withService(async (service, req, res) => {
        if (!publisher) return res.status(503).json({ error: 'Publishing is not available' });
        res.status(201).json(await publisher.link(req.params.id, req.body?.seriesId, { updatedBy: actor(req) }));
    }));

    // Copies a prod draft to the dev drafts, for testing (see DraftService.copyIn).
    // Nothing is ever copied into prod.
    router.post('/:id/copy-to', withService(async (service, req, res) => {
        const { env: from } = getDrafts();
        const { env: to, replace } = req.body ?? {};
        if (from !== 'prod' || to !== 'dev') return res.status(400).json({ error: 'Drafts can only be copied from prod to dev' });
        const target = getDraftsFor(to);
        if (!target) return res.status(503).json({ error: `Draft storage for ${to} is not available (no ${to} credentials)` });
        const { draft } = await service.get(req.params.id);
        // The dev app can't load images from the prod bucket: the cover image
        // is copied into dev's bucket and the copy points at it. The copy is
        // never active, so publishing it in dev doesn't start the automation.
        const image = copyImage && draft.meta?.image_gs_location
            ? await copyImage(draft.meta.image_gs_location, from, to)
            : null;
        const copy = { ...draft, meta: { ...draft.meta, is_active: false, ...(image ? { image_gs_location: image.gs } : {}) } };
        const result = await target.copyIn(copy, { env: from, draft_id: req.params.id }, { replace: !!replace });
        if (image?.warning) console.warn(`Draft ${req.params.id} copied to ${to}: ${image.warning}`);
        res.status(result.replaced ? 200 : 201).json({ ...result, env: to, image });
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
 * @param {import('../services/seriesCopy.js').SeriesCopyService} [copier]  copies a prod series to dev
 */
export function createPublishedRouter(getPublished, copier = null) {
    const router = express.Router();

    const withService = (handler) => async (req, res) => {
        const { service, env } = getPublished();
        if (!service) return res.status(503).json({ error: 'Database service not available for the selected environment' });
        try {
            return await handler(service, env, req, res);
        } catch (error) {
            if (error.status === 400 || error.status === 404) return res.status(error.status).json({ error: error.message });
            return sendError(res, error, 'Could not read published series');
        }
    };

    router.get('/', withService(async (service, env, req, res) => res.json({ env, series: await service.list() })));

    // is_active / is_visible, read and set on their own (see PublishedSeriesService.setFlags).
    router.get('/:id/flags', withService(async (service, env, req, res) => {
        const flags = await service.getFlags(req.params.id);
        if (!flags) return res.status(404).json({ error: 'Series not found' });
        res.json({ env, seriesId: req.params.id, ...flags });
    }));

    router.patch('/:id/flags', withService(async (service, env, req, res) => {
        const { is_active, is_visible } = req.body ?? {};
        const flags = Object.fromEntries(Object.entries({ is_active, is_visible }).filter(([, v]) => v !== undefined));
        const result = await service.setFlags(req.params.id, flags);
        console.log(`Series ${req.params.id} in ${env}: ${Object.entries(flags).map(([k, v]) => `${k}=${v}`).join(', ')} (by ${actor(req) ?? 'unknown'})`);
        res.json({ env, seriesId: req.params.id, ...result });
    }));

    // Copies a series from the selected environment (prod) to dev, for testing.
    // 409 (with the dev copy's title and is_active) if it's already there, unless `replace`.
    router.post('/:id/copy-to', async (req, res) => {
        if (!copier) return res.status(503).json({ error: 'Copying series is not available' });
        const { env: from } = getPublished();
        const { env: to, replace } = req.body ?? {};
        if (from !== 'prod' || to !== 'dev') return res.status(400).json({ error: 'Series can only be copied from prod to dev' });
        try {
            const result = await copier.copy(req.params.id, { from, to, replace: !!replace });
            console.log(`Copied series ${req.params.id} (${result.entries} entries) from ${from} to ${to}${result.replaced ? ', replacing the copy there' : ''} (by ${actor(req) ?? 'unknown'})`);
            res.status(result.replaced ? 200 : 201).json(result);
        } catch (error) {
            sendError(res, error, 'Could not copy the series');
        }
    });

    router.get('/:id', withService(async (service, env, req, res) => {
        const json = await service.export(req.params.id);
        if (!json) return res.status(404).json({ error: 'Series not found' });
        res.json({ env, seriesId: req.params.id, ...json });
    }));

    return router;
}

/**
 * Cover image upload/preview and audio uploads. Mount at `/api/storage`.
 *
 * @param {() => { service: import('../services/storageService.js').StorageService|null, env: string }} getStorage
 */
export function createStorageRouter(getStorage) {
    const router = express.Router();
    const rawImage = express.raw({ type: 'image/*', limit: MAX_IMAGE_BYTES + 1024 });
    const rawAudio = express.raw({ type: 'audio/*', limit: MAX_AUDIO_BYTES + 1024 });

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

    // An audio block's file: uploaded to audio_files/ in the selected
    // environment's bucket; returns its download URL (`url`) for audio_file_url.
    router.post('/audio', rawAudio, async (req, res) => {
        const { service, env } = getStorage();
        if (!service) return res.status(503).json({ error: 'Firebase Storage is not available' });
        try {
            const result = await service.uploadAudio({
                filename: req.query.filename,
                contentType: req.get('content-type'),
                buffer: Buffer.isBuffer(req.body) ? req.body : null,
            });
            res.status(201).json({ ...result, env });
        } catch (error) {
            sendError(res, error, 'Audio upload failed');
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
