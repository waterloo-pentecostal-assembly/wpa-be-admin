// Notification Hub: ad hoc push notifications (FCM) to a chosen audience.
//
// Audiences (see normalizeAudience):
//   - tokens:      device push tokens pasted in by the admin
//   - users:       chosen users, each with all of their devices or only some
//   - behind:      users whose completion percentage is below what is due
//   - ahead:       users whose completion percentage is above everything up to today
//   - not_started: users with no progress (0%) in the current series
//   - completed:   users who have completed every day of the current series
//   - recent:      users who signed up in the last N days
//   - all:         every user with a registered device
//   - admins:      users with is_admin
//
// Titles and messages can be personalized with placeholders (see
// ui/src/notifications/placeholders.js), filled in per recipient.
//
// A user's devices are the `users/{uid}/devices` documents holding a `token`.
// Progress is measured by day against the active series' schedule (its
// `series_content_snippet`), with days taken in the series time zone: a day
// is complete when at least one of its engagements is, and a user's progress
// is the percentage of the series' days complete, compared with the
// percentage that is due. A user's percentage is read as is from their
// `achievements` document (`series_progress`), which a Cloud Function keeps
// up to date on every completion and resets when a new series starts, so
// it costs one read per user rather than one per completion. Being behind
// or ahead is the gap between it and the expected percentage, in points.
import { DateTime } from 'luxon';
import { SERIES_ZONE, isoDateOf } from './publishedSeries.js';
import { maskToken } from './userAdminService.js';
import { PLACEHOLDERS, findPlaceholders, placeholderValues, renderTemplate, unknownPlaceholders, usesGroup } from '../../ui/src/notifications/placeholders.js';

export const AUDIENCE_TYPES = ['tokens', 'users', 'behind', 'ahead', 'not_started', 'completed', 'recent', 'all', 'admins'];
export const GROUP_AUDIENCES = new Set(['behind', 'ahead', 'not_started', 'completed', 'recent', 'all', 'admins']);
export const PROGRESS_AUDIENCES = new Set(['behind', 'ahead', 'not_started', 'completed']);
const DAY_MS = 24 * 60 * 60 * 1000;
export const HISTORY_COLLECTION = 'admin_notification_log';
export const TEMPLATES_COLLECTION = 'admin_notification_templates';
const MAX_TEMPLATE_NAME = 80;

/** FCM accepts up to 500 messages per sendEach call. */
const SEND_BATCH_SIZE = 500;
/** The notification and data together must fit FCM's 4KB payload limit; leave some room. */
const MAX_PAYLOAD_BYTES = 3800;
const MAX_TOKENS = 5000;
const MAX_PREVIEW_USERS = 500;
/** Errors meaning the token will never work again, so its device can be removed. */
export const INVALID_TOKEN_CODES = new Set([
    'messaging/registration-token-not-registered',
    'messaging/invalid-registration-token',
]);
const RESERVED_DATA_KEY = /^(from|notification|message_type|collapse_key)$|^(google|gcm)\./i;
/** The notification setting users turn off to stop engagement reminders. */
export const REMINDER_SETTING = 'daily_engagement_reminder';

export class NotificationHubError extends Error {
    constructor(message, status = 400) {
        super(message);
        this.name = 'NotificationHubError';
        this.status = status;
    }
}

const fail = (message, status) => { throw new NotificationHubError(message, status); };

function percentagePoints(value, name, fallback) {
    if (value === undefined || value === null || value === '') return fallback;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || n >= 100) fail(`"${name}" must be a number of percentage points from 0 to 99`);
    return n;
}

function wholeDays(value, name, fallback) {
    if (value === undefined || value === null || value === '') return fallback;
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1 || n > 365) fail(`"${name}" must be a whole number of days from 1 to 365`);
    return n;
}

const bool = (value, fallback) => (typeof value === 'boolean' ? value : fallback);

/** Splits pasted tokens on whitespace and commas, dropping blanks and repeats. */
export function parseTokens(input) {
    const list = Array.isArray(input) ? input : String(input ?? '').split(/[\s,]+/);
    return [...new Set(list.map((t) => String(t).trim()).filter(Boolean))];
}

/**
 * Validates an audience from a request and fills in its defaults.
 * Group audiences take `excludeDisabled` (default on: deactivated users and
 * profiles without a sign-in account are skipped) and `skipOptedOut` (skip
 * users who turned off daily engagement reminders; default on for progress
 * audiences, whose messages are reminders).
 */
