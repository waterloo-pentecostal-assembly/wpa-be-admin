// Client for the Maintenance endpoints (src/routes/maintenanceRoutes.js).
// Every request carries the signed-in admin's ID token.
import { authed } from './usersApi';

/** { env, before, cutoff, kinds: { prayer_requests: { label, older, total }, testimonies: {...} } } */
export const countOldContent = (before) => authed(`/api/maintenance/old-content?${new URLSearchParams({ before })}`);

/**
 * Deletes content dated before `before` (YYYY-MM-DD, app time zone) in `kinds`.
 * `env` is the environment the counts were for; the server refuses if it has switched.
 * { env, before, cutoff, deleted: { prayer_requests: n, ... } }
 */
export const deleteOldContent = ({ before, kinds, env }) =>
    authed('/api/maintenance/old-content/delete', { method: 'POST', json: { before, kinds, env } });
