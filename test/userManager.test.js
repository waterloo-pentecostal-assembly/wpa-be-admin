import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {
    ADMIN_TOPICS, UserAdminError, UserAdminService, createImageSigner, findPhoto, maskToken, queryDirectory, serializeFirestore, summarizeUser,
} from '../src/services/userAdminService.js';
import { createRequireAdmin, createUserRouter } from '../src/routes/userRoutes.js';
import { AuthEmailError, createAuthEmailSender } from '../src/services/authEmailService.js';

// ---------- In-memory stand-ins for the Firebase Admin APIs used ----------

/** Firestore keyed by document path ("users/u1", "users/u1/devices/d1"). */
function fakeFirestore(initial = {}) {
    const docs = new Map(Object.entries(initial).map(([path, data]) => [path, { ...data }]));
    const snapshot = (path) => ({
        id: path.split('/').pop(),
        exists: docs.has(path),
        data: () => (docs.has(path) ? { ...docs.get(path) } : undefined),
    });
    const docRef = (path) => ({
        id: path.split('/').pop(),
        path,
        get: async () => snapshot(path),
        set: async (data) => { docs.set(path, { ...data }); },
        update: async (patch) => {
            if (!docs.has(path)) throw new Error(`NOT_FOUND: ${path}`);
            docs.set(path, { ...docs.get(path), ...patch });
        },
        collection: (name) => collectionRef(`${path}/${name}`),
    });
    const childPaths = (prefix) => [...docs.keys()].filter((p) => p.startsWith(`${prefix}/`) && !p.slice(prefix.length + 1).includes('/'));
    const query = (prefix, predicates = [], limit = Infinity) => {
        const run = () => childPaths(prefix)
            .filter((p) => predicates.every(([field, value]) => docs.get(p)[field] === value))
            .slice(0, limit);
        return {
            where: (field, op, value) => query(prefix, [...predicates, [field, value]], limit),
            limit: (n) => query(prefix, predicates, n),
            select: () => query(prefix, predicates, limit),
            count: () => ({ get: async () => ({ data: () => ({ count: run().length }) }) }),
            get: async () => {
                const list = run().map(snapshot);
                return { docs: list, empty: list.length === 0, size: list.length };
            },
        };
    };
    const collectionRef = (prefix) => ({ ...query(prefix), doc: (id) => docRef(`${prefix}/${id}`) });
    return {
        docs,
        collection: (name) => collectionRef(name),
        recursiveDelete: async (ref) => {
            for (const path of [...docs.keys()]) if (path === ref.path || path.startsWith(`${ref.path}/`)) docs.delete(path);
        },
    };
}

function authError(code) {
    return Object.assign(new Error(code), { code });
}

function fakeAuth(records = []) {
    const users = new Map(records.map((r) => [r.uid, record(r)]));
    const calls = [];
    let counter = 0;
    function record({ uid, email = null, disabled = false, emailVerified = false, providers = ['password'], created = '2025-01-01T00:00:00Z', lastSignIn = null, displayName = null }) {
        return {
            uid, email, disabled, emailVerified, displayName, phoneNumber: null,
            providerData: providers.map((providerId) => ({ providerId, email })),
            metadata: { creationTime: new Date(created).toUTCString(), lastSignInTime: lastSignIn && new Date(lastSignIn).toUTCString(), lastRefreshTime: null },
        };
    }
    const require = (uid) => {
        if (!users.has(uid)) throw authError('auth/user-not-found');
        return users.get(uid);
    };
    return {
        users,
        calls,
        listUsers: async (max, pageToken) => {
            const all = [...users.values()];
            const start = pageToken ? Number(pageToken) : 0;
            const page = all.slice(start, start + 2); // tiny pages to exercise paging
            return { users: page, pageToken: start + 2 < all.length ? String(start + 2) : undefined };
        },
        getUser: async (uid) => require(uid),
        updateUser: async (uid, patch) => {
            const current = require(uid);
            if (patch.email && [...users.values()].some((u) => u.uid !== uid && u.email === patch.email)) throw authError('auth/email-already-exists');
            calls.push(['updateUser', uid, patch]);
            const next = { ...current, ...patch };
            delete next.password;
            users.set(uid, next);
            return next;
        },
        createUser: async ({ email, password, emailVerified }) => {
            if ([...users.values()].some((u) => u.email === email)) throw authError('auth/email-already-exists');
            calls.push(['createUser', email, password]);
            const created = record({ uid: `new${++counter}`, email, emailVerified });
            users.set(created.uid, created);
            return created;
        },
        deleteUser: async (uid) => {
            require(uid);
            calls.push(['deleteUser', uid]);
            users.delete(uid);
        },
        createCustomToken: async (uid) => { require(uid); return `custom-${uid}`; },
        revokeRefreshTokens: async (uid) => { require(uid); calls.push(['revokeRefreshTokens', uid]); },
        generatePasswordResetLink: async (email) => `https://reset.example/?email=${email}`,
        generateEmailVerificationLink: async (email) => `https://verify.example/?email=${email}`,
        verifyIdToken: async (token) => {
            const [, uid] = /^token-(.+)$/.exec(token.split('.')[2] ?? '') ?? [];
            if (!uid || !users.has(uid) || users.get(uid).disabled) throw authError('auth/id-token-revoked');
            return { uid, email: users.get(uid).email };
        },
    };
}

