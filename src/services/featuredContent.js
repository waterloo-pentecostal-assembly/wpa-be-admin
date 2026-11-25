// Featured content for the app's home screen, in the `featured_content`
// collection. Each document has a `type`, its type's fields, and the days it
// shows:
//
//   type: 'verse'                    a verse with a note
//     passage_id: 'PHP.4.6-PHP.4.7'  API.Bible passage ID (one continuous passage)
//     reference: 'Philippians 4:6-7' how it reads, for display
//     note: '...'                    '' when there is none
//
//   type: 'pastors_encouragement'    a short message from a pastor
//     author_uid: 'abc123'           the pastor: a user tagged is_pastor in User Manager
//                                    (their name isn't copied here; read it from users/{author_uid})
//     title: '...'                   '' when there is none
//     body: '...'                    the message
//     passage_id, reference          an optional passage ('' when none)
//
//   start_date: Timestamp            first day, 00:00 America/Toronto
//   end_date: Timestamp              last day, 23:59:59.999 America/Toronto
//   created_at, created_by, updated_at, updated_by
//
// Authors are always pastors: users whose profile (users/{uid}) has
// is_pastor: true. Text is plain text; line breaks are kept. Items of any
// type can overlap, but at most MAX_CONCURRENT are featured at any moment: the ones with
// start_date <= now <= end_date.

import { DateTime } from 'luxon';
import { SERIES_ZONE } from './publishedSeries.js';

export const FEATURED_COLLECTION = 'featured_content';
export const MAX_CONCURRENT = 5;
export const MAX_RANGE_DAYS = 366;
export const MAX_REFERENCE_LENGTH = 100;
export const MAX_TITLE_LENGTH = 120;

/** Each type's label and text limits (in characters). */
export const FEATURED_TYPES = {
    verse: { label: 'Verse with note', maxBody: 1000 },
    pastors_encouragement: { label: 'Pastor’s encouragement', maxBody: 2000 },
};

// BOOK.CHAPTER.VERSE, or a range of them within one book (API.Bible passage IDs).
const VERSE_ID = '([1-4A-Z]{3})\\.(\\d+)\\.(\\d+)';
const PASSAGE_ID = new RegExp(`^${VERSE_ID}(?:-${VERSE_ID})?$`);

export class FeaturedContentError extends Error {
    constructor(message, status = 400, details = null) {
        super(message);
        this.status = status;
        this.details = details;
    }
}

/** 'yyyy-MM-dd' -> DateTime at the start of that day in the app's time zone. */
function day(value, label) {
    const date = DateTime.fromFormat(typeof value === 'string' ? value : '', 'yyyy-MM-dd', { zone: SERIES_ZONE });
    if (!date.isValid) throw new FeaturedContentError(`${label} must be a date (YYYY-MM-DD)`);
    return date;
}

/** Timestamp -> 'yyyy-MM-dd' in the app's time zone ('' if not a timestamp). */
export function dayOf(timestamp) {
    const millis = timestamp?.toMillis?.();
    return typeof millis === 'number' ? DateTime.fromMillis(millis, { zone: SERIES_ZONE }).toFormat('yyyy-MM-dd') : '';
}

/** Throws unless `id` is an API.Bible passage ID for verses (e.g. JHN.3.16 or PHP.4.6-PHP.4.7). */
export function checkPassageId(id) {
    const match = PASSAGE_ID.exec(typeof id === 'string' ? id.trim() : '');
    if (!match) throw new FeaturedContentError('passage_id must be an API.Bible passage ID such as JHN.3.16 or PHP.4.6-PHP.4.7');
    const [, book, chapter, verse, endBook, endChapter, endVerse] = match;
    if (endBook) {
        if (endBook !== book) throw new FeaturedContentError('The passage must be within one book');
        const order = Number(chapter) - Number(endChapter) || Number(verse) - Number(endVerse);
        if (order > 0) throw new FeaturedContentError('The passage ends before it starts');
    }
    return id.trim();
}

/** A trimmed text field: '' if absent; 400 if not text, too long, or required and empty. */
function text(input, key, label, { max, required = false }) {
    const value = input?.[key];
    if (value !== undefined && value !== null && typeof value !== 'string') throw new FeaturedContentError(`${label} must be text`);
    const trimmed = (value ?? '').trim();
    if (required && !trimmed) throw new FeaturedContentError(`${label} is required`);
    if (trimmed.length > max) throw new FeaturedContentError(`${label} can be at most ${max} characters`);
    return trimmed;
}

/** { passage_id, reference }: required for verses, optional ('' and '') otherwise. */
function passage(input, required) {
    const id = typeof input?.passage_id === 'string' ? input.passage_id.trim() : '';
    if (!id && !required) return { passage_id: '', reference: '' };
    return {
        passage_id: checkPassageId(input?.passage_id),
        reference: text(input, 'reference', 'The reference (e.g. "Philippians 4:6-7")', { max: MAX_REFERENCE_LENGTH, required: true }),
    };
}

