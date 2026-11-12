import express from 'express';
import { AUDIENCE_TYPES, NotificationHubError } from '../services/notificationHubService.js';

function sendError(res, error) {
    if (error instanceof NotificationHubError) return res.status(error.status).json({ error: error.message });
    console.error('Notification hub error:', error);
    return res.status(500).json({ error: error.message || 'Notification hub error' });
}

/**
 * Notification Hub API. Mount at `/api/notifications` behind `createRequireAdmin`.
 *
 *   GET  /series          the current series, how much of it is due, and the audiences this server supports
 *   POST /preview         { audience, withProgress? } -> who it reaches (tokens masked)
 *   POST /send            { audience, message, dryRun?, removeInvalidTokens? }
 *   POST /send-test       { message } -> the signed-in admin's own devices
 *   GET  /history         recent sends; DELETE /history/:id removes one
 *   GET|POST /templates, PUT|DELETE /templates/:id   saved message templates
 *
 * @param {() => { service: import('../services/notificationHubService.js').NotificationHubService|null, projectId: string|null, env: string }} getHub
 *   Called per request so an env switch is picked up.
 */
export function createNotificationRouter(getHub) {
    const router = express.Router();

    const handle = (handler) => async (req, res) => {
        const { service, projectId, env } = getHub();
        if (!service) return res.status(503).json({ error: 'Notifications are not available for the selected environment' });
        // An admin's own uid only exists in the project they signed in to.
        const actorUid = req.admin?.projectId === projectId ? req.admin.uid : null;
        try {
            return res.json(await handler(service, req, { actorUid, env, actor: req.admin?.email ?? req.admin?.uid ?? null }));
        } catch (error) {
            return sendError(res, error);
        }
    };

    // `audiences` lets the page notice a server started before a group was added.
    router.get('/series', handle(async (service) => ({ ...(await service.seriesStatus()), audiences: AUDIENCE_TYPES })));

    router.post('/preview', handle((service, req) => service.preview(req.body?.audience, { withProgress: req.body?.withProgress === true })));

    router.post('/send', handle(async (service, req, { env, actor }) => {
        const { audience, message, dryRun, removeInvalidTokens } = req.body ?? {};
        const result = await service.send({ audience, message, dryRun: dryRun === true, removeInvalidTokens: removeInvalidTokens === true }, { actor, env });
        console.log(`[notifications] ${actor ?? 'unknown'} ${result.dryRun ? 'dry-ran' : 'sent'} "${message?.title}" to ${result.label}: ${result.sent} ok, ${result.failed} failed (${env})`);
        return result;
    }));

    router.post('/send-test', handle(async (service, req, { actorUid, env, actor }) => {
        if (!actorUid) {
            throw new NotificationHubError(`Your admin account isn't in the ${env} project, so it has no devices there. Switch environment or send to a device token instead.`, 409);
        }
        const result = await service.send({ audience: { type: 'users', users: [{ uid: actorUid }] }, message: req.body?.message, record: false }, { actor, env });
        console.log(`[notifications] ${actor ?? 'unknown'} sent a test of "${req.body?.message?.title}" to their own devices (${env})`);
        return result;
    }));

    router.get('/history', handle((service, req) => service.history({ limit: req.query.limit })));

    router.delete('/history/:id', handle(async (service, req, { env, actor }) => {
        const result = await service.deleteHistory(req.params.id);
        console.log(`[notifications] ${actor ?? 'unknown'} deleted "${result.title}" (${req.params.id}) from the history (${env})`);
        return result;
    }));

    // Saved message templates.
    router.get('/templates', handle((service) => service.listTemplates()));

    router.post('/templates', handle(async (service, req, { env, actor }) => {
        const template = await service.createTemplate(req.body ?? {}, { actor });
        console.log(`[notifications] ${actor ?? 'unknown'} saved template "${template.name}" (${env})`);
        return template;
    }));

    router.put('/templates/:id', handle(async (service, req, { env, actor }) => {
        const template = await service.updateTemplate(req.params.id, req.body ?? {}, { actor });
        console.log(`[notifications] ${actor ?? 'unknown'} updated template "${template.name}" (${env})`);
        return template;
    }));

    router.delete('/templates/:id', handle(async (service, req, { env, actor }) => {
        const result = await service.deleteTemplate(req.params.id);
        console.log(`[notifications] ${actor ?? 'unknown'} deleted template "${result.name}" (${env})`);
        return result;
    }));

    return router;
}