function fakeMessaging() {
    const calls = [];
    return {
        calls,
        subscribeToTopic: async (tokens, topic) => { calls.push(['subscribe', topic, tokens]); return { failureCount: 0 }; },
        unsubscribeFromTopic: async (tokens, topic) => { calls.push(['unsubscribe', topic, tokens]); return { failureCount: 0 }; },
    };
}

function fixtures() {
    const auth = fakeAuth([
        { uid: 'admin1', email: 'admin@wpa.church', emailVerified: true, created: '2024-01-01T00:00:00Z', lastSignIn: '2026-11-01T00:00:00Z' },
        { uid: 'u1', email: 'mary.jones@example.com', emailVerified: true, created: '2025-06-01T00:00:00Z' },
        { uid: 'u2', email: 'pat@example.com', created: '2025-07-01T00:00:00Z' },
        { uid: 'u3', email: 'nodoc@example.com', disabled: true, created: '2025-08-01T00:00:00Z' },
    ]);
    const firestore = fakeFirestore({
        'users/admin1': { email: 'admin@wpa.church', first_name: 'Ada', last_name: 'Admin', is_admin: true, is_verified: true, reports: 0 },
        'users/u1': { email: 'mary.jones@example.com', first_name: 'Mary', last_name: 'Jones', is_admin: false, is_verified: true, reports: 2 },
        'users/u1/devices/d1': { token: 'abcdefghijklmnopqrstuvwxyz', platform: 'ios' },
        'users/u1/notification_settings/n1': { daily_engagement_reminder: true },
        'users/u2': { email: 'pat@example.com', first_name: 'Pat', last_name: 'Lee', is_admin: false, is_verified: false, reports: 0 },
        'users/ghost': { email: 'ghost@example.com', first_name: 'Ghost', last_name: '', is_admin: false, is_verified: true, reports: 0 },
        'prayer_requests/p1': { user_id: 'u1' },
        'prayer_requests/p2': { user_id: 'u1' },
        'testimonies/t1': { user_id: 'u2' },
    });
    const messaging = fakeMessaging();
    return { auth, firestore, messaging, service: new UserAdminService(firestore, auth, messaging) };
}

// ---------- Pure helpers ----------