export function normalizeAudience(input) {
    if (!input || typeof input !== 'object') fail('Choose who to send to');
    const { type } = input;
    if (!AUDIENCE_TYPES.includes(type)) fail(`Unknown audience "${type}"`);

    if (type === 'tokens') {
        const tokens = parseTokens(input.tokens);
        if (!tokens.length) fail('Enter at least one device token');
        if (tokens.length > MAX_TOKENS) fail(`At most ${MAX_TOKENS} tokens can be sent to at once`);
        return { type, tokens };
    }

    if (type === 'users') {
        if (!Array.isArray(input.users) || !input.users.length) fail('Choose at least one user');
        const users = new Map();
        for (const entry of input.users) {
            const uid = typeof entry === 'string' ? entry : entry?.uid;
            if (typeof uid !== 'string' || !uid.trim()) fail('Every chosen user needs a user ID');
            const deviceIds = typeof entry === 'object' && Array.isArray(entry.deviceIds) ? [...new Set(entry.deviceIds.map(String))] : null;
            if (deviceIds && !deviceIds.length) fail('Choose at least one device for each user sent to selected devices, or send to all of their devices');
            users.set(uid.trim(), deviceIds);
        }
        return { type, users: [...users].map(([uid, deviceIds]) => (deviceIds ? { uid, deviceIds } : { uid })) };
    }

    const audience = {
        type,
        excludeDisabled: bool(input.excludeDisabled, true),
        skipOptedOut: bool(input.skipOptedOut, PROGRESS_AUDIENCES.has(type)),
    };
    if (type === 'behind') {
        audience.minBehindPct = percentagePoints(input.minBehindPct, 'minBehindPct', 0);
        audience.includeToday = bool(input.includeToday, false);
        audience.includeNotStarted = bool(input.includeNotStarted, false);
    }
    if (type === 'ahead') audience.minAheadPct = percentagePoints(input.minAheadPct, 'minAheadPct', 0);
    if (type === 'recent') audience.withinDays = wholeDays(input.withinDays, 'withinDays', 7);
    return audience;
}

const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
const gapText = (points) => (points > 0 ? ` by more than ${points} percentage points` : '');

/** A one-line description of an audience, for confirmations and the history. */
export function describeAudience(audience, seriesTitle = 'the current series') {
    switch (audience.type) {
        case 'tokens': return plural(audience.tokens.length, 'device token');
        case 'users': {
            const some = audience.users.filter((u) => u.deviceIds).length;
            return `${plural(audience.users.length, 'chosen user')}${some ? ` (${some} on selected devices only)` : ''}`;
        }
        case 'behind': return `Behind on ${seriesTitle}${gapText(audience.minBehindPct)}${audience.includeToday ? ' (counting today as due)' : ''}${audience.includeNotStarted ? ', including users who haven\'t started' : ''}`;
        case 'ahead': return `Ahead on ${seriesTitle}${gapText(audience.minAheadPct)}`;
        case 'not_started': return `Haven't started ${seriesTitle}`;
        case 'completed': return `Completed ${seriesTitle}`;
        case 'recent': return `Signed up in the last ${plural(audience.withinDays, 'day')}`;
        case 'all': return 'All users';
        case 'admins': return 'Admins';
        default: return audience.type;
    }
}

/**
 * Validates the notification: a title and body, and optional string data
 * (the app reads e.g. `notificationType`). Returns the cleaned message.
 */
export function normalizeMessage(input) {
    const title = String(input?.title ?? '').trim();
    const body = String(input?.body ?? '').trim();
    if (!title) fail('Enter a title');
    if (!body) fail('Enter a message');
    const data = {};
    const rawData = input?.data ?? {};
    if (typeof rawData !== 'object' || Array.isArray(rawData)) fail('Data must be key/value pairs');
    for (const [rawKey, value] of Object.entries(rawData)) {
        const key = String(rawKey).trim();
        if (!key) continue;
        if (RESERVED_DATA_KEY.test(key)) fail(`"${key}" can't be used as a data key (FCM reserves it)`);
        data[key] = String(value ?? '');
    }
    const unknown = unknownPlaceholders(title, body);
    if (unknown.length) {
        fail(`Unknown placeholder${unknown.length === 1 ? '' : 's'} ${unknown.map((k) => `{${k}}`).join(', ')}. Available: ${PLACEHOLDERS.map((p) => `{${p.key}}`).join(', ')}`);
    }
    const message = { title, body, data };
    const bytes = Buffer.byteLength(JSON.stringify(message), 'utf8');
    if (bytes > MAX_PAYLOAD_BYTES) fail(`The notification is too long for a push message (${bytes} of ${MAX_PAYLOAD_BYTES} bytes); shorten it`);
    return message;
}

