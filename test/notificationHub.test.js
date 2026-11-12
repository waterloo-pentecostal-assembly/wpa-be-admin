import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { DateTime } from 'luxon';
import {
    NotificationHubError, NotificationHubService, describeAudience, matchesProgress, normalizeAudience, normalizeMessage,
    parseTokens, progressOf, scheduleFromSnippet, seriesDays, seriesToday,
} from '../src/services/notificationHubService.js';
import { createNotificationRouter } from '../src/routes/notificationRoutes.js';
import { SERIES_ZONE } from '../src/services/publishedSeries.js';
import { findPlaceholders, placeholderValues, renderTemplate, unknownPlaceholders, usesGroup } from '../ui/src/notifications/placeholders.js';

// ---------- In-memory stand-ins for the Firebase Admin APIs used ----------

const ts = (iso) => {
    const millis = DateTime.fromISO(iso, { zone: SERIES_ZONE }).toMillis();
    return { toMillis: () => millis, toDate: () => new Date(millis) };
};

/** Firestore keyed by document path, with the queries the hub uses. */
function fakeFirestore(initial = {}) {
    const docs = new Map(Object.entries(initial).map(([path, data]) => [path, { ...data }]));
    let counter = 0;
    const snapshot = (path) => ({
        id: path.split('/').pop(),
        ref: docRef(path),
        exists: docs.has(path),
        data: () => (docs.has(path) ? { ...docs.get(path) } : undefined),
    });
    const docRef = (path) => ({
        id: path.split('/').pop(),
        path,
        get: async () => snapshot(path),
        delete: async () => { docs.delete(path); },
        set: async (data) => { docs.set(path, { ...data }); },
        update: async (patch) => {
            if (!docs.has(path)) throw new Error(`NOT_FOUND: ${path}`);
            docs.set(path, { ...docs.get(path), ...patch });
        },
        collection: (name) => collectionRef(`${path}/${name}`),
    });
    const query = (match, predicates = [], limit = Infinity, order = null) => {
        const run = () => {
            let paths = [...docs.keys()].filter(match).filter((p) => predicates.every(([f, v]) => docs.get(p)[f] === v));
            if (order) {
                const [field, dir] = order;
                const key = (p) => { const v = docs.get(p)[field]; return v?.getTime?.() ?? v ?? ''; };
                const compare = (a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);
                paths = paths.sort((a, b) => (dir === 'desc' ? compare(b, a) : compare(a, b)));
            }
            return paths.slice(0, limit);
        };
        return {
            where: (field, op, value) => query(match, [...predicates, [field, value]], limit, order),
            limit: (n) => query(match, predicates, n, order),
            orderBy: (field, dir = 'asc') => query(match, predicates, limit, [field, dir]),
            select: () => query(match, predicates, limit, order),
            get: async () => {
                const list = run().map(snapshot);
                return { docs: list, empty: list.length === 0, size: list.length, forEach: (fn) => list.forEach(fn) };
            },
        };
    };
    const children = (prefix) => (p) => p.startsWith(`${prefix}/`) && !p.slice(prefix.length + 1).includes('/');
    const collectionRef = (prefix) => ({
        ...query(children(prefix)),
        doc: (id) => docRef(`${prefix}/${id}`),
        add: async (data) => {
            const id = `auto${++counter}`;
            docs.set(`${prefix}/${id}`, { ...data });
            return { id };
        },
    });
    return {
        docs,
        collection: (name) => collectionRef(name),
        collectionGroup: (name) => query((p) => {
            const parts = p.split('/');
            return parts.length % 2 === 0 && parts.at(-2) === name;
        }),
    };
}

function fakeMessaging({ failures = {} } = {}) {
    const calls = [];
    return {
        calls,
        sendEach: async (messages, dryRun) => {
            calls.push({ messages, dryRun });
            const responses = messages.map((m) => (failures[m.token]
                ? { success: false, error: { code: failures[m.token] } }
                : { success: true, messageId: `msg-${m.token}` }));
            return { responses, successCount: responses.filter((r) => r.success).length, failureCount: responses.filter((r) => !r.success).length };
        },
    };
}

const summary = (uid, extra = {}) => ({
    uid, name: uid.toUpperCase(), email: `${uid}@x.com`, hasAccount: true, hasProfile: true, disabled: false, isAdmin: false, ...extra,
});

// Today is 2026-11-12 in Toronto. The active series runs Nov 10–14 with
// entries c10, c11, c12a, c12b, c13, c14.
const NOW = DateTime.fromISO('2026-11-12T15:00:00', { zone: SERIES_ZONE }).toMillis();

