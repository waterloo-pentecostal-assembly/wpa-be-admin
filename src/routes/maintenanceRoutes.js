import express from 'express';
import { DataDeletingError, OLD_CONTENT_KINDS, cutoffFromDay } from '../services/dataDeletingService.js';

function sendError(res, error) {
    if (error instanceof DataDeletingError) return res.status(error.status).json({ error: error.message });
    console.error('Maintenance error:', error);
    return res.status(500).json({ error: error.message || 'Maintenance error' });
}

/**
 * Maintenance API. Mount at `/api/maintenance` behind `createRequireAdmin`.
 *
 *   GET  /old-content?before=YYYY-MM-DD
 *        -> { env, before, cutoff, kinds: { prayer_requests: { label, older, total }, testimonies: {...} } }
 *   POST /old-content/delete { before, kinds: ['prayer_requests'|'testimonies', ...], env }
 *        -> { env, before, cutoff, deleted: { prayer_requests: n, ... } }
 *
 * `before` is a day in the app's time zone; content dated before its start is
 * included. A delete must name the environment it expects (the one the page
 * showed counts for), so a switch made elsewhere can't redirect it.
 *
 * @param {() => { service: import('../services/dataDeletingService.js').DataDeletingService|null, env: string }} getMaintenance
 *   Called per request so an env switch is picked up.
 */
export function createMaintenanceRouter(getMaintenance) {
    const router = express.Router();

    const handle = (handler) => async (req, res) => {
        const { service, env } = getMaintenance();
        if (!service) return res.status(503).json({ error: 'Maintenance is not available for the selected environment' });
        try {
            return res.json(await handler(service, req, { env, actor: req.admin?.email ?? req.admin?.uid ?? null }));
        } catch (error) {
            return sendError(res, error);
        }
    };

    router.get('/old-content', handle(async (service, req, { env }) => {
        const cutoff = cutoffFromDay(req.query.before);
        return { env, before: req.query.before, cutoff: cutoff.toISOString(), kinds: await service.countOldContent(cutoff) };
    }));

    router.post('/old-content/delete', handle(async (service, req, { env, actor }) => {
        const { before, kinds, env: expectedEnv } = req.body ?? {};
        if (expectedEnv !== env) {
            throw new DataDeletingError(`The server is now working on ${env}, not ${expectedEnv ?? 'the environment you counted'}. Check the counts again.`, 409);
        }
        const cutoff = cutoffFromDay(before);
        const chosen = [...new Set(Array.isArray(kinds) ? kinds : [])];
        if (!chosen.length) throw new DataDeletingError('Choose what to delete');
        const unknown = chosen.filter((kind) => !Object.hasOwn(OLD_CONTENT_KINDS, kind));
        if (unknown.length) throw new DataDeletingError(`Unknown kind of content: ${unknown.join(', ')}`);

        const deleted = {};
        for (const kind of chosen) {
            deleted[kind] = await service.deleteOldContent(kind, cutoff);
            console.log(`[maintenance] ${actor ?? 'unknown'} deleted ${deleted[kind]} ${OLD_CONTENT_KINDS[kind].noun} dated before ${before} (${env})`);
        }
        return { env, before, cutoff: cutoff.toISOString(), deleted };
    }));

    return router;
}
