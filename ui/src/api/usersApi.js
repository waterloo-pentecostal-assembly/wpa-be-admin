// Client for the User Manager endpoints (src/routes/userRoutes.js). Every
// request carries the signed-in admin's Firebase ID token (request() adds it).
import { request } from './seriesBuilderApi';

/** Kept for existing imports: every API call is authenticated now. */
export const authed = request;

const userUrl = (uid, action = '') => `/api/users/${encodeURIComponent(uid)}${action}`;
const post = (url, json = {}) => authed(url, { method: 'POST', json });

/** { users, total, page, pageSize, pageCount, counts, loadedAt, env } */
export function searchUsers({ q = '', filter = 'all', sort = 'created_desc', page = 1, refresh = false } = {}) {
    const params = new URLSearchParams({ q, filter, sort, page: String(page) });
    if (refresh) params.set('refresh', '1');
    return authed(`/api/users?${params}`);
}

/** { user, emailSending: { available, reason? } } */
export const getUser = (uid) => authed(userUrl(uid));
/** A device's full push token (the user shows it masked). { token } */
export const getDeviceToken = (uid, deviceId) => authed(userUrl(uid, `/devices/${encodeURIComponent(deviceId)}/token`));
/** { user, resetLink } — resetLink is set when no password was given. */
export const createUser = (fields) => post('/api/users', fields);
export const updateProfile = (uid, fields) => authed(userUrl(uid, '/profile'), { method: 'PATCH', json: fields });
export const createProfile = (uid, fields) => post(userUrl(uid, '/profile'), fields);
/** { user, topics } */
export const setDisabled = (uid, disabled) => post(userUrl(uid, '/disabled'), { disabled });
export const revokeSessions = (uid) => post(userUrl(uid, '/revoke-sessions'));
/** Firebase emails the user its password reset email. { email } */
export const sendPasswordResetEmail = (uid) => post(userUrl(uid, '/send-password-reset-email'));
/** Firebase emails the user its verification email. { email } */
export const sendVerificationEmail = (uid) => post(userUrl(uid, '/send-verification-email'));
/** { link, email, hasPassword } */
export const generatePasswordResetLink = (uid) => post(userUrl(uid, '/password-reset-link'));
/** { link, email } */
export const generateVerificationLink = (uid) => post(userUrl(uid, '/verification-link'));
export const setEmailVerified = (uid, verified) => post(userUrl(uid, '/email-verified'), { verified });
/** Sets the profile's is_verified (admin approval). */
export const setApproved = (uid, approved) => post(userUrl(uid, '/approved'), { approved });
/** { user, topics } */
export const setAdmin = (uid, isAdmin) => post(userUrl(uid, '/admin'), { isAdmin });
export const clearReports = (uid) => post(userUrl(uid, '/clear-reports'));
/** `confirm` is the user's email (or uid if they have none). */
/** Deletes the account and profile; with deleteData, also everything they posted. */
export const deleteUser = (uid, confirm, { deleteData = false } = {}) => authed(userUrl(uid), { method: 'DELETE', json: { confirm, deleteData } });