function fixtures({ failures } = {}) {
    const firestore = fakeFirestore({
        'bible_series/s1': {
            title: 'Romans',
            is_active: true,
            series_content_snippet: [
                { date: ts('2026-11-10'), content_types: [{ content_type: 'read', content_id: 'c10' }] },
                { date: ts('2026-11-11'), content_types: [{ content_type: 'read', content_id: 'c11' }] },
                { date: ts('2026-11-12'), content_types: [{ content_type: 'read', content_id: 'c12a' }, { content_type: 'pray', content_id: 'c12b' }] },
                { date: ts('2026-11-13'), content_types: [{ content_type: 'read', content_id: 'c13' }] },
                { date: ts('2026-11-14'), content_types: [{ content_type: 'read', content_id: 'c14' }] },
            ],
        },
        'bible_series/old': { title: 'Old', is_active: false },
        // onTrack: done through yesterday. behind: only day 1. ahead: done through tomorrow.
        'completions/1': { user_id: 'onTrack', series_id: 's1', content_id: 'c10' },
        'completions/2': { user_id: 'onTrack', series_id: 's1', content_id: 'c11' },
        'completions/3': { user_id: 'behind', series_id: 's1', content_id: 'c10' },
        'completions/4': { user_id: 'ahead', series_id: 's1', content_id: 'c10' },
        'completions/5': { user_id: 'ahead', series_id: 's1', content_id: 'c11' },
        'completions/6': { user_id: 'ahead', series_id: 's1', content_id: 'c12a' },
        'completions/7': { user_id: 'ahead', series_id: 's1', content_id: 'c12b' },
        'completions/8': { user_id: 'ahead', series_id: 's1', content_id: 'c13' },
        'completions/9': { user_id: 'idle', series_id: 'old', content_id: 'x' },
        // What the Cloud Function keeps for the same completions (% of the 5 days done).
        'achievements/a1': { user_id: 'onTrack', series_progress: 40 },
        'achievements/a2': { user_id: 'behind', series_progress: 20 },
        'achievements/a3': { user_id: 'ahead', series_progress: 80 },
        'achievements/a4': { user_id: 'idle', series_progress: 0 }, // reset for the new series
        'users/onTrack/devices/d1': { token: 'tok-ontrack-1', platform: 'ios' },
        'users/onTrack/devices/d2': { token: 'tok-ontrack-2', platform: 'android' },
        'users/behind/devices/d1': { token: 'tok-behind' },
        'users/ahead/devices/d1': { token: 'tok-ahead' },
        'users/idle/devices/d1': { token: 'tok-idle' },
        'users/optout/devices/d1': { token: 'tok-optout' },
        'users/optout/notification_settings/n1': { daily_engagement_reminder: false },
        'users/idle/notification_settings/n1': { daily_engagement_reminder: true },
        'users/gone/devices/d1': { token: 'tok-gone' },
        'users/admin1/devices/d1': { token: 'tok-admin' },
        'users/admin1/devices/d2': { platform: 'web' }, // no token
        // Same phone registered under two accounts.
        'users/shared/devices/d1': { token: 'tok-idle' },
        // Not a user's device; ignored.
        'kiosks/k1/devices/d1': { token: 'tok-kiosk' },
    });
    const directory = new Map([
        ['onTrack', summary('onTrack')],
        ['behind', summary('behind')],
        ['ahead', summary('ahead')],
        ['idle', summary('idle')],
        ['optout', summary('optout')],
        ['disabled', summary('disabled', { disabled: true })],
        ['gone', summary('gone', { hasAccount: false })],
        ['admin1', summary('admin1', { isAdmin: true })],
        ['shared', summary('shared')],
        ['noDevices', summary('noDevices')],
        ['accountOnly', summary('accountOnly', { hasProfile: false })],
    ]);
    firestore.docs.set('users/disabled/devices/d1', { token: 'tok-disabled' });
    const messaging = fakeMessaging({ failures });
    const service = new NotificationHubService(firestore, messaging, { loadDirectory: async () => ({ users: directory }), now: () => NOW });
    return { firestore, messaging, service, directory };
}

const uids = (preview) => preview.users.map((u) => u.uid).sort();

// ---------- Pure helpers ----------