describe('user directory helpers', () => {
    test('summarizeUser merges the Auth account and profile', () => {
        const summary = summarizeUser('u1',
            { email: 'A@x.com', emailVerified: true, disabled: false, providerData: [{ providerId: 'password' }], metadata: { creationTime: 'Mon, 01 Jan 2024 00:00:00 GMT' } },
            { email: 'b@x.com', first_name: 'Ann', last_name: 'Bee', is_admin: true, reports: '3' });
        assert.equal(summary.name, 'Ann Bee');
        assert.equal(summary.isAdmin, true);
        assert.equal(summary.reports, 3);
        assert.equal(summary.createdAt, '2024-01-01T00:00:00.000Z');
        assert.equal(summary.emailMismatch, true);
        assert.deepEqual(summary.providers, ['password']);
    });

    test('queryDirectory searches, filters, counts, sorts and pages', () => {
        const users = [
            { uid: 'a', email: 'mary@x.com', name: 'Mary Jones', hasAccount: true, hasProfile: true, disabled: false, emailVerified: true, isVerified: true, isAdmin: false, reports: 0, createdAt: '2025-01-01' },
            { uid: 'b', email: 'mark@x.com', name: 'Mark Jones', hasAccount: true, hasProfile: false, disabled: true, emailVerified: false, isVerified: false, isAdmin: false, reports: 1, createdAt: '2025-03-01' },
            { uid: 'c', email: 'zed@x.com', name: 'Zed', hasAccount: false, hasProfile: true, disabled: false, emailVerified: false, isVerified: true, isAdmin: true, reports: 0, createdAt: null },
        ];
        const jones = queryDirectory(users, { q: 'JONES' });
        assert.deepEqual(jones.users.map((u) => u.uid), ['b', 'a']);
        assert.equal(jones.counts.all, 2);
        assert.equal(jones.counts.disabled, 1);
        assert.equal(jones.counts.missing_profile, 1);

        assert.deepEqual(queryDirectory(users, { q: 'mar jon', sort: 'name_asc' }).users.map((u) => u.uid), ['b', 'a']);
        assert.deepEqual(queryDirectory(users, { filter: 'missing_account' }).users.map((u) => u.uid), ['c']);
        // Active excludes deactivated users and those who haven't verified their email.
        const unverifiedActive = { ...users[0], uid: 'e', emailVerified: false };
        assert.deepEqual(queryDirectory([...users, unverifiedActive], { filter: 'active' }).users.map((u) => u.uid), ['a']);
        // Approval (profile is_verified) and email verification (Auth) are separate filters.
        assert.deepEqual(queryDirectory(users, { filter: 'pending_approval' }).users.map((u) => u.uid), []);
        assert.deepEqual(queryDirectory(users, { filter: 'email_unverified' }).users.map((u) => u.uid), ['b']);
        assert.deepEqual(queryDirectory([...users, { ...users[0], uid: 'd', isVerified: false }], { filter: 'pending_approval' }).users.map((u) => u.uid), ['d']);
        // An exact email match comes first whatever the sort.
        assert.equal(queryDirectory(users, { q: 'mary@x.com', sort: 'created_desc' }).users[0].uid, 'a');

        const paged = queryDirectory(users, { pageSize: 2, page: 9 });
        assert.equal(paged.page, 2);
        assert.equal(paged.pageCount, 2);
        assert.equal(paged.users.length, 1);

        assert.throws(() => queryDirectory(users, { filter: 'nope' }), UserAdminError);
    });

    test('findPhoto picks photo fields by name, preferring thumbnails for small sizes', () => {
        const both = findPhoto({
            profile_image_gs_location: 'gs://b/users/u1/full.jpg',
            profile_image_thumbnail_gs_location: 'gs://b/users/u1/thumb.jpg',
            first_name: 'gs://not-a-photo-field',
            image_count: 3,
        });
        assert.deepEqual(both, {
            thumbnail: 'gs://b/users/u1/thumb.jpg',
            full: 'gs://b/users/u1/full.jpg',
            keys: ['profile_image_gs_location', 'profile_image_thumbnail_gs_location'],
        });
        assert.equal(findPhoto({ thumbnail: 'gs://b/t.jpg' }).full, 'gs://b/t.jpg');
        assert.deepEqual(findPhoto({}, { photoURL: 'https://lh3.example/p.jpg' }), {
            thumbnail: 'https://lh3.example/p.jpg', full: 'https://lh3.example/p.jpg', keys: [],
        });
        assert.equal(findPhoto(null).thumbnail, null);
    });

    test('createImageSigner signs gs:// locations, caches them and passes https through', async () => {
        const signed = [];
        const storage = {
            bucket: (bucket) => ({
                file: (path) => ({
                    getSignedUrl: async () => {
                        if (path === 'missing.jpg') throw new Error('No such object');
                        signed.push(`${bucket}/${path}`);
                        return [`https://signed.example/${bucket}/${path}`];
                    },
                }),
            }),
        };
        const sign = createImageSigner(storage);
        assert.equal(await sign('gs://bkt/users/a.jpg'), 'https://signed.example/bkt/users/a.jpg');
        await sign('gs://bkt/users/a.jpg');
        assert.deepEqual(signed, ['bkt/users/a.jpg']);
        assert.equal(await sign('https://lh3.example/p.jpg'), 'https://lh3.example/p.jpg');
        assert.equal(await sign('gs://bkt/missing.jpg'), null);
        assert.equal(await sign(null), null);
        assert.equal(await createImageSigner(null)('gs://bkt/a.jpg'), null);
    });

    test('serializeFirestore and maskToken', () => {
        const ts = { toDate: () => new Date('2025-01-02T03:04:05Z') };
        assert.deepEqual(serializeFirestore({ a: ts, b: [ts], c: { latitude: 1, longitude: 2 }, d: { path: 'x/y', firestore: {} } }),
            { a: '2025-01-02T03:04:05.000Z', b: ['2025-01-02T03:04:05.000Z'], c: { latitude: 1, longitude: 2 }, d: 'x/y' });
        assert.equal(maskToken('abcdefghijklmnopqrstuvwxyz'), 'abcdef…wxyz');
        assert.equal(maskToken(''), null);
    });
});

// ---------- Service ----------

