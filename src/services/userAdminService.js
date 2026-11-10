// User administration for the admin console's User Manager page.
//
// A user of the app is two records that share a uid:
//   - the Firebase Authentication account (email, password/providers,
//     disabled, email verified, sign-in times), and
//   - the Firestore `users/{uid}` profile (first_name, last_name, is_admin,
//     is_verified, reports) with `devices` and `notification_settings`
//     subcollections.
// The two "verified" flags mean different things: the profile's is_verified
// is set when an admin approves the user, and the account's emailVerified
// when the user clicks the link in their verification email.
// This service presents them as one user and keeps them in step when an
// action touches both (email changes, deletion).
import crypto from 'node:crypto';
import { AuthEmailError } from './authEmailService.js';

/** FCM topics admins are subscribed to (see UserManagerService.subscribeAllAdminsToTopics). */
export const ADMIN_TOPICS = [
    'user_signup_notifications',
    'user_delete_request',
    'new_testimony_for_approval',
    'new_prayer_request_for_approval',
];

/** Collections holding a user's app activity, keyed by `user_id`. */
export const ACTIVITY_COLLECTIONS = ['completions', 'prayer_requests', 'testimonies'];

export const FILTERS = ['all', 'active', 'disabled', 'pending_approval', 'email_unverified', 'admins', 'reported', 'missing_profile', 'missing_account'];
export const SORTS = ['created_desc', 'created_asc', 'last_sign_in_desc', 'name_asc', 'email_asc'];

const MAX_PAGE_SIZE = 200;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class UserAdminError extends Error {
    constructor(message, status = 400) {
        super(message);
        this.name = 'UserAdminError';
        this.status = status;
    }
}

// Firebase Auth error codes that are the caller's fault, with their HTTP status.
const AUTH_ERROR_STATUS = {
    'auth/user-not-found': 404,
    'auth/email-already-exists': 409,
    'auth/invalid-email': 400,
    'auth/invalid-password': 400,
    'auth/invalid-uid': 400,
};

/** Converts Firebase Auth errors into UserAdminErrors; anything else is rethrown. */
function rethrowAuthError(error) {
    const status = AUTH_ERROR_STATUS[error?.code ?? error?.errorInfo?.code];
    if (status) throw new UserAdminError(error.message, status);
    throw error;
}

const isNotFound = (error) => (error?.code ?? error?.errorInfo?.code) === 'auth/user-not-found';

const toIso = (value) => {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

/**
 * Makes Firestore data JSON-safe: Timestamps become ISO strings, document
 * references their path, GeoPoints {latitude, longitude}.
 */
export function serializeFirestore(value) {
    if (value === null || value === undefined) return value ?? null;
    if (Array.isArray(value)) return value.map(serializeFirestore);
    if (typeof value !== 'object') return value;
    if (typeof value.toDate === 'function') return value.toDate().toISOString();
    if (value instanceof Date) return value.toISOString();
    if (typeof value.path === 'string' && value.firestore) return value.path;
    if (typeof value.latitude === 'number' && typeof value.longitude === 'number' && Object.keys(value).length <= 2) {
        return { latitude: value.latitude, longitude: value.longitude };
    }
    if (Buffer.isBuffer(value) || value instanceof Uint8Array) return `<${value.length} bytes>`;
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, serializeFirestore(v)]));
}

/** Shows enough of a push token to tell devices apart without exposing it. */
export function maskToken(token) {
    if (typeof token !== 'string' || !token) return null;
    return token.length <= 12 ? '••••' : `${token.slice(0, 6)}…${token.slice(-4)}`;
}

const PHOTO_KEY = /photo|image|avatar|picture|thumb/i;
const IMAGE_LOCATION = /^(gs|https?):\/\//i;

/**
 * The profile photo's storage locations (gs:// or https), found by field name
 * since profiles name them differently. A thumbnail field is preferred for
 * small sizes; `keys` lists the fields used so they aren't shown as text.
 * Falls back to the Auth account's photoURL (e.g. Google sign-in).
 */