describe('notification hub helpers', () => {
    test('normalizeAudience validates and fills defaults', () => {
        assert.deepEqual(normalizeAudience({ type: 'tokens', tokens: ' a, b\nb  c ' }), { type: 'tokens', tokens: ['a', 'b', 'c'] });
        assert.deepEqual(normalizeAudience({ type: 'users', users: ['u1', { uid: 'u2', deviceIds: ['d1', 'd1'] }, { uid: 'u1' }] }),
            { type: 'users', users: [{ uid: 'u1' }, { uid: 'u2', deviceIds: ['d1'] }] });
        assert.deepEqual(normalizeAudience({ type: 'behind' }),
            { type: 'behind', excludeDisabled: true, skipOptedOut: true, minBehindPct: 0, includeToday: false, includeNotStarted: false });
        assert.deepEqual(normalizeAudience({ type: 'all' }), { type: 'all', excludeDisabled: true, skipOptedOut: false });
        assert.equal(normalizeAudience({ type: 'ahead', minAheadPct: '12.5' }).minAheadPct, 12.5);
        assert.equal(normalizeAudience({ type: 'recent' }).withinDays, 7);
        assert.equal(normalizeAudience({ type: 'recent' }).skipOptedOut, false);
        assert.throws(() => normalizeAudience({ type: 'recent', withinDays: 0 }), /1 to 365/);
        assert.equal(normalizeAudience({ type: 'completed' }).skipOptedOut, true);

        assert.throws(() => normalizeAudience({ type: 'everyone' }), NotificationHubError);
        assert.throws(() => normalizeAudience({ type: 'tokens', tokens: '  ' }), /at least one device token/);
        assert.throws(() => normalizeAudience({ type: 'users', users: [] }), /at least one user/);
        assert.throws(() => normalizeAudience({ type: 'users', users: [{ uid: 'u1', deviceIds: [] }] }), /at least one device/);
        assert.throws(() => normalizeAudience({ type: 'behind', minBehindPct: 100 }), /percentage points/);
        assert.throws(() => normalizeAudience({ type: 'behind', minBehindPct: -1 }), /percentage points/);
    });

    test('normalizeMessage requires a title and body and keeps data as strings', () => {
        assert.deepEqual(normalizeMessage({ title: ' Hi ', body: 'There', data: { notificationType: 'announcement', n: 3, ' ': 'x' } }),
            { title: 'Hi', body: 'There', data: { notificationType: 'announcement', n: '3' } });
        assert.throws(() => normalizeMessage({ title: '', body: 'x' }), /title/);
        assert.throws(() => normalizeMessage({ title: 'x', body: ' ' }), /message/);
        assert.throws(() => normalizeMessage({ title: 'x', body: 'y', data: { 'google.foo': '1' } }), /reserves/);
        assert.throws(() => normalizeMessage({ title: 'x', body: 'y'.repeat(5000) }), /too long/);
        assert.throws(() => normalizeMessage({ title: 'Hi {nickname}', body: 'y' }), /Unknown placeholder \{nickname\}/);
        assert.equal(normalizeMessage({ title: 'Hi {first_name|friend}', body: 'y' }).title, 'Hi {first_name|friend}');
    });

    test('parseTokens splits on whitespace and commas', () => {
        assert.deepEqual(parseTokens('a,b \n c,,a'), ['a', 'b', 'c']);
        assert.deepEqual(parseTokens(['a', ' a ', 'b']), ['a', 'b']);
    });

    test('progressOf compares the stored percentage with the expected one', () => {
        const days = seriesDays([
            { contentId: 'a', date: '2026-11-10' },
            { contentId: 'b', date: '2026-11-11' },
            { contentId: 'c1', date: '2026-11-12' },
            { contentId: 'c2', date: '2026-11-12' },
            { contentId: 'd', date: '2026-11-13' },
        ]);
        assert.deepEqual(days.map((d) => d.date), ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13']);
        const today = '2026-11-12';
        // Two of four days are due before today (50%); three through today (75%).
        assert.deepEqual(progressOf(days, 25, { today }), { percent: 25, expectedPercent: 50, behindPoints: 25, aheadPoints: 0 });
        assert.deepEqual(progressOf(days, 25, { today, includeToday: true }), { percent: 25, expectedPercent: 75, behindPoints: 50, aheadPoints: 0 });
        // Matching what's due before today is on track; so is having done today's too.
        assert.deepEqual(progressOf(days, 50, { today }), { percent: 50, expectedPercent: 50, behindPoints: 0, aheadPoints: 0 });
        assert.equal(progressOf(days, 75, { today }).aheadPoints, 0);
        // Beyond today is ahead, measured against everything through today.
        assert.deepEqual(progressOf(days, 100, { today }), { percent: 100, expectedPercent: 50, behindPoints: 0, aheadPoints: 25 });
        // The percentage is used as stored (not rounded to days), within 0–100.
        assert.deepEqual(progressOf(days, 33.3, { today }), { percent: 33.3, expectedPercent: 50, behindPoints: 16.7, aheadPoints: 0 });
        assert.equal(progressOf(days, 140, { today }).percent, 100);
        assert.equal(progressOf(days, -5, { today }).percent, 0);
        assert.equal(progressOf(days, undefined, { today }).percent, 0);
        assert.deepEqual(progressOf([], 0, { today }), { percent: 0, expectedPercent: 0, behindPoints: 0, aheadPoints: 0 });

        const p = progressOf(days, 25, { today }); // 25 points behind
        const behind = (extra) => ({ ...normalizeAudience({ type: 'behind' }), ...extra });
        assert.equal(matchesProgress(p, behind({})), true);
        assert.equal(matchesProgress(p, behind({ minBehindPct: 20 })), true);
        assert.equal(matchesProgress(p, behind({ minBehindPct: 25 })), false);
        const none = progressOf(days, 0, { today });
        assert.equal(matchesProgress(none, behind({})), false);
        assert.equal(matchesProgress(none, behind({ includeNotStarted: true })), true);
        assert.equal(matchesProgress(none, normalizeAudience({ type: 'not_started' })), true);
        // Finishing the series is "completed", not "ahead".
        const finished = progressOf(days, 100, { today });
        assert.equal(matchesProgress(finished, normalizeAudience({ type: 'completed' })), true);
        assert.equal(matchesProgress(finished, normalizeAudience({ type: 'ahead' })), false);
        assert.equal(matchesProgress(progressOf(days, 99.9, { today }), normalizeAudience({ type: 'ahead' })), true);
        assert.equal(matchesProgress(progressOf(days, 99.9, { today }), normalizeAudience({ type: 'completed' })), false);
    });

    test('scheduleFromSnippet and seriesToday use the series time zone', () => {
        assert.deepEqual(scheduleFromSnippet([
            { date: ts('2026-11-11'), content_types: [{ content_id: 'b' }] },
            { date: ts('2026-11-10'), content_types: [{ content_id: 'a' }, { content_id: null }] },
        ]), [{ contentId: 'a', date: '2026-11-10' }, { contentId: 'b', date: '2026-11-11' }]);
        // 02:00 UTC on the 13th is still the 12th in Toronto.
        assert.equal(seriesToday(Date.parse('2026-11-13T02:00:00Z')), '2026-11-12');
    });

    test('placeholders render per recipient, with fallbacks', () => {
        const values = { first_name: 'Mary', percent: '35%', series_title: 'Romans', last_name: '' };
        assert.equal(renderTemplate('Hi {first_name}, you are {percent} through {series_title}!', values), 'Hi Mary, you are 35% through Romans!');
        assert.equal(renderTemplate('Hi { FIRST_NAME }', values), 'Hi Mary');
        // Fallbacks, and empty values dropped with the space before them.
        assert.equal(renderTemplate('Hi {last_name|friend}!', values), 'Hi friend!');
        assert.equal(renderTemplate('Hi {last_name}, welcome', values), 'Hi, welcome');
        assert.equal(renderTemplate('Hi {last_name} and welcome', values), 'Hi and welcome');
        // Unknown placeholders are left as typed (and rejected before sending).
        assert.equal(renderTemplate('Hi {nickname}', values), 'Hi {nickname}');
        assert.deepEqual(unknownPlaceholders('Hi {nickname}', '{first_name} {Foo|x}'), ['nickname', 'foo']);
        assert.deepEqual(findPlaceholders('{first_name|there}').map(({ key, fallback, group }) => [key, fallback, group]), [['first_name', 'there', 'user']]);
        assert.equal(usesGroup('progress', 'Hi', 'You are {percent_behind} behind'), true);
        assert.equal(usesGroup('progress', 'Hi {first_name}'), false);

        assert.deepEqual(placeholderValues({
            user: { firstName: '', lastName: 'Jones', name: 'Mary Jones' },
            progress: { percent: 22.5, expectedPercent: 40, behindPoints: 17.5, aheadPoints: 0 },
            series: { title: 'Matthew', totalDays: 40 },
        }), {
            first_name: 'Mary', last_name: 'Jones', full_name: 'Mary Jones', series_title: 'Matthew', total_days: '40',
            percent: '23%', expected_percent: '40%', percent_behind: '18%', percent_ahead: '0%', percent_left: '78%',
        });
        assert.equal(placeholderValues({}).percent, '');
    });

    test('describeAudience', () => {
        assert.equal(describeAudience(normalizeAudience({ type: 'behind', minBehindPct: 10 }), 'Romans'), 'Behind on Romans by more than 10 percentage points');
        assert.equal(describeAudience(normalizeAudience({ type: 'ahead' }), 'Romans'), 'Ahead on Romans');
        assert.equal(describeAudience(normalizeAudience({ type: 'users', users: ['a', { uid: 'b', deviceIds: ['d'] }] })), '2 chosen users (1 on selected devices only)');
    });
});

// ---------- Resolving audiences ----------

describe('NotificationHubService audiences', () => {
    test('series status counts what is due', async () => {
        const { service } = fixtures();
        const { series } = await service.seriesStatus();
        assert.equal(series.title, 'Romans');
        assert.equal(series.today, '2026-11-12');
        assert.equal(series.totalEntries, 6);
        assert.equal(series.totalDays, 5);
        assert.equal(series.dueDays, 2);
        assert.equal(series.dueDaysIncludingToday, 3);
        assert.equal(series.expectedPercent, 40);
        assert.equal(series.expectedPercentIncludingToday, 60);
        assert.equal(series.startDate, '2026-11-10');
        assert.equal(series.endDate, '2026-11-14');
    });

    test('behind: users below the expected percentage, not those who never started', async () => {
        const { service } = fixtures();
        const preview = await service.preview({ type: 'behind' });
        assert.deepEqual(uids(preview), ['behind']);
        assert.deepEqual(preview.users[0].progress,
            { percent: 20, expectedPercent: 40, behindPoints: 20, aheadPoints: 0 });
        assert.equal(preview.series.dueDays, 2);
        assert.equal(preview.series.expectedPercent, 40);
        // One day short is 20 points of a five-day series.
        assert.deepEqual(uids(await service.preview({ type: 'behind', minBehindPct: 19 })), ['behind']);
        assert.deepEqual(uids(await service.preview({ type: 'behind', minBehindPct: 20 })), []);

        // Counting today, onTrack is behind too; ahead has done today's.
        assert.deepEqual(uids(await service.preview({ type: 'behind', includeToday: true })), ['behind', 'onTrack']);
        // Including users who haven't started reaches those with devices who
        // didn't opt out of reminders (deactivated users and profiles without
        // an account are skipped).
        const withIdle = await service.preview({ type: 'behind', includeNotStarted: true });
        assert.deepEqual(uids(withIdle), ['admin1', 'behind', 'idle']);
        assert.equal(withIdle.skipped.optedOut, 1);
        assert.equal(withIdle.skipped.disabled, 1);
        assert.equal(withIdle.skipped.noAccount, 1);
        assert.equal(withIdle.skipped.noDevices, 2); // noDevices, and shared (its only token is idle's)
    });

    test('ahead and not started', async () => {
        const { service } = fixtures();
        const ahead = await service.preview({ type: 'ahead' });
        assert.deepEqual(uids(ahead), ['ahead']);
        assert.equal(ahead.users[0].progress.aheadPoints, 20); // 80% vs 60% due through today
        assert.equal(ahead.users[0].progress.percent, 80);
        assert.deepEqual(uids(await service.preview({ type: 'ahead', minAheadPct: 20 })), []);

        const notStarted = await service.preview({ type: 'not_started' });
        assert.deepEqual(uids(notStarted), ['admin1', 'idle']);
        assert.equal(notStarted.skipped.optedOut, 1);

        // Without skipping opt-outs or deactivated users.
        const everyone = await service.preview({ type: 'not_started', skipOptedOut: false, excludeDisabled: false });
        assert.deepEqual(uids(everyone), ['admin1', 'disabled', 'gone', 'idle', 'optout']);
    });

    test('completed: every day of the series done, and no longer "ahead"', async () => {
        const { service, firestore, directory } = fixtures();
        firestore.docs.set('achievements/done', { user_id: 'done', series_progress: 100 });
        firestore.docs.set('users/done/devices/d1', { token: 'tok-done' });
        directory.set('done', summary('done'));
        const completed = await service.preview({ type: 'completed' });
        assert.deepEqual(uids(completed), ['done']);
        assert.equal(completed.users[0].progress.percent, 100);
        assert.equal(completed.label, 'Completed Romans');
        assert.deepEqual(uids(await service.preview({ type: 'ahead' })), ['ahead']);
    });

    test('recent: users who signed up in the last N days, newest first', async () => {
        const { service, firestore, directory } = fixtures();
        const daysAgo = (n) => new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString();
        directory.set('new1', summary('new1', { createdAt: daysAgo(2) }));
        directory.set('new2', summary('new2', { createdAt: daysAgo(0.5) }));
        directory.set('old', summary('old', { createdAt: daysAgo(30) }));
        for (const uid of ['new1', 'new2', 'old']) firestore.docs.set(`users/${uid}/devices/d1`, { token: `tok-${uid}` });
        const recent = await service.preview({ type: 'recent' });
        assert.deepEqual(recent.users.map((u) => u.uid), ['new2', 'new1']);
        assert.equal(recent.label, 'Signed up in the last 7 days');
        assert.equal(recent.users[0].createdAt, daysAgo(0.5));
        assert.deepEqual((await service.preview({ type: 'recent', withinDays: 1 })).users.map((u) => u.uid), ['new2']);
        // Progress is shown for any audience while a series is active.
        // Other audiences only read completions when asked (progress placeholders).
        assert.equal(recent.withProgress, false);
        assert.equal(recent.users[0].progress, undefined);
        const recentWithProgress = await service.preview({ type: 'recent' }, { withProgress: true });
        assert.equal(recentWithProgress.withProgress, true);
        assert.equal(recentWithProgress.users[0].progress.percent, 0);
    });

    test('progress audiences need an active series', async () => {
        const { service, firestore } = fixtures();
        firestore.docs.set('bible_series/s1', { ...firestore.docs.get('bible_series/s1'), is_active: false });
        await assert.rejects(service.preview({ type: 'behind' }), (e) => e instanceof NotificationHubError && e.status === 409);
    });

    test('progress is only read when something uses them', async () => {
        const { service } = fixtures();
        let reads = 0;
        const original = service.seriesProgressByUser.bind(service);
        service.seriesProgressByUser = () => { reads += 1; return original(); };

        await service.preview({ type: 'all' });
        await service.preview({ type: 'admins' });
        await service.send({ audience: { type: 'all' }, message: { title: 'Hi {first_name}', body: 'Day 1 of {series_title}' }, dryRun: true });
        assert.equal(reads, 0);

        await service.preview({ type: 'all' }, { withProgress: true });
        await service.send({ audience: { type: 'all' }, message: { title: 'Hi', body: 'You are at {percent}' }, dryRun: true });
        await service.preview({ type: 'behind' });
        assert.equal(reads, 3);
    });

    test('all and admins', async () => {
        const { service } = fixtures();
        const all = await service.preview({ type: 'all' });
        assert.deepEqual(uids(all), ['admin1', 'ahead', 'behind', 'idle', 'onTrack', 'optout']);
        assert.equal(all.deviceCount, 7);
        assert.equal(all.skipped.duplicateTokens, 1);
        const admins = await service.preview({ type: 'admins' });
        assert.deepEqual(uids(admins), ['admin1']);
        assert.equal(admins.deviceCount, 1);
    });

    test('users: all devices, or only the chosen ones', async () => {
        const { service } = fixtures();
        const preview = await service.preview({ type: 'users', users: [{ uid: 'onTrack' }, { uid: 'behind' }] });
        assert.equal(preview.deviceCount, 3);
        assert.equal(preview.userCount, 2);

        const some = await service.resolve({ type: 'users', users: [{ uid: 'onTrack', deviceIds: ['d2', 'nope'] }, 'ghost'] });
        assert.deepEqual(some.recipients, [{ token: 'tok-ontrack-2', uid: 'onTrack', deviceId: 'd2' }]);
        assert.equal(some.skipped.unknownDevices, 1);
        assert.deepEqual(some.skipped.unknownUsers, ['ghost']);
        assert.equal(some.users[0].selectedDevices, true);
        // Deactivated users are still sent to when picked by name.
        assert.equal((await service.preview({ type: 'users', users: ['disabled'] })).deviceCount, 1);
    });

    test('tokens: matched to their owners, masked in the preview', async () => {
        const { service } = fixtures();
        const preview = await service.preview({ type: 'tokens', tokens: 'tok-behind\nunknown-token-123456' });
        assert.equal(preview.deviceCount, 2);
        assert.deepEqual(uids(preview), ['behind']);
        assert.equal(preview.skipped.unmatchedTokens, 1);
        assert.ok(preview.tokens.every((t) => !t.token.startsWith('tok-behind') || t.token.includes('…')));
        assert.equal(JSON.stringify(preview).includes('unknown-token-123456'), false);
    });
});

// ---------- Sending ----------

describe('NotificationHubService.send', () => {
    const message = { title: 'Catch up', body: 'You can do it', data: { notificationType: 'reminder' } };

    test('sends one message per device, records it, and removes dead tokens when asked', async () => {
        const { service, messaging, firestore } = fixtures({ failures: { 'tok-ontrack-1': 'messaging/registration-token-not-registered', 'tok-behind': 'messaging/internal-error' } });
        const result = await service.send({ audience: { type: 'users', users: ['onTrack', 'behind'] }, message, removeInvalidTokens: true }, { actor: 'admin@wpa.church', env: 'dev' });

        assert.equal(messaging.calls.length, 1);
        assert.equal(messaging.calls[0].dryRun, false);
        assert.deepEqual(messaging.calls[0].messages[0], { token: 'tok-ontrack-1', notification: { title: 'Catch up', body: 'You can do it' }, data: { notificationType: 'reminder' } });
        assert.equal(result.sent, 1);
        assert.equal(result.failed, 2);
        assert.deepEqual(result.errors, { 'messaging/registration-token-not-registered': 1, 'messaging/internal-error': 1 });
        assert.equal(result.invalidTokens, 1);
        assert.equal(result.removedDevices, 1);
        assert.equal(firestore.docs.has('users/onTrack/devices/d1'), false);
        assert.equal(firestore.docs.has('users/behind/devices/d1'), true);

        const history = await service.history();
        assert.equal(history.length, 1);
        assert.equal(history[0].title, 'Catch up');
        assert.equal(history[0].sentBy, 'admin@wpa.church');
        assert.equal(history[0].env, 'dev');
        assert.equal(history[0].sent, 1);
        assert.equal(history[0].audienceLabel, '2 chosen users');

        assert.deepEqual(await service.deleteHistory(history[0].id), { deleted: history[0].id, title: 'Catch up' });
        assert.deepEqual(await service.history(), []);
        await assert.rejects(service.deleteHistory(history[0].id), (e) => e.status === 404);
    });

    test('a dry run validates without delivering, removing or recording', async () => {
        const { service, messaging, firestore } = fixtures({ failures: { 'tok-behind': 'messaging/registration-token-not-registered' } });
        const result = await service.send({ audience: { type: 'behind' }, message, dryRun: true, removeInvalidTokens: true });
        assert.equal(messaging.calls[0].dryRun, true);
        assert.equal(result.dryRun, true);
        assert.equal(result.invalidTokens, 1);
        assert.equal(result.removedDevices, 0);
        assert.equal(firestore.docs.has('users/behind/devices/d1'), true);
        assert.deepEqual(await service.history(), []);
    });

    test('token sends keep only masked tokens in the history', async () => {
        const { service, firestore } = fixtures();
        await service.send({ audience: { type: 'tokens', tokens: ['raw-secret-token-abcdef'] }, message });
        const stored = [...firestore.docs.entries()].find(([p]) => p.startsWith('admin_notification_log/'))[1];
        assert.equal(JSON.stringify(stored).includes('raw-secret-token-abcdef'), false);
    });

    test('placeholders are filled in for each recipient', async () => {
        const { service, messaging, directory } = fixtures();
        directory.set('behind', summary('behind', { firstName: 'Bea', name: 'Bea Hind' }));
        await service.send({
            audience: { type: 'tokens', tokens: ['tok-behind', 'stranger-token'] },
            message: { title: 'Hi {first_name|friend}', body: 'You are at {percent} of {series_title}, {percent_behind|0%} behind' },
        });
        const [mine, stranger] = messaging.calls[0].messages;
        assert.deepEqual(mine.notification, { title: 'Hi Bea', body: 'You are at 20% of Romans, 20% behind' });
        assert.deepEqual(stranger.notification, { title: 'Hi friend', body: 'You are at of Romans, 0% behind' });
        // The history keeps the template.
        assert.equal((await service.history())[0].title, 'Hi {first_name|friend}');
    });

    test('series placeholders need an active series', async () => {
        const { service, firestore } = fixtures();
        firestore.docs.set('bible_series/s1', { ...firestore.docs.get('bible_series/s1'), is_active: false });
        await assert.rejects(service.send({ audience: { type: 'admins' }, message: { title: 'Hi', body: '{series_title}' } }), /No series is active/);
        // Without series placeholders, sending doesn't need a series.
        assert.equal((await service.send({ audience: { type: 'admins' }, message: { title: 'Hi {first_name}', body: 'x' } })).sent, 1);
    });

    test('batches of 500 and an empty audience', async () => {
        const { service, messaging } = fixtures();
        const tokens = Array.from({ length: 1201 }, (_, i) => `t${i}`);
        const result = await service.send({ audience: { type: 'tokens', tokens }, message });
        assert.deepEqual(messaging.calls.map((c) => c.messages.length), [500, 500, 201]);
        assert.equal(result.sent, 1201);

        await assert.rejects(service.send({ audience: { type: 'users', users: ['noDevices'] }, message }), /Nobody would receive/);
        await assert.rejects(service.send({ audience: { type: 'admins' }, message: { title: '', body: 'x' } }), /title/);
    });
});

// ---------- Templates ----------

describe('message templates', () => {
    const message = { title: 'Keep going, {first_name|friend}!', body: 'You are {percent} through {series_title}.', data: { notificationType: 'reminder' } };

    test('create, list by name, update and delete', async () => {
        const { service } = fixtures();
        const weekly = await service.createTemplate({ name: '  Weekly   catch-up ', message, audience: { type: 'behind', minBehindPct: 5 } }, { actor: 'ada@wpa.church' });
        assert.equal(weekly.name, 'Weekly catch-up');
        assert.equal(weekly.title, message.title);
        assert.deepEqual(weekly.data, { notificationType: 'reminder' });
        assert.equal(weekly.audience.type, 'behind');
        assert.equal(weekly.audience.minBehindPct, 5);
        assert.equal(weekly.audience.skipOptedOut, true); // defaults filled in
        assert.equal(weekly.createdBy, 'ada@wpa.church');
        assert.ok(weekly.createdAt);
        await service.createTemplate({ name: 'Announcement', message: { title: 'News', body: 'Hello' } });
        assert.deepEqual((await service.listTemplates()).map((t) => t.name), ['Announcement', 'Weekly catch-up']);

        const renamed = await service.updateTemplate(weekly.id, { name: 'Behind reminder', message: { title: 'Hi', body: 'Catch up' }, audience: null }, { actor: 'bo@wpa.church' });
        assert.equal(renamed.name, 'Behind reminder');
        assert.equal(renamed.body, 'Catch up');
        assert.equal(renamed.audience, null);
        assert.equal(renamed.updatedBy, 'bo@wpa.church');
        assert.equal(renamed.createdBy, 'ada@wpa.church');
        // Only the given fields change.
        assert.equal((await service.updateTemplate(weekly.id, { name: 'Behind reminder' })).body, 'Catch up');

        assert.deepEqual(await service.deleteTemplate(weekly.id), { deleted: weekly.id, name: 'Behind reminder' });
        assert.deepEqual((await service.listTemplates()).map((t) => t.name), ['Announcement']);
        await assert.rejects(service.deleteTemplate(weekly.id), (e) => e.status === 404);
    });

    test('validation: names, placeholders and audiences', async () => {
        const { service } = fixtures();
        const first = await service.createTemplate({ name: 'Weekly', message });
        await assert.rejects(service.createTemplate({ name: 'WEEKLY', message }), (e) => e.status === 409);
        // Keeping its own name is fine.
        assert.equal((await service.updateTemplate(first.id, { name: 'weekly' })).name, 'weekly');
        await assert.rejects(service.createTemplate({ name: ' ', message }), /name/);
        await assert.rejects(service.createTemplate({ name: 'x'.repeat(81), message }), /at most 80/);
        await assert.rejects(service.createTemplate({ name: 'Typo', message: { title: 'Hi {fist_name}', body: 'x' } }), /Unknown placeholder/);
        await assert.rejects(service.createTemplate({ name: 'Empty', message: { title: '', body: 'x' } }), /title/);
        await assert.rejects(service.createTemplate({ name: 'Users', message, audience: { type: 'users', users: ['u1'] } }), /group audiences/);
        await assert.rejects(service.createTemplate({ name: 'Bad', message, audience: { type: 'behind', minBehindPct: 500 } }), /percentage points/);
    });
});

// ---------- Routes ----------

async function withServer(getHub, admin, fn) {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.admin = admin; next(); });
    app.use('/api/notifications', createNotificationRouter(getHub));
    const server = app.listen(0);
    try {
        await fn(`http://127.0.0.1:${server.address().port}/api/notifications`);
    } finally {
        server.close();
    }
}