/** The FCM message for one device, with placeholders filled in from `values`. */
export function buildFcmMessage(token, { title, body, data }, values = null) {
    const message = { token, notification: values ? { title: renderTemplate(title, values), body: renderTemplate(body, values) } : { title, body } };
    if (Object.keys(data ?? {}).length) message.data = data;
    return message;
}

/**
 * The series' content in date order: [{ contentId, date: 'yyyy-MM-dd' }],
 * from its `series_content_snippet`.
 */
export function scheduleFromSnippet(snippet) {
    const schedule = [];
    for (const day of snippet ?? []) {
        const date = isoDateOf(day?.date);
        if (!date) continue;
        for (const { content_id } of day.content_types ?? []) {
            if (content_id) schedule.push({ contentId: content_id, date });
        }
    }
    return schedule.sort((a, b) => a.date.localeCompare(b.date));
}

/** Today as 'yyyy-MM-dd' in the series time zone. */
export function seriesToday(nowMillis) {
    return DateTime.fromMillis(nowMillis, { zone: SERIES_ZONE }).toFormat('yyyy-MM-dd');
}

/**
 * The series' days in date order: [{ date, contentIds }]. A day is every
 * entry (engagement) scheduled on that date.
 */
export function seriesDays(schedule) {
    const days = new Map();
    for (const { contentId, date } of schedule) {
        if (!days.has(date)) days.set(date, new Set());
        days.get(date).add(contentId);
    }
    return [...days].sort(([a], [b]) => a.localeCompare(b)).map(([date, contentIds]) => ({ date, contentIds }));
}

/** How many days are due: dated before today, or up to and including today with `includeToday`. */
export function dueDayCount(days, today, includeToday = false) {
    return days.filter((d) => (includeToday ? d.date <= today : d.date < today)).length;
}

export const percentOf = (part, whole) => (whole ? Math.round((part / whole) * 1000) / 10 : 0);

/** Percentage points, to 0.1 (as percentages are kept), never negative. */
const points = (difference) => Math.max(0, Math.round(difference * 10) / 10);

/**
 * One user's progress through the series, in percentages of its days:
 *   percent         — their progress, as stored in their achievements
 *                     (`series_progress`; 0 if they have none),
 *   expectedPercent — the percentage of days due (before today, or through
 *                     today with `includeToday`),
 *   behindPoints    — percentage points short of expectedPercent,
 *   aheadPoints     — points beyond every day up to and including today.
 * Today's day never makes a user behind unless `includeToday`, and never
 * makes them ahead: between the two they are on track.
 */
export function progressOf(days, percent, { today, includeToday = false }) {
    const totalDays = days.length;
    const progress = Math.min(100, Math.max(0, Number(percent) || 0));
    const expectedPercent = percentOf(dueDayCount(days, today, includeToday), totalDays);
    const expectedThroughToday = percentOf(dueDayCount(days, today, true), totalDays);
    return {
        percent: progress,
        expectedPercent,
        behindPoints: points(expectedPercent - progress),
        aheadPoints: points(progress - expectedThroughToday),
    };
}

/**
 * Whether a user's progress puts them in a progress audience. Behind and
 * ahead need a gap of more than the audience's percentage points (any gap
 * at the default of 0).
 */
export function matchesProgress(progress, audience) {
    const gap = (pts) => pts > 0 && pts > audience[audience.type === 'behind' ? 'minBehindPct' : 'minAheadPct'];
    switch (audience.type) {
        case 'not_started': return progress.percent === 0;
        case 'behind': return gap(progress.behindPoints) && (progress.percent > 0 || audience.includeNotStarted);
        // Users who finished the series are in "completed", not "ahead".
        case 'ahead': return gap(progress.aheadPoints) && progress.percent < 100;
        case 'completed': return progress.percent >= 100;
        default: return false;
    }
}

const userRow = (uid, summary) => ({
    uid,
    name: summary?.name ?? '',
    firstName: summary?.firstName ?? '',
    lastName: summary?.lastName ?? '',
    createdAt: summary?.createdAt ?? null,
    email: summary?.email ?? null,
    disabled: !!summary?.disabled,
    isAdmin: !!summary?.isAdmin,
});