describe('UserAdminService', () => {
    let f;
    beforeEach(() => { f = fixtures(); });

    test('search merges every Auth account and profile across pages', async () => {
        const result = await f.service.search({});
        assert.equal(result.total, 5);
        assert.equal(result.counts.missing_profile, 1); // u3
        assert.equal(result.counts.missing_account, 1); // ghost
        assert.equal(result.counts.admins, 1);
        assert.equal(result.counts.reported, 1);
        assert.equal(result.counts.disabled, 1);
        assert.deepEqual((await f.service.search({ q: 'mary' })).users.map((u) => u.uid), ['u1']);
    });

    test('directory is cached until refreshed', async () => {
        let now = 0;
        const service = new UserAdminService(f.firestore, f.auth, f.messaging, { now: () => now, cacheTtlMs: 1000 });
        await service.search({});
        f.auth.users.delete('u3'); // u3 has no profile, so it leaves the directory
        assert.equal((await service.search({})).total, 5);
        assert.equal((await service.search({ refresh: true })).total, 4);
        f.auth.users.delete('u1');
        f.firestore.docs.delete('users/u1');
        now = 2000;
        assert.equal((await service.search({})).total, 3);
    });

    test('getUser returns account, profile, activity, devices and settings', async () => {
        const user = await f.service.getUser('u1');
        assert.equal(user.name, 'Mary Jones');
        assert.deepEqual(user.activity, { completions: 0, prayer_requests: 2, testimonies: 0 });
        assert.equal(user.devices.length, 1);
        assert.equal(user.devices[0].token, 'abcdef…wxyz');
        assert.equal(user.devices[0].platform, 'ios');
        assert.equal(user.notificationSettings.daily_engagement_reminder, true);
        assert.equal(user.account.providers[0].providerId, 'password');

        const ghost = await f.service.getUser('ghost');
        assert.equal(ghost.hasAccount, false);
        assert.equal(ghost.account, null);

        await assert.rejects(f.service.getUser('missing'), (e) => e.status === 404);
    });

    test('search and getUser send signed photo URLs, not storage locations', async () => {
        f.firestore.docs.set('users/u1', {
            ...f.firestore.docs.get('users/u1'),
            profile_image: 'gs://bkt/users/u1/full.jpg',
            profile_image_thumbnail: 'gs://bkt/users/u1/thumb.jpg',
        });
        const service = new UserAdminService(f.firestore, f.auth, f.messaging, {
            signImage: async (location) => location && location.replace('gs://', 'https://signed.example/'),
        });
        const [row] = (await service.search({ q: 'mary' })).users;
        assert.equal(row.photoUrl, 'https://signed.example/bkt/users/u1/thumb.jpg');
        assert.equal(row.photoFullUrl, 'https://signed.example/bkt/users/u1/full.jpg');
        assert.equal('photo' in row, false);

        const user = await service.getUser('u1');
        assert.equal(user.photoUrl, 'https://signed.example/bkt/users/u1/thumb.jpg');
        assert.deepEqual(user.photoFields, ['profile_image', 'profile_image_thumbnail']);

        // No photo: no URL, and the default signer never exposes gs:// locations.
        assert.equal((await f.service.getUser('u2')).photoUrl, null);
        assert.equal((await f.service.getUser('u1')).photoUrl, null);
    });

    test('deactivating revokes sessions; admins lose and regain admin topics', async () => {
        f.firestore.docs.set('users/admin1/devices/d9', { token: 'admin-device-token-123' });
        const off = await f.service.setDisabled('admin1', true);
        assert.equal(off.user.disabled, true);
        assert.ok(f.auth.calls.some(([name, uid]) => name === 'revokeRefreshTokens' && uid === 'admin1'));
        assert.deepEqual(f.messaging.calls.map(([kind, topic]) => `${kind}:${topic}`), ADMIN_TOPICS.map((t) => `unsubscribe:${t}`));
        assert.equal(off.topics.tokens, 1);

        f.messaging.calls.length = 0;
        const on = await f.service.setDisabled('admin1', false);
        assert.equal(on.user.disabled, false);
        assert.deepEqual(f.messaging.calls.map(([kind]) => kind), ADMIN_TOPICS.map(() => 'subscribe'));

        await assert.rejects(f.service.setDisabled('admin1', true, { actorUid: 'admin1' }), /your own account/);
        await assert.rejects(f.service.setDisabled('ghost', true), (e) => e.status === 409);
    });

    test('non-admins are deactivated without touching topics', async () => {
        const result = await f.service.setDisabled('u1', true);
        assert.equal(result.topics, null);
        assert.equal(f.messaging.calls.length, 0);
        assert.equal((await f.service.search({ filter: 'disabled' })).total, 2);
    });

    test('generates password reset and verification links', async () => {
        const reset = await f.service.generatePasswordResetLink('u1');
        assert.equal(reset.link, 'https://reset.example/?email=mary.jones@example.com');
        assert.equal(reset.hasPassword, true);
        const verify = await f.service.generateVerificationLink('u2');
        assert.match(verify.link, /verify\.example/);
        await assert.rejects(f.service.generatePasswordResetLink('ghost'), (e) => e.status === 409);
    });

    test('marking the email verified only touches Auth', async () => {
        const user = await f.service.setEmailVerified('u2', true);
        assert.equal(user.emailVerified, true);
        assert.equal(user.isVerified, false);
        assert.equal(f.firestore.docs.get('users/u2').is_verified, false);
        await assert.rejects(f.service.setEmailVerified('ghost', true), (e) => e.status === 409);
    });

    test('approving only touches the profile is_verified', async () => {
        const approved = await f.service.setApproved('u2', true);
        assert.equal(approved.isVerified, true);
        assert.equal(approved.emailVerified, false);
        assert.equal(f.firestore.docs.get('users/u2').is_verified, true);
        assert.equal((await f.service.setApproved('u2', false)).isVerified, false);
        await assert.rejects(f.service.setApproved('u3', true), /no profile/);
    });

    test('granting and revoking admin syncs topics and protects the caller', async () => {
        const granted = await f.service.setAdmin('u1', true);
        assert.equal(granted.user.isAdmin, true);
        assert.equal(granted.topics.tokens, 1);
        assert.deepEqual(f.messaging.calls.map(([kind]) => kind), ADMIN_TOPICS.map(() => 'subscribe'));
        assert.deepEqual(f.messaging.calls[0][2], ['abcdefghijklmnopqrstuvwxyz']);

        f.messaging.calls.length = 0;
        const revoked = await f.service.setAdmin('u1', false);
        assert.equal(revoked.user.isAdmin, false);
        assert.deepEqual(f.messaging.calls.map(([kind]) => kind), ADMIN_TOPICS.map(() => 'unsubscribe'));

        await assert.rejects(f.service.setAdmin('admin1', false, { actorUid: 'admin1' }), /your own admin/);
        await assert.rejects(f.service.setAdmin('u3', true), /no profile/);
    });

    test('changing email updates both records, clears email verification and keeps approval', async () => {
        const user = await f.service.updateProfile('u1', { firstName: ' Maria ', email: 'Maria@Example.com' });
        assert.equal(user.email, 'maria@example.com');
        assert.equal(user.firstName, 'Maria');
        assert.equal(user.emailVerified, false);
        assert.equal(f.firestore.docs.get('users/u1').email, 'maria@example.com');
        assert.equal(f.firestore.docs.get('users/u1').is_verified, true);

        await assert.rejects(f.service.updateProfile('u1', { email: 'pat@example.com' }), (e) => e.status === 409);
        await assert.rejects(f.service.updateProfile('u1', { email: 'not-an-email' }), (e) => e.status === 400);
    });

    test('creates a profile for an account that has none', async () => {
        const user = await f.service.createProfile('u3', { firstName: 'No', lastName: 'Doc' });
        assert.equal(user.hasProfile, true);
        assert.equal(f.firestore.docs.get('users/u3').is_admin, false);
        assert.equal(user.isVerified, false); // awaiting approval
        await assert.rejects(f.service.createProfile('u1'), (e) => e.status === 409);
    });

    test('getDeviceToken returns the full token', async () => {
        assert.deepEqual(await f.service.getDeviceToken('u1', 'd1'), { token: 'abcdefghijklmnopqrstuvwxyz' });
        await assert.rejects(f.service.getDeviceToken('u1', 'nope'), (e) => e.status === 404);
        f.firestore.docs.set('users/u1/devices/d2', { platform: 'android' });
        await assert.rejects(f.service.getDeviceToken('u1', 'd2'), /no push token/);
    });

    test('clearReports resets the counter', async () => {
        assert.equal((await f.service.clearReports('u1')).reports, 0);
    });

    test('createUser without a password returns a reset link; duplicates are rejected', async () => {
        const { user, resetLink } = await f.service.createUser({ email: 'New@Example.com', firstName: 'New', lastName: 'Person' });
        assert.equal(user.email, 'new@example.com');
        assert.equal(user.emailVerified, true);
        assert.equal(user.isVerified, true);
        assert.match(resetLink, /reset\.example/);
        assert.equal(f.firestore.docs.get(`users/${user.uid}`).first_name, 'New');

        const withPassword = await f.service.createUser({ email: 'second@example.com', password: 'secret123' });
        assert.equal(withPassword.resetLink, null);

        await assert.rejects(f.service.createUser({ email: 'pat@example.com' }), (e) => e.status === 409);
        await assert.rejects(f.service.createUser({ email: 'x@y.z', password: '123' }), /at least 6/);
    });

    test('createUser removes the account if the profile cannot be written', async () => {
        const firestore = fakeFirestore();
        const broken = { ...firestore, collection: () => ({ doc: () => ({ set: async () => { throw new Error('denied'); } }) }) };
        const auth = fakeAuth();
        await assert.rejects(new UserAdminService(broken, auth, null).createUser({ email: 'a@b.co' }), /denied/);
        assert.equal(auth.users.size, 0);
    });

    test('deleteUser needs the email typed, removes both records and keeps content', async () => {
        await f.service.search({});
        await assert.rejects(f.service.deleteUser('u1', { confirm: 'wrong' }), /Type mary\.jones@example\.com/);
        await assert.rejects(f.service.deleteUser('admin1', { actorUid: 'admin1', confirm: 'admin@wpa.church' }), /your own account/);

        await f.service.deleteUser('u1', { confirm: 'MARY.JONES@example.com' });
        assert.equal(f.auth.users.has('u1'), false);
        assert.equal([...f.firestore.docs.keys()].some((p) => p.startsWith('users/u1')), false);
        assert.equal(f.firestore.docs.has('prayer_requests/p1'), true);
        assert.equal((await f.service.search({})).total, 4);

        // Profile-only users are confirmed by their profile email.
        await f.service.deleteUser('ghost', { confirm: 'ghost@example.com' });
        assert.equal(f.firestore.docs.has('users/ghost'), false);
    });

    test('deleteUser with deleteData also removes their content and stored photo', async () => {
        f.firestore.docs.set('prayer_requests/p1/comments/c1', { text: 'amen' });
        f.firestore.docs.set('completions/c9', { user_id: 'u1' });
        f.firestore.docs.get('users/u1').photo_url = 'gs://bucket/profiles/u1.jpg';
        const deletedFiles = [];
        f.service.storage = { bucket: (b) => ({ file: (p) => ({ delete: async () => { deletedFiles.push(`${b}/${p}`); } }) }) };

        const result = await f.service.deleteUser('u1', { confirm: 'mary.jones@example.com', deleteData: true });
        assert.deepEqual(result.deletedData, { completions: 1, prayer_requests: 2, testimonies: 0, photos: 1 });
        assert.deepEqual(deletedFiles, ['bucket/profiles/u1.jpg']);
        assert.equal([...f.firestore.docs.keys()].some((p) => p.startsWith('prayer_requests/') || p.startsWith('completions/')), false);
        assert.equal(f.firestore.docs.has('testimonies/t1'), true); // someone else's
        assert.equal(f.auth.users.has('u1'), false);
    });
});

