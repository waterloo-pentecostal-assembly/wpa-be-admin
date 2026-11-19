import express from 'express';
import { BibleServiceError } from '../services/bibleService.js';
import { ApiBibleError, bearerAuth } from '../services/apiBibleClient.js';
import { bearerToken } from './apiAuth.js';

// Books, chapters and the translation list rarely change, so the browser can
// cache them instead of refetching on every picker open.
const CACHE_CONTROL = 'private, max-age=3600';

/**
 * Credentials for the Bible proxy on behalf of the admin making `req`: their
 * own Firebase ID token, forwarded as-is (the proxy has no service-to-service
 * auth). The /api guard has already checked it.
 */
export function bibleAuthFor(req) {
    return bearerAuth(bearerToken(req));
}

/** Sends a Bible error with its status (and the proxy's Retry-After). */
export function sendBibleError(res, error) {
    if (error instanceof BibleServiceError || error instanceof ApiBibleError) {
        if (error.retryAfter !== null && error.retryAfter !== undefined) res.set('Retry-After', String(error.retryAfter));
        return res.status(error.status).json({ error: error.message });
    }
    console.error('Error in Bible API:', error);
    return res.status(500).json({ error: error.message });
}

/**
 * Builds the Bible router, backed by API.Bible through the Bible proxy. Mount
 * it at `/api/bible`:
 *
 * - GET  /translations                                       -> translations admins can pick + the default
 * - GET  /aliases                                            -> book abbreviations (typeahead)
 * - GET  /:bibleId/books                                     -> books in a translation
 * - GET  /:bibleId/books/:book/chapters                      -> chapters (with usual verse counts)
 * - GET  /:bibleId/books/:book/chapters/:chapter/verses      -> verses for a chapter
 * - GET  /:bibleId/passage?ref=Romans%204%3A1-6              -> verses for a typed reference
 * - POST /:bibleId/passages { refs: [...] }                  -> many references at once
 *
 * `:bibleId` is an API.Bible Bible ID, or `default` for the configured default.
 * Proxy calls are made with the requesting admin's ID token.
 *
 * @param {import('../services/apiBibleService.js').ApiBibleService|null} bible
 * @param {{ unavailableReason?: string }} [options]
 *   When `bible` is null every endpoint returns 503.
 * @returns {import('express').Router}
 */
export function createBibleRouter(bible, { unavailableReason = 'Bible API not configured' } = {}) {
    const router = express.Router();

    function handle(handler, { cache = false } = {}) {
        return async (req, res) => {
            if (!bible) return res.status(503).json({ error: unavailableReason });
            try {
                const body = await handler(bible.withAuth(bibleAuthFor(req)), req);
                if (cache) res.set('Cache-Control', CACHE_CONTROL);
                return res.json(body);
            } catch (error) {
                return sendBibleError(res, error);
            }
        };
    }

    router.get('/translations', handle((b) => b.listTranslations()));

    router.get('/aliases', handle((b) => b.getBookAliases(), { cache: true }));

    router.get('/:bibleId/books', handle((b, req) => b.getBooks(req.params.bibleId), { cache: true }));

    router.get(
        '/:bibleId/books/:book/chapters',
        handle((b, req) => b.getChapters(req.params.bibleId, req.params.book), { cache: true }),
    );

    router.get(
        '/:bibleId/books/:book/chapters/:chapter/verses',
        handle((b, req) => b.getVerses(req.params.bibleId, req.params.book, req.params.chapter)),
    );

    router.get('/:bibleId/passage', handle((b, req) => b.getPassage(req.params.bibleId, req.query.ref)));

    router.post('/:bibleId/passages', express.json(), handle((b, req) => b.getPassages(req.params.bibleId, req.body?.refs)));

    return router;
}

/** What `POST /cache/purge` accepts: exactly one of these. */
function purgeTarget(body) {
    const id = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
    const targets = [
        body?.all === true && { all: true },
        id(body?.bibleId) && { bibleId: body.bibleId },
        id(body?.audioBibleId) && { audioBibleId: body.audioBibleId },
    ].filter(Boolean);
    const keys = Object.keys(body ?? {});
    return targets.length === 1 && keys.length === 1 ? targets[0] : null;
}

/**
 * The Bible proxy's own admin endpoints, called with the requesting admin's
 * ID token. Mount it at `/api/bible-proxy`:
 *
 * - GET  /stats         -> cache hit rate, upstream calls, masked key status
 * - GET  /whoami        -> who the proxy thinks the caller is
 * - GET  /routes        -> every proxy route with its allowed query parameters
 * - POST /cache/purge   { all: true } | { bibleId } | { audioBibleId }
 *
 * A purge also forgets this server's short-lived copy.
 *
 * @param {import('../services/apiBibleService.js').ApiBibleService|null} bible
 */
export function createBibleProxyAdminRouter(bible) {
    const router = express.Router();

    const forward = (method, path, getJson) => async (req, res) => {
        if (!bible) return res.status(503).json({ error: 'Bible API not configured' });
        let json;
        if (getJson) {
            json = getJson(req);
            if (!json) {
                return res.status(400).json({ error: 'Send exactly one of {"all":true}, {"bibleId":"…"} or {"audioBibleId":"…"}' });
            }
        }
        try {
            const { client } = bible.withAuth(bibleAuthFor(req));
            const { body } = await client.send(path, { method, json, absolute: true });
            if (method === 'POST') bible.clearCache();
            return res.json(body);
        } catch (error) {
            return sendBibleError(res, error);
        }
    };

    router.get('/stats', forward('GET', '/admin/stats'));
    router.get('/whoami', forward('GET', '/admin/whoami'));
    router.get('/routes', forward('GET', '/admin/routes'));
    router.post('/cache/purge', express.json(), forward('POST', '/admin/cache/purge', (req) => purgeTarget(req.body)));

    return router;
}