/** The uid and device ID of a `users/{uid}/devices/{id}` document path, or null. */
function devicePath(path) {
    const parts = String(path ?? '').split('/');
    return parts.length === 4 && parts[0] === 'users' && parts[2] === 'devices' ? { uid: parts[1], deviceId: parts[3] } : null;
}

const deviceInfo = (deviceId, data) => ({
    deviceId,
    token: typeof data.token === 'string' && data.token ? data.token : null,
    platform: data.platform ?? data.os ?? data.device_type ?? null,
});

export class NotificationHubService {
    /**
     * @param {import('firebase-admin').firestore.Firestore} firestore
     * @param {import('firebase-admin').messaging.Messaging|null} messaging
     * @param {{ loadDirectory: (options?: { refresh?: boolean }) => Promise<{ users: Map<string, object> }>,
     *   now?: () => number, historyCollection?: string, templatesCollection?: string }} options
     *   `loadDirectory` is the User Manager's merged Auth + profile directory (UserAdminService.loadDirectory).
     */
    constructor(firestore, messaging, {
        loadDirectory, now = () => Date.now(), historyCollection = HISTORY_COLLECTION, templatesCollection = TEMPLATES_COLLECTION, serverTimestamp = () => new Date(),
    } = {}) {
        this.firestore = firestore;
        this.messaging = messaging;
        this.loadDirectory = loadDirectory;
        this.now = now;
        this.historyCollection = historyCollection;
        this.templatesCollection = templatesCollection;
        this.serverTimestamp = serverTimestamp;
    }

    // ---------- Reading the data audiences are built from ----------

    /** The active series and its schedule, or null if no series is active. */
    async currentSeries() {
        const snapshot = await this.firestore.collection('bible_series').where('is_active', '==', true).limit(1).get();
        if (snapshot.empty) return null;
        const doc = snapshot.docs[0];
        const data = doc.data();
        let schedule = scheduleFromSnippet(data.series_content_snippet);
        if (!schedule.length) {
            // Older series may lack a snippet; read the content dates instead.
            const content = await doc.ref.collection('series_content').select('date').get();
            schedule = content.docs
                .map((d) => ({ contentId: d.id, date: isoDateOf(d.data().date) }))
                .filter((e) => e.date)
                .sort((a, b) => a.date.localeCompare(b.date));
        }
        return { id: doc.id, title: data.title || data.name || 'Untitled series', schedule, days: seriesDays(schedule) };
    }

    /** The current series as the hub shows it: dates and how much is due today. */
    async seriesStatus() {
        const series = await this.currentSeries();
        if (!series) return { series: null };
        const today = seriesToday(this.now());
        const { schedule, days } = series;
        const dueDays = dueDayCount(days, today, false);
        const dueDaysIncludingToday = dueDayCount(days, today, true);
        return {
            series: {
                id: series.id,
                title: series.title,
                today,
                startDate: days[0]?.date ?? null,
                endDate: days.at(-1)?.date ?? null,
                totalEntries: schedule.length,
                totalDays: days.length,
                dueDays,
                dueDaysIncludingToday,
                expectedPercent: percentOf(dueDays, days.length),
                expectedPercentIncludingToday: percentOf(dueDaysIncludingToday, days.length),
            },
        };
    }

    /**
     * uid -> percentage of the current series' days complete, from the
     * `achievements` documents (one read per user who has one). Users with
     * none haven't completed anything this series.
     */
    async seriesProgressByUser() {
        const snapshot = await this.firestore.collection('achievements').select('user_id', 'series_progress').get();
        const byUser = new Map();
        snapshot.forEach((doc) => {
            const { user_id: uid, series_progress: percent } = doc.data();
            if (!uid || typeof percent !== 'number') return;
            // Should be one per user; if not, the furthest along wins.
            byUser.set(uid, Math.max(byUser.get(uid) ?? 0, percent));
        });
        return byUser;
    }

    /** uid -> devices, for every user (one collection group read). */
    async allDevices() {
        const snapshot = await this.firestore.collectionGroup('devices').get();
        const byUser = new Map();
        for (const doc of snapshot.docs) {
            const where = devicePath(doc.ref?.path);
            if (!where) continue;
            if (!byUser.has(where.uid)) byUser.set(where.uid, []);
            byUser.get(where.uid).push(deviceInfo(where.deviceId, doc.data()));
        }
        return byUser;
    }