export function findPhoto(profile, record = null) {
    const fields = Object.entries(profile ?? {})
        .filter(([key, value]) => PHOTO_KEY.test(key) && typeof value === 'string' && IMAGE_LOCATION.test(value));
    const isThumb = ([key]) => /thumb/i.test(key);
    const thumbnail = fields.find(isThumb)?.[1] ?? null;
    const full = fields.find((f) => !isThumb(f))?.[1] ?? null;
    const fallback = record?.photoURL ?? null;
    return {
        thumbnail: thumbnail ?? full ?? fallback,
        full: full ?? thumbnail ?? fallback,
        keys: fields.map(([key]) => key),
    };
}

/**
 * The Storage bucket and object path of a gs:// location or a Firebase
 * Storage download URL; null for anything else (e.g. a Google photo URL).
 */
export function storageObject(location) {
    if (typeof location !== 'string') return null;
    const gs = /^gs:\/\/([^/]+)\/(.+)$/.exec(location);
    if (gs) return { bucket: gs[1], path: gs[2] };
    const download = /^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/([^/]+)\/o\/([^?#]+)/.exec(location);
    if (download) return { bucket: download[1], path: decodeURIComponent(download[2]) };
    return null;
}

/**
 * Turns gs:// locations into signed https URLs the browser can load (valid
 * for an hour, reused for 50 minutes so the browser can cache the image).
 * https URLs pass through; anything that can't be signed becomes null.
 * @param {import('firebase-admin').storage.Storage|null} storage
 */
export function createImageSigner(storage, { now = () => Date.now() } = {}) {
    const cache = new Map(); // location -> { url, until }
    return async (location) => {
        if (!location) return null;
        if (/^https?:\/\//i.test(location)) return location;
        const match = /^gs:\/\/([^/]+)\/(.+)$/.exec(location);
        if (!match || !storage) return null;
        const hit = cache.get(location);
        if (hit && hit.until > now()) return hit.url;
        try {
            const [url] = await storage.bucket(match[1]).file(match[2]).getSignedUrl({ action: 'read', expires: now() + 60 * 60 * 1000 });
            cache.set(location, { url, until: now() + 50 * 60 * 1000 });
            return url;
        } catch (error) {
            console.error(`Could not sign ${location}:`, error.message);
            return null;
        }
    };
}

/**
 * One row of the user directory, from the Auth account and/or profile.
 * @param {import('firebase-admin').auth.UserRecord|null} record
 * @param {Record<string, any>|null} profile Firestore `users/{uid}` data
 */
export function summarizeUser(uid, record, profile) {
    const firstName = profile?.first_name ?? '';
    const lastName = profile?.last_name ?? '';
    const name = `${firstName} ${lastName}`.trim() || record?.displayName || '';
    return {
        uid,
        email: record?.email ?? profile?.email ?? null,
        name,
        firstName,
        lastName,
        phoneNumber: record?.phoneNumber ?? null,
        providers: record ? (record.providerData ?? []).map((p) => p.providerId) : [],
        hasAccount: !!record,
        hasProfile: !!profile,
        disabled: !!record?.disabled,
        emailVerified: !!record?.emailVerified,
        // Profile is_verified: an admin has approved the user.
        isVerified: !!profile?.is_verified,
        isAdmin: profile?.is_admin === true,
        reports: Number(profile?.reports) || 0,
        createdAt: toIso(record?.metadata?.creationTime),
        lastSignInAt: toIso(record?.metadata?.lastSignInTime),
        lastActiveAt: toIso(record?.metadata?.lastRefreshTime),
        // The profile's email is what the admin console's login check looks
        // users up by, so a mismatch is worth surfacing.
        emailMismatch: !!(record?.email && profile?.email && record.email.toLowerCase() !== String(profile.email).toLowerCase()),
        // Storage locations; replaced by signed URLs (photoUrl) before they are sent.
        photo: findPhoto(profile, record),
    };
}

export function matchesFilter(user, filter) {
    switch (filter) {
        // Active: can sign in and has clicked their email verification link.
        case 'active': return user.hasAccount && !user.disabled && user.emailVerified;
        case 'disabled': return user.disabled;
        case 'pending_approval': return user.hasProfile && !user.isVerified;
        case 'email_unverified': return user.hasAccount && !user.emailVerified;
        case 'admins': return user.isAdmin;
        case 'reported': return user.reports > 0;
        case 'missing_profile': return user.hasAccount && !user.hasProfile;
        case 'missing_account': return !user.hasAccount;
        default: return true;
    }
}

/** Every whitespace-separated term must appear in the user's email, name, uid or phone. */
export function matchesQuery(user, query) {
    const terms = String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return true;
    const haystack = [user.email, user.name, user.firstName, user.lastName, user.uid, user.phoneNumber]
        .filter(Boolean).join(' ').toLowerCase();
    return terms.every((term) => haystack.includes(term));
}

const byString = (key) => (a, b) => (a[key] || '￿').localeCompare(b[key] || '￿', undefined, { sensitivity: 'base' });
const byDateDesc = (key) => (a, b) => (b[key] || '').localeCompare(a[key] || '');
const SORTERS = {
    created_desc: byDateDesc('createdAt'),
    created_asc: (a, b) => (a.createdAt || '￿').localeCompare(b.createdAt || '￿'),
    last_sign_in_desc: byDateDesc('lastSignInAt'),
    name_asc: byString('name'),
    email_asc: byString('email'),
};

/**
 * Filters, searches, sorts and pages directory rows. An exact email or uid
 * match is always listed first.
 */
export function queryDirectory(users, { q = '', filter = 'all', sort = 'created_desc', page = 1, pageSize = 50 } = {}) {
    if (!FILTERS.includes(filter)) throw new UserAdminError(`Unknown filter "${filter}"`);
    if (!SORTS.includes(sort)) throw new UserAdminError(`Unknown sort "${sort}"`);
    const size = Math.min(Math.max(1, Number(pageSize) || 50), MAX_PAGE_SIZE);

    const searched = users.filter((u) => matchesQuery(u, q));
    const counts = Object.fromEntries(FILTERS.map((f) => [f, searched.filter((u) => matchesFilter(u, f)).length]));

    const needle = String(q).trim().toLowerCase();
    const exact = (u) => (needle && (u.uid.toLowerCase() === needle || u.email?.toLowerCase() === needle) ? 0 : 1);
    const sorter = SORTERS[sort];
    const matches = searched.filter((u) => matchesFilter(u, filter)).sort((a, b) => exact(a) - exact(b) || sorter(a, b));

    const pageCount = Math.max(1, Math.ceil(matches.length / size));
    const current = Math.min(Math.max(1, Number(page) || 1), pageCount);
    return {
        users: matches.slice((current - 1) * size, current * size),
        total: matches.length,
        page: current,
        pageSize: size,
        pageCount,
        counts,
    };
}

export class UserAdminService {
    /**
     * @param {import('firebase-admin').firestore.Firestore} firestore
     * @param {import('firebase-admin').auth.Auth} auth
     * @param {import('firebase-admin').messaging.Messaging|null} messaging
     * @param {{ cacheTtlMs?: number, now?: () => number, signImage?: (location: string) => Promise<string|null>,
     *   emailSender?: ReturnType<typeof import('./authEmailService.js').createAuthEmailSender>|null, emailSetupHint?: string }} [options]
     *   `signImage` makes photo locations loadable (see createImageSigner); by default only https photos show.
     *   `emailSender` sends Firebase's own emails; without it only links can be generated, and
     *   `emailSetupHint` says what to configure.
     */
    constructor(firestore, auth, messaging, {
        cacheTtlMs = 60_000, now = () => Date.now(), signImage = createImageSigner(null), emailSender = null, emailSetupHint = '',
        storage = null,
    } = {}) {
        /** Firebase Storage, for deleting profile photos with the user's data. */
        this.storage = storage;
        this.firestore = firestore;
        this.auth = auth;
        this.messaging = messaging;
        this.cacheTtlMs = cacheTtlMs;
        this.now = now;
        this.signImage = signImage;
        this.emailSender = emailSender;
        this.emailSetupHint = emailSetupHint;
        /** @type {{ loadedAt: number, users: Map<string, ReturnType<typeof summarizeUser>> }|null} */
        this.directory = null;
        this.loading = null;
    }

    users() {
        return this.firestore.collection('users');
    }

    // ---------- Directory ----------

    /** Every Auth account and profile, merged by uid. Cached for `cacheTtlMs`. */
    async loadDirectory({ refresh = false } = {}) {
        const fresh = this.directory && this.now() - this.directory.loadedAt < this.cacheTtlMs;
        if (fresh && !refresh) return this.directory;
        if (!this.loading) {
            this.loading = this.fetchDirectory()
                .then((directory) => (this.directory = directory))
                .finally(() => { this.loading = null; });
        }
        return this.loading;
    }

    async fetchDirectory() {
        const records = new Map();
        const listAccounts = async () => {
            let pageToken;
            do {
                const result = await this.auth.listUsers(1000, pageToken);
                for (const record of result.users) records.set(record.uid, record);
                pageToken = result.pageToken;
            } while (pageToken);
        };
        const [, profileSnapshot] = await Promise.all([listAccounts(), this.users().get()]);

        const profiles = new Map(profileSnapshot.docs.map((doc) => [doc.id, doc.data()]));
        const users = new Map();
        for (const uid of new Set([...records.keys(), ...profiles.keys()])) {
            users.set(uid, summarizeUser(uid, records.get(uid) ?? null, profiles.get(uid) ?? null));
        }
        return { loadedAt: this.now(), users };
    }

    async search(params = {}) {
        const directory = await this.loadDirectory({ refresh: !!params.refresh });
        const result = queryDirectory([...directory.users.values()], params);
        return {
            ...result,
            users: await Promise.all(result.users.map((user) => this.withPhotoUrls(user))),
            loadedAt: new Date(directory.loadedAt).toISOString(),
        };
    }

    /** Swaps a summary's photo locations for URLs: photoUrl (thumbnail) and photoFullUrl. */
    async withPhotoUrls({ photo, ...user }) {
        const [photoUrl, photoFullUrl] = await Promise.all([
            this.signImage(photo?.thumbnail),
            photo?.full === photo?.thumbnail ? null : this.signImage(photo?.full),
        ]);
        return { ...user, photoUrl, photoFullUrl: photoFullUrl ?? photoUrl, photoFields: photo?.keys ?? [] };
    }

    // ---------- One user ----------

    async getRecord(uid) {
        try {
            return await this.auth.getUser(uid);
        } catch (error) {
            if (isNotFound(error)) return null;
            return rethrowAuthError(error);
        }
    }

    async getProfile(uid) {
        const snapshot = await this.users().doc(uid).get();
        return snapshot.exists ? snapshot.data() : null;
    }

    /** Auth account and profile, or a 404 if the user has neither. */
    async requireUser(uid) {
        if (typeof uid !== 'string' || !uid.trim()) throw new UserAdminError('A user ID is required');
        const [record, profile] = await Promise.all([this.getRecord(uid), this.getProfile(uid)]);
        if (!record && !profile) throw new UserAdminError(`No user with ID ${uid}`, 404);
        return { record, profile };
    }

    /** Re-reads one user into the cached directory after a change. */
    updateDirectory(uid, record, profile) {
        if (!this.directory) return;
        if (record || profile) this.directory.users.set(uid, summarizeUser(uid, record, profile));
        else this.directory.users.delete(uid);
    }

    async countActivity(uid) {
        const entries = await Promise.all(ACTIVITY_COLLECTIONS.map(async (name) => {
            try {
                const snapshot = await this.firestore.collection(name).where('user_id', '==', uid).count().get();
                return [name, snapshot.data().count];
            } catch (error) {
                console.error(`Could not count ${name} for ${uid}:`, error.message);
                return [name, null];
            }
        }));
        return Object.fromEntries(entries);
    }

    async listDevices(uid) {
        const snapshot = await this.users().doc(uid).collection('devices').get();
        return snapshot.docs.map((doc) => {
            const { token, ...rest } = doc.data();
            return { id: doc.id, token: maskToken(token), hasToken: !!token, ...serializeFirestore(rest) };
        });
    }

    /** One device's full push (FCM) token, which listings only show masked. */
    async getDeviceToken(uid, deviceId) {
        if (typeof deviceId !== 'string' || !deviceId.trim()) throw new UserAdminError('A device ID is required');
        const snapshot = await this.users().doc(uid).collection('devices').doc(deviceId).get();
        if (!snapshot.exists) throw new UserAdminError(`No device ${deviceId} for this user`, 404);
        const token = snapshot.data().token;
        if (!token) throw new UserAdminError('This device has no push token', 404);
        return { token };
    }

    async deviceTokens(uid) {
        const snapshot = await this.users().doc(uid).collection('devices').get();
        return snapshot.docs.map((doc) => doc.data().token).filter(Boolean);
    }

    async getNotificationSettings(uid) {
        const snapshot = await this.users().doc(uid).collection('notification_settings').limit(1).get();
        if (snapshot.empty) return null;
        const doc = snapshot.docs[0];
        return { id: doc.id, ...serializeFirestore(doc.data()) };
    }

    /** Everything the User Manager shows about one user. */
    async getUser(uid) {
        const { record, profile } = await this.requireUser(uid);
        this.updateDirectory(uid, record, profile);
        const [activity, devices, notificationSettings] = await Promise.all([
            this.countActivity(uid),
            profile ? this.listDevices(uid) : [],
            profile ? this.getNotificationSettings(uid) : null,
        ]);
        return {
            ...(await this.withPhotoUrls(summarizeUser(uid, record, profile))),
            account: record && {
                displayName: record.displayName ?? null,
                photoURL: record.photoURL ?? null,
                providers: (record.providerData ?? []).map((p) => ({ providerId: p.providerId, email: p.email ?? null })),
                tokensValidAfter: toIso(record.tokensValidAfterTime),
                customClaims: record.customClaims ?? null,
                multiFactor: (record.multiFactor?.enrolledFactors ?? []).length,
            },
            profile: profile && serializeFirestore(profile),
            activity,
            devices,
            notificationSettings,
        };
    }

    // ---------- Actions ----------

    async updateProfile(uid, { firstName, lastName, email } = {}) {
        const { record, profile } = await this.requireUser(uid);
        const patch = {};
        if (firstName !== undefined) patch.first_name = String(firstName).trim();
        if (lastName !== undefined) patch.last_name = String(lastName).trim();

        if (email !== undefined) {
            const next = String(email).trim().toLowerCase();
            if (!EMAIL_PATTERN.test(next)) throw new UserAdminError('Enter a valid email address');
            if (record && next !== record.email?.toLowerCase()) {
                // A new address hasn't been verified. Admin approval (is_verified) is kept.
                await this.auth.updateUser(uid, { email: next, emailVerified: false }).catch(rethrowAuthError);
            }
            patch.email = next;
        }
        if (profile && Object.keys(patch).length) await this.users().doc(uid).update(patch);
        return this.getUser(uid);
    }

    /** Creates the Firestore profile for an Auth account that has none. */
    async createProfile(uid, { firstName = '', lastName = '' } = {}) {
        const { record, profile } = await this.requireUser(uid);
        if (profile) throw new UserAdminError('This user already has a profile', 409);
        await this.users().doc(uid).set({
            email: record.email ?? null,
            first_name: String(firstName).trim(),
            last_name: String(lastName).trim(),
            // Approval is a separate admin decision, made from the panel.
            is_verified: false,
            is_admin: false,
            reports: 0,
        });
        return this.getUser(uid);
    }

    /**
     * Deactivates (or reactivates) the Auth account. Deactivating also ends
     * the user's sessions and, for admins, stops their devices getting admin
     * notifications; reactivating an admin subscribes them again.
     */
    async setDisabled(uid, disabled, { actorUid } = {}) {
        if (disabled && uid === actorUid) throw new UserAdminError('You cannot deactivate your own account');
        const { record, profile } = await this.requireUser(uid);
        if (!record) throw new UserAdminError('This user has no Firebase Authentication account', 409);
        await this.auth.updateUser(uid, { disabled: !!disabled }).catch(rethrowAuthError);
        if (disabled) await this.auth.revokeRefreshTokens(uid);
        const topics = profile?.is_admin === true ? await this.syncAdminTopics(uid, !disabled) : null;
        return { user: await this.getUser(uid), topics };
    }

    /** Signs the user out of every device (their refresh tokens stop working). */
    async revokeSessions(uid) {
        const { record } = await this.requireUser(uid);
        if (!record) throw new UserAdminError('This user has no Firebase Authentication account', 409);
        await this.auth.revokeRefreshTokens(uid);
        return this.getUser(uid);
    }

    async requireEmailAccount(uid) {
        const { record } = await this.requireUser(uid);
        if (!record) throw new UserAdminError('This user has no Firebase Authentication account', 409);
        if (!record.email) throw new UserAdminError('This account has no email address');
        return record;
    }

    /** A link that lets the user choose a new password. It is not emailed; the admin passes it on. */
    async generatePasswordResetLink(uid) {
        const record = await this.requireEmailAccount(uid);
        const link = await this.auth.generatePasswordResetLink(record.email).catch(rethrowAuthError);
        const hasPassword = (record.providerData ?? []).some((p) => p.providerId === 'password');
        return { link, email: record.email, hasPassword };
    }

    async generateVerificationLink(uid) {
        const record = await this.requireEmailAccount(uid);
        const link = await this.auth.generateEmailVerificationLink(record.email).catch(rethrowAuthError);
        return { link, email: record.email };
    }

    /** Whether Firebase can be asked to send emails, and if not, why. */
    get emailSending() {
        return this.emailSender
            ? { available: true }
            : { available: false, reason: `Sending emails isn't set up for this environment. ${this.emailSetupHint}`.trim() };
    }

    async sendEmail(send) {
        if (!this.emailSender) throw new UserAdminError(this.emailSending.reason, 503);
        try {
            await send(this.emailSender);
        } catch (error) {
            if (error instanceof AuthEmailError) throw new UserAdminError(error.message, error.status);
            throw error;
        }
    }

    /** Has Firebase email the user its password reset email (the console's template). */
    async sendPasswordResetEmail(uid) {
        const record = await this.requireEmailAccount(uid);
        if (record.disabled) throw new UserAdminError('This account is deactivated; reactivate it before sending emails', 409);
        await this.sendEmail((sender) => sender.sendPasswordResetEmail(record.email));
        return { email: record.email };
    }

    /** Has Firebase email the user its verification email (the console's template). */
    async sendVerificationEmail(uid) {
        const record = await this.requireEmailAccount(uid);
        if (record.emailVerified) throw new UserAdminError('This email is already verified', 409);
        if (record.disabled) throw new UserAdminError('This account is deactivated; reactivate it before sending emails', 409);
        await this.sendEmail((sender) => sender.sendVerificationEmail(uid));
        return { email: record.email };
    }

    /** Sets the Auth account's emailVerified (as if the user had clicked the link). */
    async setEmailVerified(uid, verified) {
        const { record } = await this.requireUser(uid);
        if (!record) throw new UserAdminError('This user has no sign-in account', 409);
        await this.auth.updateUser(uid, { emailVerified: !!verified }).catch(rethrowAuthError);
        return this.getUser(uid);
    }

    /** Approves (or revokes approval of) the user: the profile's is_verified. */
    async setApproved(uid, approved) {
        const { profile } = await this.requireUser(uid);
        if (!profile) throw new UserAdminError('This user has no profile; create one first', 409);
        await this.users().doc(uid).update({ is_verified: !!approved });
        return this.getUser(uid);
    }

    /** Grants or revokes admin (profile is_admin) and (un)subscribes the user's devices to admin topics. */
    async setAdmin(uid, isAdmin, { actorUid } = {}) {
        if (!isAdmin && uid === actorUid) throw new UserAdminError('You cannot remove your own admin access');
        const { record, profile } = await this.requireUser(uid);
        if (!profile) throw new UserAdminError('This user has no profile; create one first', 409);
        await this.users().doc(uid).update({ is_admin: !!isAdmin });
        // Disabled admins stay unsubscribed until they are reactivated.
        const topics = await this.syncAdminTopics(uid, !!isAdmin && !record?.disabled);
        return { user: await this.getUser(uid), topics };
    }

    async clearReports(uid) {
        const { profile } = await this.requireUser(uid);
        if (!profile) throw new UserAdminError('This user has no profile', 409);
        await this.users().doc(uid).update({ reports: 0 });
        return this.getUser(uid);
    }

    /**
     * (Un)subscribes the user's device tokens to the admin topics. Failures
     * are reported, not thrown: the admin change itself has already been made.
     */
    async syncAdminTopics(uid, subscribe) {
        const tokens = await this.deviceTokens(uid);
        const result = { subscribed: subscribe, tokens: tokens.length, failures: 0, errors: [] };
        if (!tokens.length) return result;
        if (!this.messaging) {
            result.errors.push('Messaging is not available');
            return result;
        }
        for (const topic of ADMIN_TOPICS) {
            try {
                const response = subscribe
                    ? await this.messaging.subscribeToTopic(tokens, topic)
                    : await this.messaging.unsubscribeFromTopic(tokens, topic);
                result.failures += response.failureCount;
            } catch (error) {
                result.failures += tokens.length;
                result.errors.push(`${topic}: ${error.message}`);
            }
        }
        return result;
    }

    /**
     * Creates a verified account and profile. Without a password a random one
     * is set and a password reset link is returned for the user to choose one.
     */
    async createUser({ email, firstName = '', lastName = '', password } = {}) {
        const address = String(email ?? '').trim().toLowerCase();
        if (!EMAIL_PATTERN.test(address)) throw new UserAdminError('Enter a valid email address');
        if (password && String(password).length < 6) throw new UserAdminError('Passwords must be at least 6 characters');

        const record = await this.auth.createUser({
            email: address,
            password: password || crypto.randomBytes(24).toString('base64url'),
            emailVerified: true,
        }).catch(rethrowAuthError);

        try {
            await this.users().doc(record.uid).set({
                email: address,
                first_name: String(firstName).trim(),
                last_name: String(lastName).trim(),
                is_verified: true,
                is_admin: false,
                reports: 0,
            });
        } catch (error) {
            // Don't leave an account without a profile behind.
            await this.auth.deleteUser(record.uid).catch(() => {});
            throw error;
        }

        const resetLink = password ? null : await this.auth.generatePasswordResetLink(address);
        return { user: await this.getUser(record.uid), resetLink };
    }

    /**
     * Deletes everything the user created: their documents in the activity
     * collections (with any subcollections) and profile photos kept in
     * Firebase Storage. Returns how many of each were deleted.
     */
    async deleteUserData(uid, profile) {
        const deleted = {};
        for (const name of ACTIVITY_COLLECTIONS) {
            const snapshot = await this.firestore.collection(name).where('user_id', '==', uid).get();
            for (const doc of snapshot.docs) await this.firestore.recursiveDelete(this.firestore.collection(name).doc(doc.id));
            deleted[name] = snapshot.docs.length;
        }
        const photos = [...new Set(findPhoto(profile).keys.map((key) => profile[key]))].map(storageObject).filter(Boolean);
        deleted.photos = 0;
        if (photos.length && !this.storage) console.warn(`Not deleting ${photos.length} photo(s) of ${uid}: no Storage access`);
        for (const { bucket, path } of this.storage ? photos : []) {
            try {
                await this.storage.bucket(bucket).file(path).delete({ ignoreNotFound: true });
                deleted.photos += 1;
            } catch (error) {
                console.error(`Could not delete gs://${bucket}/${path} of ${uid}:`, error.message);
            }
        }
        return deleted;
    }

    /**
     * Deletes the Auth account and the profile (with its devices and
     * notification settings). Content the user posted is kept unless
     * `deleteData` is set, in which case it is deleted first (so a failure
     * leaves the account in place to retry). `confirm` must match the user's
     * email (or uid if they have none).
     */
    async deleteUser(uid, { actorUid, confirm, deleteData = false } = {}) {
        if (uid === actorUid) throw new UserAdminError('You cannot delete your own account');
        const { record, profile } = await this.requireUser(uid);
        const expected = record?.email ?? profile?.email ?? uid;
        if (String(confirm ?? '').trim().toLowerCase() !== String(expected).toLowerCase()) {
            throw new UserAdminError(`Type ${expected} to confirm`);
        }
        const deletedData = deleteData ? await this.deleteUserData(uid, profile) : null;
        const topics = profile?.is_admin === true ? await this.syncAdminTopics(uid, false) : null;
        if (record) await this.auth.deleteUser(uid).catch((error) => (isNotFound(error) ? null : rethrowAuthError(error)));
        if (profile) await this.firestore.recursiveDelete(this.users().doc(uid));
        this.updateDirectory(uid, null, null);
        return { deleted: uid, topics, deletedData };
    }
}
