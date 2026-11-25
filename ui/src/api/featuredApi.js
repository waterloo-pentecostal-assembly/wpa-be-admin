// Client for the featured content endpoints (src/routes/featuredRoutes.js).
// Every request carries the signed-in admin's ID token.
import { authed } from './usersApi';

const BASE = '/api/featured';

/** { env, maxConcurrent, types, items: [{ id, type, ...fields, start, end, status }] }, latest first. */
export const listFeatured = () => authed(BASE);

/**
 * Adds (no `id`) or replaces a featured item. `item`: { type, start, end, ...the type's fields }
 * with days as YYYY-MM-DD; `env` is the environment the page shows (the server refuses if it switched).
 */
export const saveFeatured = (id, item, env) => (id
    ? authed(`${BASE}/${encodeURIComponent(id)}`, { method: 'PUT', json: { ...item, env } })
    : authed(BASE, { method: 'POST', json: { ...item, env } }));

export const deleteFeatured = (id, env) => authed(`${BASE}/${encodeURIComponent(id)}`, { method: 'DELETE', json: { env } });