/** "First Last" from a users/{uid} profile ('' if it has no name). */
const profileName = (profile) => `${profile?.first_name ?? ''} ${profile?.last_name ?? ''}`.trim();

/** The type-specific fields to store for `input.type` (without the author). */
function typeFields(input) {
    const { type } = input ?? {};
    const spec = FEATURED_TYPES[type];
    if (!spec) throw new FeaturedContentError(`type must be one of ${Object.keys(FEATURED_TYPES).join(', ')}`);
    switch (type) {
        case 'verse':
            return { ...passage(input, true), note: text(input, 'note', 'The note', { max: spec.maxBody }) };
        case 'pastors_encouragement':
            return {
                title: text(input, 'title', 'The title', { max: MAX_TITLE_LENGTH }),
                body: text(input, 'body', 'The message', { max: spec.maxBody, required: true }),
                ...passage(input, false),
            };
        default:
            throw new FeaturedContentError(`Unknown type ${type}`);
    }
}

/** How an item reads in messages: its title, reference or type. */
export function featuredLabel(item) {
    return item.title || item.reference || FEATURED_TYPES[item.type]?.label || item.type || 'Featured item';
}

/**
 * The moment within [start, end] when the most of `items` show at once:
 * { count, at, items } (count 0 if none overlap). Ranges include both ends.
 */
export function busiest(items, start, end) {
    const events = [];
    for (const item of items) {
        const from = Math.max(start, item.start_date.toMillis());
        const to = Math.min(end, item.end_date.toMillis());
        if (from <= to) events.push([from, 1, item], [to, -1, item]);
    }
    // Starts before ends at the same moment: both ends are included.
    events.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
    const open = new Set();
    let best = { count: 0, at: null, items: [] };
    for (const [at, change, item] of events) {
        if (change < 0) {
            open.delete(item);
        } else {
            open.add(item);
            if (open.size > best.count) best = { count: open.size, at, items: [...open] };
        }
    }
    return best;
}

const NOT_CONTENT = new Set(['id', 'type', 'created_by', 'updated_by']);

export class FeaturedContentService {
    /**
     * @param {import('firebase-admin').firestore.Firestore} firestore
     * @param {{ serverTimestamp: () => unknown, timestamp: (millis: number) => import('firebase-admin').firestore.Timestamp, now?: () => number }} options
     */
    constructor(firestore, { serverTimestamp, timestamp, now = () => Date.now() }) {
        this.firestore = firestore;
        this.serverTimestamp = serverTimestamp;
        this.timestamp = timestamp;
        this.now = now;
    }