// ---------- Firebase emails ----------

/** fetch stand-in for the Identity Toolkit REST API; `fail` maps a method to an error message. */
function fakeIdentityToolkit({ fail = {} } = {}) {
    const calls = [];
    const fetchImpl = async (url, { body }) => {
        const method = /accounts:(\w+)\?key=(.+)$/.exec(url);
        const payload = JSON.parse(body);
        calls.push({ method: method[1], key: decodeURIComponent(method[2]), payload });
        const json = (status, data) => ({ ok: status < 400, status, json: async () => data });
        if (fail[method[1]]) return json(400, { error: { code: 400, message: fail[method[1]] } });
        if (method[1] === 'signInWithCustomToken') return json(200, { idToken: `id-for-${payload.token}` });
        return json(200, { email: payload.email ?? 'from-id-token@example.com' });
    };
    return { calls, fetch: fetchImpl };
}

describe('createAuthEmailSender', () => {
    test('sends a password reset email with just the address', async () => {
        const api = fakeIdentityToolkit();
        await createAuthEmailSender({ apiKey: 'web-key', auth: fakeAuth(), fetch: api.fetch }).sendPasswordResetEmail('a@b.co');
        assert.deepEqual(api.calls, [{ method: 'sendOobCode', key: 'web-key', payload: { requestType: 'PASSWORD_RESET', email: 'a@b.co' } }]);
    });

    test('sends a verification email with the user\'s own ID token', async () => {
        const api = fakeIdentityToolkit();
        const auth = fakeAuth([{ uid: 'u1', email: 'a@b.co' }]);
        await createAuthEmailSender({ apiKey: 'web-key', auth, fetch: api.fetch }).sendVerificationEmail('u1');
        assert.deepEqual(api.calls.map((c) => [c.method, c.payload]), [
            ['signInWithCustomToken', { token: 'custom-u1', returnSecureToken: true }],
            ['sendOobCode', { requestType: 'VERIFY_EMAIL', idToken: 'id-for-custom-u1' }],
        ]);
    });

    test('explains Firebase errors', async () => {
        const send = (message, method = 'sendOobCode') => createAuthEmailSender({
            apiKey: 'k', auth: fakeAuth([{ uid: 'u1' }]), fetch: fakeIdentityToolkit({ fail: { [method]: message } }).fetch,
        });
        await assert.rejects(send('TOO_MANY_ATTEMPTS_TRY_LATER : Too many requests').sendPasswordResetEmail('a@b.co'),
            (e) => e instanceof AuthEmailError && e.status === 429 && /limiting/.test(e.message));
        await assert.rejects(send('API key not valid. Please pass a valid API key.').sendPasswordResetEmail('a@b.co'),
            (e) => e.status === 500 && /not valid/.test(e.message));
        await assert.rejects(send('CREDENTIAL_MISMATCH', 'signInWithCustomToken').sendVerificationEmail('u1'),
            (e) => /different Firebase project/.test(e.message));
        await assert.rejects(send('SOMETHING_NEW').sendPasswordResetEmail('a@b.co'), (e) => e.status === 502 && /SOMETHING_NEW/.test(e.message));

        const offline = createAuthEmailSender({ apiKey: 'k', auth: fakeAuth(), fetch: async () => { throw new Error('ENOTFOUND'); } });
        await assert.rejects(offline.sendPasswordResetEmail('a@b.co'), /Could not reach Firebase: ENOTFOUND/);
    });
});