const postJson = (url, json) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(json) });

describe('notification routes', () => {
    test('preview, send, send-test and history', async () => {
        const { service, messaging } = fixtures();
        const admin = { uid: 'admin1', email: 'admin@wpa.church', projectId: 'proj' };
        await withServer(() => ({ service, projectId: 'proj', env: 'dev' }), admin, async (base) => {
            const series = await (await fetch(`${base}/series`)).json();
            assert.equal(series.series.title, 'Romans');
            assert.ok(series.audiences.includes('completed') && series.audiences.includes('recent'));

            const preview = await postJson(`${base}/preview`, { audience: { type: 'ahead' } });
            assert.equal(preview.status, 200);
            assert.equal((await preview.json()).userCount, 1);

            const bad = await postJson(`${base}/preview`, { audience: { type: 'nope' } });
            assert.equal(bad.status, 400);

            const sent = await postJson(`${base}/send`, { audience: { type: 'admins' }, message: { title: 'Hi', body: 'All' } });
            assert.equal((await sent.json()).sent, 1);

            const test = await postJson(`${base}/send-test`, { message: { title: 'Test', body: 'Me' } });
            assert.equal(test.status, 200);
            assert.equal(messaging.calls.at(-1).messages[0].token, 'tok-admin');

            const created = await postJson(`${base}/templates`, { name: 'Weekly', message: { title: 'Hi {first_name}', body: 'Catch up' } });
            assert.equal(created.status, 200);
            const template = await created.json();
            assert.equal(template.createdBy, 'admin@wpa.church');
            const updated = await fetch(`${base}/templates/${template.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Weekly reminder' }) });
            assert.equal((await updated.json()).name, 'Weekly reminder');
            assert.deepEqual((await (await fetch(`${base}/templates`)).json()).map((t) => t.name), ['Weekly reminder']);
            assert.equal((await postJson(`${base}/templates`, { name: 'weekly reminder', message: { title: 'a', body: 'b' } })).status, 409);
            assert.equal((await fetch(`${base}/templates/${template.id}`, { method: 'DELETE' })).status, 200);
            assert.equal((await fetch(`${base}/templates/${template.id}`, { method: 'DELETE' })).status, 404);

            // Test sends aren't recorded.
            const history = await (await fetch(`${base}/history`)).json();
            assert.deepEqual(history.map((h) => h.title), ['Hi']);
            assert.equal((await fetch(`${base}/history/${history[0].id}`, { method: 'DELETE' })).status, 200);
            assert.equal((await fetch(`${base}/history/${history[0].id}`, { method: 'DELETE' })).status, 404);
            assert.deepEqual(await (await fetch(`${base}/history`)).json(), []);
        });

        // An admin signed in to another project has no devices here.
        await withServer(() => ({ service, projectId: 'other', env: 'prod' }), admin, async (base) => {
            const res = await postJson(`${base}/send-test`, { message: { title: 'Test', body: 'Me' } });
            assert.equal(res.status, 409);
        });

        await withServer(() => ({ service: null, projectId: null, env: 'prod' }), admin, async (base) => {
            assert.equal((await fetch(`${base}/series`)).status, 503);
        });
    });
});
