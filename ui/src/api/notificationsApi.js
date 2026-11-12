// Client for the Notification Hub endpoints (src/routes/notificationRoutes.js).
// Like the User Manager, every request carries the signed-in admin's ID token.
import { authed } from './usersApi';

/** { series: { id, title, today, startDate, endDate, totalEntries, dueEntries, dueIncludingToday } | null } */
export const getSeriesStatus = () => authed('/api/notifications/series');
/** { audience, label, series, userCount, deviceCount, skipped, users, truncated, tokens? } */
/** withProgress: include users' series progress (a read per user; progress audiences always include it). */
export const previewAudience = (audience, { withProgress = false } = {}) =>
    authed('/api/notifications/preview', { method: 'POST', json: { audience, withProgress } });
/** { sent, failed, errors, invalidTokens, removedDevices, label, userCount, deviceCount, dryRun, ... } */
export const sendNotification = ({ audience, message, dryRun = false, removeInvalidTokens = false }) =>
    authed('/api/notifications/send', { method: 'POST', json: { audience, message, dryRun, removeInvalidTokens } });
/** Sends the message to the signed-in admin's own devices. */
export const sendTestToMe = (message) => authed('/api/notifications/send-test', { method: 'POST', json: { message } });
export const getHistory = () => authed('/api/notifications/history');
/** Removes one send from the history. { deleted, title } */
export const deleteHistoryItem = (id) => authed(`/api/notifications/history/${encodeURIComponent(id)}`, { method: 'DELETE' });

// ---------- Saved message templates ----------
/** [{ id, name, title, body, data, audience, createdAt, createdBy, updatedAt, updatedBy }] */
export const listTemplates = () => authed('/api/notifications/templates');
/** `audience` is a group audience to save with it, or null. */
export const createTemplate = ({ name, message, audience = null }) =>
    authed('/api/notifications/templates', { method: 'POST', json: { name, message, audience } });
/** Only the given fields change; `audience: null` removes a saved audience. */
export const updateTemplate = (id, fields) => authed(`/api/notifications/templates/${encodeURIComponent(id)}`, { method: 'PUT', json: fields });
export const deleteTemplate = (id) => authed(`/api/notifications/templates/${encodeURIComponent(id)}`, { method: 'DELETE' });