    async userDevices(uid) {
        const snapshot = await this.firestore.collection('users').doc(uid).collection('devices').get();
        return snapshot.docs.map((doc) => deviceInfo(doc.id, doc.data()));
    }

    /** uids of users who turned daily engagement reminders off. */
    async reminderOptOuts() {
        // Filtered here rather than in the query: a collection group filter
        // needs an index the project may not have.
        const snapshot = await this.firestore.collectionGroup('notification_settings').get();
        const uids = new Set();
        for (const doc of snapshot.docs) {
            const parts = String(doc.ref?.path ?? '').split('/');
            if (parts[0] === 'users' && parts[2] === 'notification_settings' && doc.data()[REMINDER_SETTING] === false) uids.add(parts[1]);
        }
        return uids;
    }

    // ---------- Resolving an audience ----------

    /**
     * Works out who an audience reaches. Returns the users, one recipient per
     * distinct token, and how many were skipped and why.
     *
     * Progress (one achievements read per user) is only loaded for progress
     * audiences, which need it to choose users, or with `withProgress`
     * (progress placeholders). The active series itself is one read and is
     * loaded with `withSeries` (series placeholders).
     */
    async resolve(rawAudience, { withSeries = true, withProgress = false } = {}) {
        const audience = normalizeAudience(rawAudience);
        const skipped = { disabled: 0, noAccount: 0, optedOut: 0, noDevices: 0, duplicateTokens: 0, unknownUsers: [], unknownDevices: 0 };
        const users = [];
        const recipients = [];
        const seen = new Set();
        const addRecipient = (token, uid = null, deviceId = null) => {
            if (seen.has(token)) {
                skipped.duplicateTokens += 1;
                return false;
            }
            seen.add(token);
            recipients.push({ token, uid, deviceId });
            return true;
        };

        const progressAudience = PROGRESS_AUDIENCES.has(audience.type);
        const loadProgress = progressAudience || withProgress;
        const series = loadProgress || withSeries ? await this.currentSeries() : null;
        if (progressAudience && !series) fail('No series is active, so progress can\'t be measured. Make a series active first.', 409);
        const today = seriesToday(this.now());
        const includeToday = audience.type === 'behind' && audience.includeToday;
        const percents = series && loadProgress ? await this.seriesProgressByUser() : null;
        const progressFor = (uid) => (percents ? progressOf(series.days, percents.get(uid) ?? 0, { today, includeToday }) : null);
        const row = (uid, summary, extra) => {
            const progress = progressFor(uid);
            return { ...userRow(uid, summary), ...extra, ...(progress && { progress }) };
        };
        const seriesInfo = series && {
            id: series.id,
            title: series.title,
            today,
            totalDays: series.days.length,
            dueDays: dueDayCount(series.days, today, includeToday),
            expectedPercent: percentOf(dueDayCount(series.days, today, includeToday), series.days.length),
        };
        const done = (extra = {}) => this.#result({ audience, users, recipients, skipped, series: seriesInfo, withProgress: !!percents, ...extra });

        if (audience.type === 'tokens') {
            const [directory, devices] = await Promise.all([this.loadDirectory(), this.allDevices()]);
            const owners = new Map();
            for (const [uid, list] of devices) for (const d of list) if (d.token && !owners.has(d.token)) owners.set(d.token, { uid, deviceId: d.deviceId });
            const reached = new Map();
            for (const token of audience.tokens) {
                const owner = owners.get(token);
                addRecipient(token, owner?.uid ?? null, owner?.deviceId ?? null);
                if (owner) reached.set(owner.uid, (reached.get(owner.uid) ?? 0) + 1);
            }
            for (const [uid, count] of reached) users.push(row(uid, directory.users.get(uid), { devices: count }));
            const unmatched = audience.tokens.length - [...reached.values()].reduce((x, y) => x + y, 0);
            return done({ unmatchedTokens: unmatched });
        }

        if (audience.type === 'users') {
            const directory = await this.loadDirectory();
            for (const { uid, deviceIds } of audience.users) {
                const summary = directory.users.get(uid);
                const devices = await this.userDevices(uid);
                if (!summary && !devices.length) {
                    skipped.unknownUsers.push(uid);
                    continue;
                }
                const chosen = deviceIds ? devices.filter((d) => deviceIds.includes(d.deviceId)) : devices;
                if (deviceIds) skipped.unknownDevices += deviceIds.length - chosen.length;
                let count = 0;
                for (const d of chosen) if (d.token && addRecipient(d.token, uid, d.deviceId)) count += 1;
                if (!count) skipped.noDevices += 1;
                users.push(row(uid, summary, { devices: count, selectedDevices: !!deviceIds }));
            }
            return done();
        }

        // Group audiences.
        const [directory, devices, optOuts] = await Promise.all([
            this.loadDirectory(),
            this.allDevices(),
            audience.skipOptedOut ? this.reminderOptOuts() : new Set(),
        ]);
        const signedUpSince = audience.type === 'recent' ? this.now() - audience.withinDays * DAY_MS : null;

        for (const [uid, summary] of directory.users) {
            if (!summary.hasProfile) continue; // devices live on the profile
            if (audience.type === 'admins' && !summary.isAdmin) continue;
            if (audience.type === 'recent' && !(summary.createdAt && Date.parse(summary.createdAt) >= signedUpSince)) continue;
            if (progressAudience && !matchesProgress(progressFor(uid), audience)) continue;
            if (audience.excludeDisabled && !summary.hasAccount) { skipped.noAccount += 1; continue; }
            if (audience.excludeDisabled && summary.disabled) { skipped.disabled += 1; continue; }
            if (audience.skipOptedOut && optOuts.has(uid)) { skipped.optedOut += 1; continue; }
            let count = 0;
            for (const d of devices.get(uid) ?? []) if (d.token && addRecipient(d.token, uid, d.deviceId)) count += 1;
            if (!count) { skipped.noDevices += 1; continue; }
            users.push(row(uid, summary, { devices: count }));
        }

        const byName = (x, y) => (x.name || x.email || '').localeCompare(y.name || y.email || '');
        if (audience.type === 'behind') users.sort((x, y) => y.progress.behindPoints - x.progress.behindPoints || byName(x, y));
        else if (audience.type === 'ahead') users.sort((x, y) => y.progress.aheadPoints - x.progress.aheadPoints || byName(x, y));
        else if (audience.type === 'recent') users.sort((x, y) => (y.createdAt ?? '').localeCompare(x.createdAt ?? ''));
        else users.sort(byName);
        return done();
    }

