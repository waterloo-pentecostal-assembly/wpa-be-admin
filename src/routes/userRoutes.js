import express from 'express';
import { UserAdminError } from '../services/userAdminService.js';

// The admin check lives with the rest of the API's access control; kept
// exported here for existing imports.
export { createRequireAdmin } from './apiAuth.js';

function sendError(res, error) {
    if (error instanceof UserAdminError) return res.status(error.status).json({ error: error.message });
    console.error('User manager error:', error);
    return res.status(500).json({ error: error.message || 'User manager error' });
}

/**
 * User Manager API. Mount at `/api/users` behind `createRequireAdmin` (see apiAuth.js).
 * Works on the selected environment's users.
 *
 * @param {() => { service: import('../services/userAdminService.js').UserAdminService|null, projectId: string|null, env: string }} getUsers
 *   Called per request so an env switch is picked up.
 */
export function createUserRouter(getUsers) {
    const router = express.Router();

    const handle = (action, handler) => async (req, res) => {
        const { service, projectId, env } = getUsers();
        if (!service) return res.status(503).json({ error: 'User management is not available for the selected environment' });
        // An admin's own uid only exists in the project they signed in to.
        const actorUid = req.admin?.projectId === projectId ? req.admin.uid : null;
        try {
            const result = await handler(service, req, { actorUid, env });
            if (action) console.log(`[users] ${req.admin?.email ?? 'unknown'} ${action} ${req.params.uid ?? result?.user?.uid ?? ''} (${env})`);
            return res.status(result?.status ?? 200).json(result?.body ?? result);
        } catch (error) {
            return sendError(res, error);
        }
    };

    const flag = (value, name) => {
        if (typeof value !== 'boolean') throw new UserAdminError(`"${name}" must be true or false`);
        return value;
    };

    router.get('/', handle(null, async (service, req, { env }) => {
        const { q, filter, sort, page, pageSize, refresh } = req.query;
        return { ...(await service.search({ q, filter, sort, page, pageSize, refresh: refresh === '1' || refresh === 'true' })), env };
    }));

    router.post('/', handle('created user', async (service, req) => {
        const { email, firstName, lastName, password } = req.body ?? {};
        return { status: 201, body: await service.createUser({ email, firstName, lastName, password }) };
    }));

    router.get('/:uid', handle(null, async (service, req) => ({ user: await service.getUser(req.params.uid), emailSending: service.emailSending })));

    router.get('/:uid/devices/:deviceId/token', handle('copied a device push token of', async (service, req) =>
        service.getDeviceToken(req.params.uid, req.params.deviceId)));

    router.patch('/:uid/profile', handle('updated profile of', async (service, req) => {
        const { firstName, lastName, email } = req.body ?? {};
        return { user: await service.updateProfile(req.params.uid, { firstName, lastName, email }) };
    }));

    router.post('/:uid/profile', handle('created profile for', async (service, req) => {
        const { firstName, lastName } = req.body ?? {};
        return { status: 201, body: { user: await service.createProfile(req.params.uid, { firstName, lastName }) } };
    }));

    router.post('/:uid/disabled', handle('set disabled on', async (service, req, { actorUid }) =>
        service.setDisabled(req.params.uid, flag(req.body?.disabled, 'disabled'), { actorUid })));

    router.post('/:uid/revoke-sessions', handle('revoked sessions of', async (service, req) =>
        ({ user: await service.revokeSessions(req.params.uid) })));

    router.post('/:uid/password-reset-link', handle('generated a password reset link for', async (service, req) =>
        service.generatePasswordResetLink(req.params.uid)));

    router.post('/:uid/send-password-reset-email', handle('sent a password reset email to', async (service, req) =>
        service.sendPasswordResetEmail(req.params.uid)));

    router.post('/:uid/send-verification-email', handle('sent a verification email to', async (service, req) =>
        service.sendVerificationEmail(req.params.uid)));

    router.post('/:uid/verification-link', handle('generated a verification link for', async (service, req) =>
        service.generateVerificationLink(req.params.uid)));

    router.post('/:uid/email-verified', handle('set email verified on', async (service, req) =>
        ({ user: await service.setEmailVerified(req.params.uid, flag(req.body?.verified, 'verified')) })));

    router.post('/:uid/approved', handle('set approval on', async (service, req) =>
        ({ user: await service.setApproved(req.params.uid, flag(req.body?.approved, 'approved')) })));

    router.post('/:uid/admin', handle('set admin on', async (service, req, { actorUid }) =>
        service.setAdmin(req.params.uid, flag(req.body?.isAdmin, 'isAdmin'), { actorUid })));

    router.post('/:uid/clear-reports', handle('cleared reports of', async (service, req) =>
        ({ user: await service.clearReports(req.params.uid) })));

    router.delete('/:uid', handle('deleted user', async (service, req, { actorUid }) =>
        service.deleteUser(req.params.uid, { actorUid, confirm: req.body?.confirm, deleteData: req.body?.deleteData === true })));

    return router;
}
