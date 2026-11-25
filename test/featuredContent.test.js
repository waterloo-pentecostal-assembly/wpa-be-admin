import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { memoryFirestore } from './helpers/memoryFirestore.js';
import { FeaturedContentService, MAX_CONCURRENT, checkPassageId, dayOf } from '../src/services/featuredContent.js';
import { contentTimestamp } from '../src/services/publishedSeries.js';
import { createFeaturedRouter } from '../src/routes/featuredRoutes.js';
import { featuredPassage } from '../ui/src/featured/passageId.js';
import { busiestDay } from '../ui/src/featured/schedule.js';
import admin from 'firebase-admin';

const NOW = contentTimestamp('2026-11-24').toMillis() + 12 * 3600 * 1000; // noon, Nov 24 (Toronto)

/** A fake Firestore with a pastor (Dave Smith), a member and a nameless pastor. */
function withUsers(firestore = memoryFirestore()) {
    firestore.store.set('users/pastor1', { first_name: 'Dave', last_name: 'Smith', is_pastor: true });
    firestore.store.set('users/pastor2', { first_name: 'Anna', last_name: 'Lee', is_pastor: true });
    firestore.store.set('users/member', { first_name: 'Mary', last_name: 'Jones', is_pastor: false });
    firestore.store.set('users/nameless', { is_pastor: true });
    return firestore;
}

function service(firestore = withUsers()) {
    return new FeaturedContentService(firestore, {
        serverTimestamp: () => 'SERVER_TIME',
        timestamp: (millis) => admin.firestore.Timestamp.fromMillis(millis),
        now: () => NOW,
    });
}

const verse = (start, end, extra = {}) => ({ type: 'verse', start, end, passage_id: 'PHP.4.6-PHP.4.7', reference: 'Philippians 4:6-7', note: 'Pray first.', ...extra });
const encouragement = (start, end, extra = {}) => ({ type: 'pastors_encouragement', start, end, author_uid: 'pastor1', title: '', body: 'Keep going.', ...extra });