    #result({ audience, users, recipients, skipped, series = null, withProgress = false, unmatchedTokens = 0 }) {
        return {
            audience,
            label: describeAudience(audience, series?.title),
            series,
            withProgress,
            users,
            recipients,
            skipped: { ...skipped, unmatchedTokens },
        };
    }

    /**
     * What sending to an audience would do, without sending. Tokens are
     * masked. Users' progress is included for progress audiences, or with
     * `withProgress` (the message uses progress placeholders).
     */
    async preview(rawAudience, { withProgress = false } = {}) {
        const resolved = await this.resolve(rawAudience, { withProgress });
        const { audience, label, series, users, recipients, skipped } = resolved;
        return {
            audience: maskedAudience(audience),
            label,
            series,
            withProgress: resolved.withProgress,
            userCount: users.length,
            deviceCount: recipients.length,
            skipped,
            users: users.slice(0, MAX_PREVIEW_USERS),
            truncated: users.length > MAX_PREVIEW_USERS,
            ...(audience.type === 'tokens' && { tokens: recipients.map((r) => ({ token: maskToken(r.token), uid: r.uid })) }),
        };
    }

    // ---------- Sending ----------

    /**
     * Sends the message to every recipient of the audience. With `dryRun`,
     * FCM validates each message without delivering it. With
     * `removeInvalidTokens`, devices whose token FCM reports as no longer
     * registered are deleted (never on a dry run).
     * Real sends are recorded in the history unless `record` is false.
     */
    async send({ audience: rawAudience, message: rawMessage, dryRun = false, removeInvalidTokens = false, record = true } = {}, { actor = null, env = null } = {}) {
        if (!this.messaging) fail('Push messaging is not available for this environment', 503);
        const message = normalizeMessage(rawMessage);
        const needsProgress = usesGroup('progress', message.title, message.body);
        const needsSeries = needsProgress || usesGroup('series', message.title, message.body);
        const resolved = await this.resolve(rawAudience, { withSeries: needsSeries, withProgress: needsProgress });
        const { recipients } = resolved;
        if (!recipients.length) fail('Nobody would receive this: the audience has no devices with push tokens', 409);
        if (needsSeries && !resolved.series) fail('No series is active, so the series and progress placeholders can\'t be filled in', 409);

        // Each recipient's placeholder values, by uid (tokens with no known owner get only the series values).
        const personalized = findsPlaceholders(message);
        const usersByUid = new Map(resolved.users.map((u) => [u.uid, u]));
        const valuesFor = (uid) => {
            const user = uid ? usersByUid.get(uid) : null;
            return placeholderValues({ user, progress: user?.progress ?? null, series: resolved.series });
        };

        const result = { sent: 0, failed: 0, errors: {}, invalid: [], removedDevices: 0 };
        for (let i = 0; i < recipients.length; i += SEND_BATCH_SIZE) {
            const batch = recipients.slice(i, i + SEND_BATCH_SIZE);
            let response;
            try {
                response = await this.messaging.sendEach(batch.map((r) => buildFcmMessage(r.token, message, personalized ? valuesFor(r.uid) : null)), !!dryRun);
            } catch (error) {
                // The whole batch failed (e.g. credentials); count it and stop.
                result.failed += recipients.length - i;
                const code = error.code ?? error.errorInfo?.code ?? 'error';
                result.errors[code] = (result.errors[code] ?? 0) + recipients.length - i;
                result.aborted = error.message;
                break;
            }
            response.responses.forEach((r, index) => {
                if (r.success) {
                    result.sent += 1;
                    return;
                }
                result.failed += 1;
                const code = r.error?.code ?? r.error?.errorInfo?.code ?? 'unknown';
                result.errors[code] = (result.errors[code] ?? 0) + 1;
                if (INVALID_TOKEN_CODES.has(code)) result.invalid.push(batch[index]);
            });
        }

        if (removeInvalidTokens && !dryRun) {
            for (const { uid, deviceId } of result.invalid) {
                if (!uid || !deviceId) continue;
                try {
                    await this.firestore.collection('users').doc(uid).collection('devices').doc(deviceId).delete();
                    result.removedDevices += 1;
                } catch (error) {
                    console.error(`Could not remove device ${deviceId} of ${uid}:`, error.message);
                }
            }
        }

        const summary = {
            dryRun: !!dryRun,
            label: resolved.label,
            series: resolved.series,
            userCount: resolved.users.length,
            deviceCount: recipients.length,
            skipped: resolved.skipped,
            sent: result.sent,
            failed: result.failed,
            errors: result.errors,
            invalidTokens: result.invalid.length,
            removedDevices: result.removedDevices,
            ...(result.aborted && { aborted: result.aborted }),
        };

        if (record && !dryRun) {
            try {
                const ref = await this.firestore.collection(this.historyCollection).add({
                    created_at: this.serverTimestamp(),
                    sent_by: actor,
                    env,
                    title: message.title,
                    body: message.body,
                    data: message.data,
                    audience: maskedAudience(resolved.audience),
                    audience_label: resolved.label,
                    series_id: resolved.series?.id ?? null,
                    user_count: summary.userCount,
                    device_count: summary.deviceCount,
                    sent: summary.sent,
                    failed: summary.failed,
                    errors: summary.errors,
                    removed_devices: summary.removedDevices,
                });
                summary.historyId = ref.id;
            } catch (error) {
                console.error('Could not record the notification in the history:', error);
                summary.historyError = error.message;
            }
        }
        return summary;
    }

    /** The most recent sends, newest first. */
    async history({ limit = 25 } = {}) {
        const n = Math.min(Math.max(1, Number(limit) || 25), 100);
        const snapshot = await this.firestore.collection(this.historyCollection).orderBy('created_at', 'desc').limit(n).get();
        return snapshot.docs.map((doc) => {
            const d = doc.data();
            return {
                id: doc.id,
                createdAt: isoTime(d.created_at),
                sentBy: d.sent_by ?? null,
                env: d.env ?? null,
                title: d.title ?? '',
                body: d.body ?? '',
                data: d.data ?? {},
                audience: d.audience ?? null,
                audienceLabel: d.audience_label ?? '',
                userCount: d.user_count ?? 0,
                deviceCount: d.device_count ?? 0,
                sent: d.sent ?? 0,
                failed: d.failed ?? 0,
                errors: d.errors ?? {},
                removedDevices: d.removed_devices ?? 0,
            };
        });
    }

    /** Deletes one send from the history (the notifications themselves were already delivered). */
    async deleteHistory(id) {
        if (typeof id !== 'string' || !id.trim()) fail('A history ID is required');
        const ref = this.firestore.collection(this.historyCollection).doc(id);
        const snapshot = await ref.get();
        if (!snapshot.exists) fail('That send is no longer in the history', 404);
        const title = snapshot.data().title ?? '';
        await ref.delete();
        return { deleted: id, title };
    }

    // ---------- Saved message templates ----------

    templates() {
        return this.firestore.collection(this.templatesCollection);
    }

    /** Every saved template, by name. */
    async listTemplates() {
        const snapshot = await this.templates().orderBy('name_lower').get();
        return snapshot.docs.map((doc) => templateJson(doc.id, doc.data()));
    }

    async #requireTemplate(id) {
        if (typeof id !== 'string' || !id.trim()) fail('A template ID is required');
        const snapshot = await this.templates().doc(id).get();
        if (!snapshot.exists) fail('That template no longer exists', 404);
        return snapshot.data();
    }

    /** A trimmed name that no other template has (names are compared ignoring case). */
    async #checkName(rawName, exceptId = null) {
        const name = String(rawName ?? '').trim().replace(/\s+/g, ' ');
        if (!name) fail('Give the template a name');
        if (name.length > MAX_TEMPLATE_NAME) fail(`Template names can be at most ${MAX_TEMPLATE_NAME} characters`);
        const same = await this.templates().where('name_lower', '==', name.toLowerCase()).get();
        if (same.docs.some((doc) => doc.id !== exceptId)) fail(`There is already a template called "${name}"`, 409);
        return name;
    }

    /**
     * Saves a message (placeholders and all) as a template. `audience`, if
     * given, must be a group audience (behind, all, …): lists of users or
     * tokens aren't saved, as they go out of date.
     */
    async createTemplate({ name, message, audience = null } = {}, { actor = null } = {}) {
        const clean = normalizeMessage(message);
        const checkedName = await this.#checkName(name);
        const now = this.serverTimestamp();
        const ref = await this.templates().add({
            name: checkedName,
            name_lower: checkedName.toLowerCase(),
            ...clean,
            audience: templateAudience(audience),
            created_at: now,
            created_by: actor,
            updated_at: now,
            updated_by: actor,
        });
        return templateJson(ref.id, (await this.templates().doc(ref.id).get()).data());
    }

    /** Changes a template's name, message and/or audience (`audience: null` removes it). */
    async updateTemplate(id, { name, message, audience } = {}, { actor = null } = {}) {
        await this.#requireTemplate(id);
        const patch = { updated_at: this.serverTimestamp(), updated_by: actor };
        if (name !== undefined) {
            patch.name = await this.#checkName(name, id);
            patch.name_lower = patch.name.toLowerCase();
        }
        if (message !== undefined) Object.assign(patch, normalizeMessage(message));
        if (audience !== undefined) patch.audience = templateAudience(audience);
        await this.templates().doc(id).update(patch);
        return templateJson(id, (await this.templates().doc(id).get()).data());
    }

    async deleteTemplate(id) {
        const { name } = await this.#requireTemplate(id);
        await this.templates().doc(id).delete();
        return { deleted: id, name };
    }
}

