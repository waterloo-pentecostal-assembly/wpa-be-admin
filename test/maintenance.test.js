import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { DateTime } from 'luxon';
import { memoryFirestore } from './helpers/memoryFirestore.js';
import { DataDeletingService, cutoffFromDay } from '../src/services/dataDeletingService.js';
import { createMaintenanceRouter } from '../src/routes/maintenanceRoutes.js';

const toronto = (iso) => DateTime.fromISO(iso, { zone: 'America/Toronto' }).toJSDate();

async function seeded() {
    const firestore = memoryFirestore();
    const add = (collection, id, data) => firestore.collection(collection).doc(id).set(data);
    await add('prayer_requests', 'p-old', { date: toronto('2024-03-01T10:00') });
    await firestore.collection('prayer_requests').doc('p-old').collection('reports').doc('r').set({ by: 'u' });
    await add('prayer_requests', 'p-lastday', { date: toronto('2024-12-31T23:30') });
    await add('prayer_requests', 'p-new', { date: toronto('2025-01-01T00:00') });
    await add('prayer_requests', 'p-undated', { request: 'x' });
    await add('testimonies', 't-old', { date: toronto('2023-05-05T12:00') });
    await add('testimonies', 't-new', { date: toronto('2025-02-01T12:00') });
    await add('completions', 'c-old', { date: toronto('2020-01-01T00:00') });
    return firestore;
}

async function serve(getMaintenance) {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.admin = { email: 'admin@wpa.church' }; next(); });
    app.use('/api/maintenance', createMaintenanceRouter(getMaintenance));
    const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const base = `http://127.0.0.1:${server.address().port}/api/maintenance`;
    const call = async (path, init = {}) => {
        const res = await fetch(`${base}${path}`, init.json
            ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(init.json) }
            : init);
        return { status: res.status, body: await res.json() };
    };
    return { call, close: () => server.close() };
}

describe('cutoffFromDay', () => {
    test('is the start of the day in Toronto; bad and future dates are refused', () => {
        assert.equal(cutoffFromDay('2025-01-01').toISOString(), '2025-01-01T05:00:00.000Z');
        assert.equal(cutoffFromDay('2025-07-01').toISOString(), '2025-07-01T04:00:00.000Z');
        assert.throws(() => cutoffFromDay('2025-13-01'), /YYYY-MM-DD/);
        assert.throws(() => cutoffFromDay('yesterday'), /YYYY-MM-DD/);
        assert.throws(() => cutoffFromDay(undefined), /YYYY-MM-DD/);
        const now = () => DateTime.fromISO('2025-06-10T12:00', { zone: 'America/Toronto' });
        assert.ok(cutoffFromDay('2025-06-11', { now }));
        assert.throws(() => cutoffFromDay('2025-06-12', { now }), /future/);
    });
});

describe('DataDeletingService old content', () => {
    test('counts and deletes testimonies like prayer requests; other collections are refused', async () => {
        const firestore = await seeded();
        const service = new DataDeletingService(firestore);
        const before = cutoffFromDay('2025-01-01');
        assert.deepEqual(await service.countOldContent(before), {
            prayer_requests: { label: 'Prayer requests', older: 2, total: 4 },
            testimonies: { label: 'Testimonies', older: 1, total: 2 },
        });
        assert.equal(await service.countOldTestimonies(before), 1);
        assert.equal(await service.deleteOldTestimonies(before), 1);
        assert.ok(!firestore.store.has('testimonies/t-old'));
        assert.ok(firestore.store.has('testimonies/t-new'));
        await assert.rejects(service.deleteOldContent('completions', before), /Unknown kind/);
        assert.ok(firestore.store.has('completions/c-old'));
    });
});

describe('Maintenance API', () => {
    test('GET /old-content counts per kind for a day', async () => {
        const firestore = await seeded();
        const api = await serve(() => ({ service: new DataDeletingService(firestore), env: 'dev' }));
        try {
            const { status, body } = await api.call('/old-content?before=2025-01-01');
            assert.equal(status, 200);
            assert.equal(body.env, 'dev');
            assert.equal(body.cutoff, '2025-01-01T05:00:00.000Z');
            assert.deepEqual(Object.fromEntries(Object.entries(body.kinds).map(([k, v]) => [k, v.older])), { prayer_requests: 2, testimonies: 1 });
            assert.equal((await api.call('/old-content?before=nope')).status, 400);
        } finally {
            api.close();
        }
    });

    test('POST /old-content/delete deletes the chosen kinds, with subcollections, only in the expected env', async () => {
        const firestore = await seeded();
        const api = await serve(() => ({ service: new DataDeletingService(firestore), env: 'dev' }));
        try {
            const wrongEnv = await api.call('/old-content/delete', { json: { before: '2025-01-01', kinds: ['prayer_requests'], env: 'prod' } });
            assert.equal(wrongEnv.status, 409);
            assert.match(wrongEnv.body.error, /now working on dev/);
            assert.equal((await api.call('/old-content/delete', { json: { before: '2025-01-01', kinds: [], env: 'dev' } })).status, 400);
            assert.equal((await api.call('/old-content/delete', { json: { before: '2025-01-01', kinds: ['completions'], env: 'dev' } })).status, 400);
            assert.equal((await api.call('/old-content/delete', { json: { before: '2999-01-01', kinds: ['testimonies'], env: 'dev' } })).status, 400);
            assert.ok(firestore.store.has('prayer_requests/p-old'), 'refused requests delete nothing');

            const { status, body } = await api.call('/old-content/delete', { json: { before: '2025-01-01', kinds: ['prayer_requests'], env: 'dev' } });
            assert.equal(status, 200);
            assert.deepEqual(body.deleted, { prayer_requests: 2 });
            const left = [...firestore.store.keys()].sort();
            assert.deepEqual(left, ['completions/c-old', 'prayer_requests/p-new', 'prayer_requests/p-undated', 'testimonies/t-new', 'testimonies/t-old']);
        } finally {
            api.close();
        }
    });

    test('503 while the selected environment has no service', async () => {
        const api = await serve(() => ({ service: null, env: 'dev' }));
        try {
            assert.equal((await api.call('/old-content?before=2025-01-01')).status, 503);
        } finally {
            api.close();
        }
    });
});