describe('UserAdminService emails', () => {
    function withSender(f, options) {
        const api = fakeIdentityToolkit(options);
        const service = new UserAdminService(f.firestore, f.auth, f.messaging, {
            emailSender: createAuthEmailSender({ apiKey: 'k', auth: f.auth, fetch: api.fetch }),
        });
        return { api, service };
    }

    test('sends reset and verification emails', async () => {
        const f = fixtures();
        const { api, service } = withSender(f);
        assert.deepEqual(service.emailSending, { available: true });
        assert.deepEqual(await service.sendPasswordResetEmail('u1'), { email: 'mary.jones@example.com' });
        assert.deepEqual(await service.sendVerificationEmail('u2'), { email: 'pat@example.com' });
        assert.deepEqual(api.calls.map((c) => c.payload.requestType).filter(Boolean), ['PASSWORD_RESET', 'VERIFY_EMAIL']);
    });

    test('refuses verified, deactivated and account-less users', async () => {
        const f = fixtures();
        const { api, service } = withSender(f);
        await assert.rejects(service.sendVerificationEmail('u1'), (e) => e.status === 409 && /already verified/.test(e.message));
        await assert.rejects(service.sendPasswordResetEmail('u3'), (e) => e.status === 409 && /deactivated/.test(e.message));
        await assert.rejects(service.sendPasswordResetEmail('ghost'), (e) => e.status === 409);
        assert.equal(api.calls.length, 0);
    });

    test('turns Firebase errors into API errors', async () => {
        const { service } = withSender(fixtures(), { fail: { sendOobCode: 'TOO_MANY_ATTEMPTS_TRY_LATER' } });
        await assert.rejects(service.sendPasswordResetEmail('u1'), (e) => e instanceof UserAdminError && e.status === 429);
    });

    test('without a sender, explains what to set up', async () => {
        const f = fixtures();
        const service = new UserAdminService(f.firestore, f.auth, f.messaging, { emailSetupHint: 'Set FIREBASE_WEB_API_KEY_DEV.' });
        assert.equal(service.emailSending.available, false);
        assert.match(service.emailSending.reason, /FIREBASE_WEB_API_KEY_DEV/);
        await assert.rejects(service.sendPasswordResetEmail('u1'), (e) => e.status === 503 && /FIREBASE_WEB_API_KEY_DEV/.test(e.message));
    });
});