/** A Firestore timestamp (or Date or string) as an ISO string, or null. */
function isoTime(value) {
    const date = value?.toDate?.() ?? (value ? new Date(value) : null);
    return date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
}

/** A template's saved audience: a validated group audience, or null. */
function templateAudience(audience) {
    if (audience === null || audience === undefined) return null;
    const clean = normalizeAudience(audience);
    if (!GROUP_AUDIENCES.has(clean.type)) fail('Only group audiences (such as "Behind on series") can be saved with a template, not lists of users or tokens');
    return clean;
}

function templateJson(id, d) {
    return {
        id,
        name: d.name ?? '',
        title: d.title ?? '',
        body: d.body ?? '',
        data: d.data ?? {},
        audience: d.audience ?? null,
        createdAt: isoTime(d.created_at),
        createdBy: d.created_by ?? null,
        updatedAt: isoTime(d.updated_at),
        updatedBy: d.updated_by ?? null,
    };
}

/** Whether the title or body uses any placeholder. */
function findsPlaceholders({ title, body }) {
    return [...findPlaceholders(title), ...findPlaceholders(body)].some((p) => p.known);
}

/** The audience with raw tokens masked, as shown in previews and stored in the history. */
function maskedAudience(audience) {
    return audience.type === 'tokens' ? { type: 'tokens', tokens: audience.tokens.map(maskToken) } : audience;
}