    #collection() {
        return this.firestore.collection(FEATURED_COLLECTION);
    }

    /**
     * Pastors who can be picked as an author: [{ uid, name }] by name. Users
     * tagged is_pastor whose profile has no name are left out (there would be
     * nothing to show in the app).
     */
    async listAuthors() {
        const snapshot = await this.firestore.collection('users').where('is_pastor', '==', true).get();
        return snapshot.docs
            .map((doc) => ({ uid: doc.id, name: profileName(doc.data()) }))
            .filter((author) => author.name)
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    }

    /**
     * { author_uid } for `input.author_uid`: a user tagged as a pastor,
     * with a name. Only the uid is stored, so a name change shows everywhere
     * without touching the items. An edit may keep the item's author even if
     * they're no longer tagged. Types without an author get none.
     */
    async #author(input, existing) {
        if (input.type !== 'pastors_encouragement') return {};
        const uid = typeof input.author_uid === 'string' ? input.author_uid.trim() : '';
        if (!uid) throw new FeaturedContentError('Pick the pastor this is from');
        if (existing?.author_uid === uid) return { author_uid: uid };
        const doc = await this.firestore.collection('users').doc(uid).get();
        const profile = doc.exists ? doc.data() : null;
        if (profile?.is_pastor !== true) throw new FeaturedContentError('The author must be a user tagged as a pastor in User Manager');
        if (!profileName(profile)) throw new FeaturedContentError('This pastor’s profile has no name; add one in User Manager first');
        return { author_uid: uid };
    }

    /** uid -> current profile name ('' if the user or their name is gone) for the items' authors. */
    async #authorNames(items) {
        const uids = [...new Set(items.map((item) => item.author_uid).filter((uid) => typeof uid === 'string' && uid))];
        const docs = await Promise.all(uids.map((uid) => this.firestore.collection('users').doc(uid).get()));
        return new Map(docs.map((doc, i) => [uids[i], doc.exists ? profileName(doc.data()) : '']));
    }

    /** Checks a featured item from the console and returns the fields to store (without the audit fields). */
    async fields(input, existing = null) {
        const start = day(input?.start, 'The start date');
        const end = day(input?.end, 'The end date');
        if (end < start) throw new FeaturedContentError('The end date is before the start date');
        const days = end.diff(start, 'days').days + 1;
        if (days > MAX_RANGE_DAYS) throw new FeaturedContentError(`Featured content can run for at most ${MAX_RANGE_DAYS} days`);
        return {
            type: input.type,
            ...typeFields(input),
            ...(await this.#author(input, existing)),
            start_date: this.timestamp(start.toMillis()),
            end_date: this.timestamp(end.endOf('day').toMillis()),
        };
    }

    /** All featured items as stored (any type, including ones this console doesn't know), latest first. */
    async #items() {
        const snapshot = await this.#collection().get();
        return snapshot.docs
            .map((doc) => ({ id: doc.id, ...doc.data() }))
            .filter((item) => item.start_date?.toMillis && item.end_date?.toMillis)
            .sort((a, b) => b.start_date.toMillis() - a.start_date.toMillis());
    }

    /** Featured items for the console: { id, type, ...its fields, start, end, status: 'current'|'upcoming'|'past', ... }. */
    async list() {
        const now = this.now();
        const items = await this.#items();
        const names = await this.#authorNames(items);
        return items.map((item) => this.#toJson(item, names, now));
    }

    /** `author` is the author's current name, looked up for the console (never stored). */
    #toJson(item, names, now = this.now()) {
        const status = item.end_date.toMillis() < now ? 'past' : item.start_date.toMillis() > now ? 'upcoming' : 'current';
        // The type's text fields (whatever they are, so unknown types still list).
        const content = Object.fromEntries(Object.entries(item).filter(([key, value]) => typeof value === 'string' && !NOT_CONTENT.has(key)));
        return {
            id: item.id,
            type: item.type ?? '',
            ...content,
            ...(item.author_uid ? { author: names.get(item.author_uid) ?? '' } : {}),
            start: dayOf(item.start_date),
            end: dayOf(item.end_date),
            status,
            created_by: item.created_by ?? null,
            updated_by: item.updated_by ?? null,
            updated_at: item.updated_at?.toMillis?.() ?? null,
        };
    }

    /** 409 if adding `fields` would make more than MAX_CONCURRENT items show at once. */
    async #checkRoom(fields, exceptId = null) {
        const others = (await this.#items()).filter((item) => item.id !== exceptId);
        const peak = busiest(others, fields.start_date.toMillis(), fields.end_date.toMillis());
        if (peak.count < MAX_CONCURRENT) return;
        const names = peak.items.map((item) => `${featuredLabel(item)} (${dayOf(item.start_date)} to ${dayOf(item.end_date)})`);
        throw new FeaturedContentError(
            `${MAX_CONCURRENT} items are already featured on ${dayOf(this.timestamp(peak.at))}: ${names.join('; ')}. At most ${MAX_CONCURRENT} can show at once.`,
            409,
            { conflictIds: peak.items.map((item) => item.id), day: dayOf(this.timestamp(peak.at)) },
        );
    }

    /** Adds a featured item; returns it as list() does. */
    async create(input, actor = null) {
        const fields = await this.fields(input);
        await this.#checkRoom(fields);
        const ref = this.#collection().doc();
        const stamp = this.serverTimestamp();
        await ref.set({ ...fields, created_at: stamp, created_by: actor, updated_at: stamp, updated_by: actor });
        const item = { id: ref.id, ...fields, created_by: actor, updated_by: actor };
        return this.#toJson(item, await this.#authorNames([item]));
    }

    /** Replaces a featured item's dates and content. Its type can't change. */
    async update(id, input, actor = null) {
        const ref = this.#collection().doc(id);
        const doc = await ref.get();
        if (!doc.exists) throw new FeaturedContentError('Featured item not found', 404);
        const existing = doc.data();
        if (input?.type !== existing.type) {
            throw new FeaturedContentError(`This item is a ${FEATURED_TYPES[existing.type]?.label ?? existing.type}; its type can't be changed`);
        }
        const fields = await this.fields(input, existing);
        await this.#checkRoom(fields, id);
        // Replaced whole (keeping who created it), so fields no longer used don't linger.
        const { created_at = null, created_by = null } = existing;
        await ref.set({ ...fields, created_at, created_by, updated_at: this.serverTimestamp(), updated_by: actor });
        const item = { id, ...fields, created_by, updated_by: actor };
        return this.#toJson(item, await this.#authorNames([item]));
    }

    async remove(id) {
        const ref = this.#collection().doc(id);
        const doc = await ref.get();
        if (!doc.exists) throw new FeaturedContentError('Featured item not found', 404);
        await ref.delete();
    }
}
