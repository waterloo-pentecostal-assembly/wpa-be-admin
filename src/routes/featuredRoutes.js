import express from 'express';
import { FEATURED_TYPES, FeaturedContentError, MAX_CONCURRENT } from '../services/featuredContent.js';

/**
 * Featured content for the app's home screen (selected environment). Mount
 * at `/api/featured` behind the admin check.
 *
 *   GET    /       -> { env, maxConcurrent, types, authors: [{ uid, name }], items: [{ id, type, ...fields, start, end, status }] }
 *   POST   /       { type, start, end, ...the type's fields } -> the new item (201)
 *   PUT    /:id    { type, start, end, ...the type's fields } -> the updated item
 *   DELETE /:id
 *
 * `start` and `end` are days (YYYY-MM-DD, both included) in the app's time
 * zone. Writes must name the environment the page is showing (`env`), so a
 * switch made elsewhere can't send them to the other one. A write that would
 * make more than `maxConcurrent` items show at once is refused (409).
 * `authors` are the users tagged as pastors, who can be an item's `author_uid`.
 *
 * @param {() => { service: import('../services/featuredContent.js').FeaturedContentService|null, env: string }} getFeatured
 */
export function createFeaturedRouter(getFeatured) {
    const router = express.Router();

    const handle = (handler, { write = false, status = 200 } = {}) => async (req, res) => {
        const { service, env } = getFeatured();
        if (!service) return res.status(503).json({ error: 'Featured content is not available for the selected environment' });
        try {
            if (write && req.body?.env !== env) {
                throw new FeaturedContentError(`The server is now working on ${env}, not ${req.body?.env ?? 'the environment this page shows'}. Reload the page.`, 409);
            }
            const result = await handler(service, req, { env, actor: req.admin?.uid ?? null });
            return res.status(status).json(result ?? { success: true });
        } catch (error) {
            if (error instanceof FeaturedContentError) return res.status(error.status).json({ error: error.message, ...(error.details ?? {}) });
            console.error('Featured content error:', error);
            return res.status(500).json({ error: error.message || 'Featured content error' });
        }
    };

    router.get('/', handle(async (service, req, { env }) => {
        const [items, authors] = await Promise.all([service.list(), service.listAuthors()]);
        return { env, maxConcurrent: MAX_CONCURRENT, types: FEATURED_TYPES, authors, items };
    }));
    router.post('/', handle((service, req, { actor }) => service.create(req.body, actor), { write: true, status: 201 }));
    router.put('/:id', handle((service, req, { actor }) => service.update(req.params.id, req.body, actor), { write: true }));
    router.delete('/:id', handle(async (service, req) => {
        await service.remove(req.params.id);
    }, { write: true }));

    return router;
}