// ---------- HTTP ----------

function listen(app) {
    return new Promise((resolve) => {
        const server = app.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
    });
}

/** A token the fake auth accepts, with the project in its payload like a real ID token. */
const idToken = (uid, aud = 'project-a') => `x.${Buffer.from(JSON.stringify({ aud })).toString('base64url')}.token-${uid}`;

describe('User Manager API', () => {
    async function start() {
        const f = fixtures();
        const app = express();
        app.use(express.json());
        const projects = { 'project-a': { auth: f.auth, firestore: f.firestore } };
        app.use('/api/users', createRequireAdmin((id) => projects[id] ?? null),
            createUserRouter(() => ({ service: f.service, projectId: 'project-a', env: 'dev' })));
        const { server, base } = await listen(app);
        const call = (path, { method = 'GET', token = idToken('admin1'), json } = {}) => fetch(`${base}/api/users${path}`, {
            method,
            headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(json ? { 'Content-Type': 'application/json' } : {}) },
            body: json ? JSON.stringify(json) : undefined,
        }).then(async (res) => ({ status: res.status, body: await res.json() }));
        return { f, server, call };
    }

    test('rejects missing, unknown-project, invalid and non-admin tokens', async () => {
        const { server, call, f } = await start();
        try {
            assert.equal((await call('', { token: null })).status, 401);
            assert.equal((await call('', { token: idToken('admin1', 'other-project') })).status, 401);
            assert.equal((await call('', { token: idToken('nobody') })).status, 401);
            assert.equal((await call('', { token: idToken('u1') })).status, 403);
            // An admin whose account was deactivated is locked out too.
            f.auth.users.get('admin1').disabled = true;
            assert.equal((await call('', { token: idToken('admin1') })).status, 401);
        } finally {
            server.close();
        }
    });

    test('searches, reads and acts on users', async () => {
        const { server, call } = await start();
        try {
            const list = await call('?q=example.com&filter=email_unverified&sort=email_asc');
            assert.equal(list.status, 200);
            assert.equal(list.body.env, 'dev');
            assert.deepEqual(list.body.users.map((u) => u.uid), ['u3', 'u2']);

            assert.equal((await call('?filter=bogus')).status, 400);

            const detail = await call('/u1');
            assert.equal(detail.body.user.activity.prayer_requests, 2);
            assert.equal((await call('/nope')).status, 404);

            const reset = await call('/u1/password-reset-link', { method: 'POST' });
            assert.match(reset.body.link, /reset\.example/);

            // No web API key in this setup: sending is reported as unavailable.
            assert.equal(detail.body.emailSending.available, false);
            assert.equal((await call('/u1/send-password-reset-email', { method: 'POST' })).status, 503);
            assert.equal((await call('/u1/send-verification-email', { method: 'POST' })).status, 409); // already verified

            const disabled = await call('/u2/disabled', { method: 'POST', json: { disabled: true } });
            assert.equal(disabled.body.user.disabled, true);
            assert.equal((await call('/u2/disabled', { method: 'POST', json: { disabled: 'yes' } })).status, 400);

            // The caller can't lock themselves out.
            assert.equal((await call('/admin1/admin', { method: 'POST', json: { isAdmin: false } })).status, 400);
            assert.equal((await call('/admin1/disabled', { method: 'POST', json: { disabled: true } })).status, 400);

            const created = await call('', { method: 'POST', json: { email: 'fresh@example.com', firstName: 'Fresh' } });
            assert.equal(created.status, 201);
            assert.ok(created.body.resetLink);

            const patched = await call('/u1/profile', { method: 'PATCH', json: { lastName: 'Smith' } });
            assert.equal(patched.body.user.name, 'Mary Smith');

            assert.equal((await call('/u1', { method: 'DELETE', json: { confirm: 'nope' } })).status, 400);
            const deleted = await call('/u1', { method: 'DELETE', json: { confirm: 'mary.jones@example.com' } });
            assert.equal(deleted.body.deleted, 'u1');
        } finally {
            server.close();
        }
    });

    test('self-protection only applies in the project the admin signed in to', async () => {
        const f = fixtures();
        const app = express();
        app.use(express.json());
        app.use('/api/users', createRequireAdmin(() => ({ auth: f.auth, firestore: f.firestore })),
            createUserRouter(() => ({ service: f.service, projectId: 'project-b', env: 'prod' })));
        const { server, base } = await listen(app);
        try {
            // In another project the same uid is a different person.
            const res = await fetch(`${base}/api/users/admin1/admin`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${idToken('admin1')}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ isAdmin: false }),
            });
            assert.equal(res.status, 200);
        } finally {
            server.close();
        }
    });

    test('503 while the selected environment has no user service', async () => {
        const f = fixtures();
        const app = express();
        app.use('/api/users', createRequireAdmin(() => ({ auth: f.auth, firestore: f.firestore })),
            createUserRouter(() => ({ service: null, projectId: null, env: 'dev' })));
        const { server, base } = await listen(app);
        try {
            const res = await fetch(`${base}/api/users`, { headers: { Authorization: `Bearer ${idToken('admin1')}` } });
            assert.equal(res.status, 503);
        } finally {
            server.close();
        }
    });
});