describe('featured content', () => {
    test('stores the passage, note and whole days in Toronto time', async () => {
        const firestore = memoryFirestore();
        const created = await service(firestore).create(verse('2026-11-22', '2026-11-28'), 'uid-1');
        assert.equal(created.status, 'current');
        const doc = firestore.store.get(`featured_content/${created.id}`);
        assert.equal(doc.type, 'verse');
        assert.equal(doc.passage_id, 'PHP.4.6-PHP.4.7');
        assert.equal(doc.reference, 'Philippians 4:6-7');
        assert.equal(doc.note, 'Pray first.');
        assert.equal(doc.start_date.toDate().toISOString(), '2026-11-22T05:00:00.000Z');
        assert.equal(doc.end_date.toDate().toISOString(), '2026-11-29T04:59:59.999Z');
        assert.equal(dayOf(doc.end_date), '2026-11-28');
        assert.deepEqual([doc.created_by, doc.updated_by, doc.created_at], ['uid-1', 'uid-1', 'SERVER_TIME']);
    });

    test('lists latest first with current / upcoming / past', async () => {
        const s = service();
        await s.create(verse('2026-11-01', '2026-11-07'));
        await s.create(verse('2026-11-22', '2026-11-24'));
        await s.create(verse('2026-12-01', '2026-12-31', { note: '' }));
        const list = await s.list();
        assert.deepEqual(list.map((v) => [v.start, v.end, v.status]), [
            ['2026-12-01', '2026-12-31', 'upcoming'],
            ['2026-11-22', '2026-11-24', 'current'],
            ['2026-11-01', '2026-11-07', 'past'],
        ]);
    });

    test('up to 5 items of any type can show at once', async () => {
        assert.equal(MAX_CONCURRENT, 5);
        const s = service();
        const first = await s.create(verse('2026-11-22', '2026-11-28'));
        await s.create(verse('2026-11-24', '2026-11-30', { passage_id: 'JHN.3.16', reference: 'John 3:16' }));
        await s.create(encouragement('2026-11-20', '2026-11-25'));
        await s.create(encouragement('2026-11-26', '2026-12-05'));
        await s.create(verse('2026-11-28', '2026-11-28'));
        // Nov 28 now has 4 (first, John 3:16, the Nov 26 encouragement, the one-day verse); one more fits there, but not on the same days twice.
        await s.create(encouragement('2026-11-28', '2026-12-01'));
        await assert.rejects(s.create(verse('2026-11-01', '2026-11-28')), (e) => e.status === 409
            && e.details.day === '2026-11-28' && e.details.conflictIds.length === 5 && /2026-11-28/.test(e.message));
        // The day after the busy one is fine, and so is a range that only touches 4 at a time.
        await s.create(verse('2026-11-29', '2026-11-29'));
        await s.create(verse('2026-11-01', '2026-11-27'));
        // An edit doesn't count the item against itself, but can't move into a full day.
        await s.update(first.id, verse('2026-11-21', '2026-11-28', { note: 'Edited' }), 'uid-2');
        await s.create(encouragement('2026-11-25', '2026-11-25')); // the 5th on Nov 25
        await assert.rejects(s.create(encouragement('2026-11-25', '2026-11-25')), (e) => e.status === 409);
        const later = await s.create(encouragement('2026-12-10', '2026-12-12'));
        await assert.rejects(s.update(later.id, encouragement('2026-11-28', '2026-12-12')), (e) => e.status === 409);
        const list = await s.list();
        assert.equal(list.filter((item) => item.status === 'current').length, 4); // Nov 24: A, B, C and the Nov 1-27 verse
    });

    test('pastor\'s encouragements', async () => {
        const firestore = withUsers();
        const s = service(firestore);
        const enc = await s.create(encouragement('2026-11-22', '2026-11-28', { title: ' You are not alone ', body: 'Line one\nLine two', passage_id: '', reference: 'ignored' }), 'uid-1');
        assert.deepEqual(firestore.store.get(`featured_content/${enc.id}`), {
            ...firestore.store.get(`featured_content/${enc.id}`),
            type: 'pastors_encouragement', author_uid: 'pastor1', title: 'You are not alone', body: 'Line one\nLine two', passage_id: '', reference: '',
        });
        assert.equal('note' in firestore.store.get(`featured_content/${enc.id}`), false);
        assert.equal('author' in firestore.store.get(`featured_content/${enc.id}`), false, 'only the uid is stored');
        const dev = await s.create(encouragement('2026-11-22', '2026-11-28', { title: 'Rest', passage_id: 'MAT.11.28-MAT.11.30', reference: 'Matthew 11:28-30' }));
        assert.deepEqual([dev.type, dev.title, dev.author, dev.passage_id, dev.reference, dev.status],
            ['pastors_encouragement', 'Rest', 'Dave Smith', 'MAT.11.28-MAT.11.30', 'Matthew 11:28-30', 'current']);
        // Edits replace every field, so a removed passage is cleared.
        await s.update(dev.id, encouragement('2026-11-22', '2026-11-28', { body: 'New' }));
        const stored = firestore.store.get(`featured_content/${dev.id}`);
        assert.deepEqual([stored.body, stored.passage_id, stored.reference], ['New', '', '']);
        await assert.rejects(s.update(dev.id, verse('2026-11-22', '2026-11-28')), (e) => e.status === 400 && /can't be changed/.test(e.message));
        const bad = [
            encouragement('2026-11-22', '2026-11-28', { author_uid: ' ' }),
            encouragement('2026-11-22', '2026-11-28', { author_uid: 'member' }),
            encouragement('2026-11-22', '2026-11-28', { author_uid: 'nobody' }),
            encouragement('2026-11-22', '2026-11-28', { author_uid: 'nameless' }),
            encouragement('2026-11-22', '2026-11-28', { body: '' }),
            encouragement('2026-11-22', '2026-11-28', { body: 'x'.repeat(2001) }),
            encouragement('2026-11-22', '2026-11-28', { title: 'x'.repeat(121) }),
            encouragement('2026-11-22', '2026-11-28', { passage_id: 'MAT.11.28', reference: '' }),
            encouragement('2026-11-22', '2026-11-28', { passage_id: 'Matthew 11' }),
            { ...encouragement('2026-11-22', '2026-11-28'), type: 'devotional' },
            { ...encouragement('2026-11-22', '2026-11-28'), type: undefined },
        ];
        for (const input of bad) await assert.rejects(s.create(input), (e) => e.status === 400, JSON.stringify(input).slice(0, 120));
        await s.create(encouragement('2026-11-22', '2026-11-28', { body: 'x'.repeat(2000) }));
    });

    test('authors are users tagged as pastors', async () => {
        const firestore = withUsers();
        const s = service(firestore);
        assert.deepEqual(await s.listAuthors(), [{ uid: 'pastor2', name: 'Anna Lee' }, { uid: 'pastor1', name: 'Dave Smith' }]);
        const other = await s.create(encouragement('2026-11-22', '2026-11-28', { author_uid: 'pastor2', author: 'Someone else' }));
        assert.deepEqual([other.author_uid, other.author], ['pastor2', 'Anna Lee'], 'the name comes from the profile, not the request');
        assert.equal('author' in firestore.store.get(`featured_content/${other.id}`), false);
        const enc = await s.create(encouragement('2026-11-22', '2026-11-28'));
        assert.equal(enc.author, 'Dave Smith');
        // A rename shows in the list without touching the item.
        firestore.store.set('users/pastor1', { first_name: 'David', last_name: 'Smith', is_pastor: true });
        const listed = (await s.list()).find((item) => item.id === enc.id);
        assert.deepEqual([listed.author_uid, listed.author], ['pastor1', 'David Smith']);
        // Untagged later: the item can still be edited and keep them...
        firestore.store.set('users/pastor1', { first_name: 'David', last_name: 'Smith', is_pastor: false });
        assert.equal((await s.update(enc.id, encouragement('2026-11-22', '2026-11-28', { body: 'Edited' }))).author, 'David Smith');
        // ...even after their profile is gone (no name to show then).
        firestore.store.delete('users/pastor1');
        assert.equal((await s.update(enc.id, encouragement('2026-11-22', '2026-11-28'))).author, '');
        assert.equal(firestore.store.get(`featured_content/${enc.id}`).created_at, 'SERVER_TIME', 'an edit keeps who created it');
        // But they can't be picked for anything new.
        await assert.rejects(s.create(encouragement('2026-12-01', '2026-12-02')), (e) => e.status === 400 && /tagged as a pastor/.test(e.message));
        await assert.rejects(s.update(other.id, encouragement('2026-11-22', '2026-11-28', { author_uid: 'pastor1' })), (e) => e.status === 400);
        assert.deepEqual((await s.list()).find((item) => item.id === enc.id).author_uid, 'pastor1');
        // Verses have no author.
        const verseItem = await s.create(verse('2026-11-22', '2026-11-28', { author_uid: 'pastor2' }));
        assert.equal('author_uid' in firestore.store.get(`featured_content/${verseItem.id}`), false);
    });

    test('the form\'s busiest-day check', () => {
        const items = [
            { start: '2026-11-20', end: '2026-11-25' },
            { start: '2026-11-24', end: '2026-11-30' },
            { start: '2026-11-25', end: '2026-11-25' },
        ];
        assert.deepEqual({ ...busiestDay(items, '2026-11-01', '2026-12-31'), items: undefined }, { count: 3, day: '2026-11-25', items: undefined });
        assert.equal(busiestDay(items, '2026-11-26', '2026-12-31').count, 1);
        assert.equal(busiestDay(items, '2026-12-01', '2026-12-31').count, 0);
        assert.equal(busiestDay(items, '2026-12-01', '2026-11-01').count, 0);
    });

    test('checks its input', async () => {
        const s = service();
        const bad = [
            verse('2026-11-28', '2026-11-22'),
            verse('2026-13-01', '2026-12-02'),
            verse('2026-01-01', '2027-06-01'),
            verse('2026-11-22', '2026-11-28', { passage_id: 'Philippians 4:6' }),
            verse('2026-11-22', '2026-11-28', { reference: ' ' }),
            verse('2026-11-22', '2026-11-28', { note: 'x'.repeat(1001) }),
            verse('2026-11-22', '2026-11-28', { note: 5 }),
        ];
        for (const input of bad) await assert.rejects(s.create(input), (e) => e.status === 400, JSON.stringify(input));
        await assert.rejects(s.update('nope', verse('2026-11-22', '2026-11-28')), (e) => e.status === 404);
        await assert.rejects(s.remove('nope'), (e) => e.status === 404);
    });

    test('passage IDs', () => {
        for (const ok of ['JHN.3.16', 'PHP.4.6-PHP.4.7', '1CO.13.4-1CO.13.13', 'GEN.1.31-GEN.2.3']) assert.equal(checkPassageId(ok), ok);
        for (const bad of ['JHN.3', 'JHN.3.16-ROM.1.1', 'JHN.3.18-JHN.3.16', 'jhn.3.16', '']) assert.throws(() => checkPassageId(bad), bad);
    });

    test('a looked-up passage becomes one passage ID and reference', () => {
        const passage = (verses) => ({ book: 'Philippians', bookId: 'PHP', verses: verses.map(([chapter, v]) => ({ chapter, verse: v, text: '' })) });
        assert.deepEqual(featuredPassage(passage([[4, 7], [4, 6]])), { passageId: 'PHP.4.6-PHP.4.7', reference: 'Philippians 4:6-7' });
        assert.deepEqual(featuredPassage(passage([[4, 13]])), { passageId: 'PHP.4.13', reference: 'Philippians 4:13' });
        assert.deepEqual(featuredPassage(passage([[1, 30], [2, 1]])), { passageId: 'PHP.1.30-PHP.2.1', reference: 'Philippians 1:30-2:1' });
        assert.throws(() => featuredPassage(passage([[4, 6], [4, 8]])), /continuous/);
        assert.throws(() => featuredPassage(passage([])), /No verses/);
    });
});

describe('featured content routes', () => {
    test('create, list, update and delete, only for the environment the page shows', async () => {
        const firestore = withUsers();
        const s = service(firestore);
        let env = 'dev';
        const app = express();
        app.use(express.json());
        app.use((req, res, next) => { req.admin = { uid: 'uid-admin' }; next(); });
        app.use('/api/featured', createFeaturedRouter(() => ({ service: s, env })));
        const server = await new Promise((resolve) => { const srv = app.listen(0, '127.0.0.1', () => resolve(srv)); });
        const base = `http://127.0.0.1:${server.address().port}/api/featured`;
        const call = (method, url, json) => fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: json ? JSON.stringify(json) : undefined });
        try {
            const created = await call('POST', base, { ...verse('2026-11-22', '2026-11-28'), env: 'dev' });
            assert.equal(created.status, 201);
            const { id } = await created.json();
            assert.equal(firestore.store.get(`featured_content/${id}`).created_by, 'uid-admin');
            assert.equal((await call('POST', base, { ...encouragement('2026-11-23', '2026-11-24'), env: 'dev' })).status, 201, 'overlap is fine');
            assert.equal((await call('POST', base, { ...encouragement('2026-11-23', '2026-11-24', { body: '' }), env: 'dev' })).status, 400);
            assert.equal((await call('POST', base, { ...verse('2026-12-22', '2026-12-28'), env: 'prod' })).status, 409, 'wrong env');
            const list = await (await fetch(base)).json();
            assert.deepEqual([list.env, list.maxConcurrent, list.items.length], ['dev', 5, 2]);
            assert.deepEqual(list.items.map((item) => item.type).sort(), ['pastors_encouragement', 'verse']);
            assert.deepEqual(Object.keys(list.types), ['verse', 'pastors_encouragement']);
            assert.deepEqual(list.authors.map((a) => a.name), ['Anna Lee', 'Dave Smith']);
            assert.equal((await call('PUT', `${base}/${id}`, { ...verse('2026-11-22', '2026-11-28', { note: 'New' }), env: 'dev' })).status, 200);
            assert.equal(firestore.store.get(`featured_content/${id}`).note, 'New');
            assert.equal((await call('DELETE', `${base}/${id}`, { env: 'prod' })).status, 409);
            assert.equal((await call('DELETE', `${base}/${id}`, { env: 'dev' })).status, 200);
            assert.equal(firestore.store.has(`featured_content/${id}`), false);
        } finally {
            server.close();
        }
    });
});
