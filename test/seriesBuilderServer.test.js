import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { DraftService, DraftServiceError } from '../src/services/draftService.js';
import { StorageService, safeFileName, slugify } from '../src/services/storageService.js';
import { createDraftRouter, createOembedRouter, createStorageRouter } from '../src/routes/seriesBuilderRoutes.js';
import { loadBibleService } from '../src/services/bibleService.js';
import { PublishService, PublishError } from '../src/services/publishService.js';
import { DataLoaderService } from '../src/services/dataLoaderService.js';
import { createBibleRouter } from '../src/routes/bibleRoutes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Minimal in-memory stand-in for the Firestore APIs DraftService uses.
function fakeFirestore() {
    const docs = new Map();
    let counter = 0;
    const snapshot = (id) => ({ id, exists: docs.has(id), data: () => ({ ...docs.get(id) }) });
    const docRef = (id) => ({
        id,
        get: async () => snapshot(id),
        set: async (data) => { docs.set(id, { ...data }); },
        update: async (patch) => { docs.set(id, { ...docs.get(id), ...patch }); },
    });
    const collection = {
        doc: (id) => docRef(id ?? `doc${++counter}`),
        orderBy: () => ({
            limit: () => ({
                get: async () => ({
                    docs: [...docs.keys()]
                        .sort((a, b) => docs.get(b).updatedAt.toMillis() - docs.get(a).updatedAt.toMillis())
                        .map(snapshot),
                }),
            }),
        }),
    };
    return {
        docs,
        collection: () => collection,
        runTransaction: async (fn) => fn({
            get: (ref) => ref.get(),
            update: (ref, patch) => { docs.set(ref.id, { ...docs.get(ref.id), ...patch }); },
        }),
    };
}

function draftFixture(title = 'Matthew') {
    return { meta: { title }, days: [{ date: '2026-02-02' }, { date: '2026-02-03' }] };
}

function listen(app) {
    return new Promise((resolve) => {
        const server = app.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
    });
}

describe('DraftService', () => {
    let tick = 0;
    const now = () => ({ toMillis: () => ++tick });

    test('create, get, list and save with revision checks', async () => {
        const service = new DraftService(fakeFirestore(), { now });
        const { id, rev } = await service.create(draftFixture());
        assert.equal(rev, 1);

        const loaded = await service.get(id);
        assert.deepEqual(loaded.draft, draftFixture());

        const saved = await service.save(id, draftFixture('Matthew 2026'), 1);
        assert.equal(saved.rev, 2);

        await assert.rejects(service.save(id, draftFixture('stale'), 1), (error) => {
            assert.ok(error instanceof DraftServiceError);
            assert.equal(error.status, 409);
            assert.equal(error.details.rev, 2);
            return true;
        });
        assert.equal((await service.get(id)).draft.meta.title, 'Matthew 2026');

        await service.save(id, draftFixture('forced'), 1, { force: true });
        const [summary] = await service.list();
        assert.equal(summary.title, 'forced');
        assert.equal(summary.dayCount, 2);
        assert.equal(summary.startDate, '2026-02-02');
        assert.equal(summary.rev, 3);
    });

    test('remove is a soft delete hidden from list and get', async () => {
        const firestore = fakeFirestore();
        const service = new DraftService(firestore, { now });
        const { id } = await service.create(draftFixture());
        await service.remove(id);
        assert.deepEqual(await service.list(), []);
        await assert.rejects(service.get(id), { status: 404 });
        assert.equal(firestore.docs.get(id).deleted, true);
    });

    test('rejects malformed and oversized drafts', async () => {
        const service = new DraftService(fakeFirestore(), { now });
        await assert.rejects(service.create({ meta: {} }), { status: 400 });
        const huge = { ...draftFixture(), padding: 'x'.repeat(1024 * 1024) };
        await assert.rejects(service.create(huge), { status: 413 });
    });
});

describe('publish records', () => {
    let tick = 0;
    const now = () => { const t = ++tick; return { toMillis: () => t }; };

    test('are stored on the draft document and survive draft saves', async () => {
        const firestore = fakeFirestore();
        const service = new DraftService(firestore, { now });
        const { id } = await service.create(draftFixture());
        const publish = await service.addPublish(id, { env: 'dev', status: 'starting', seriesId: null, total: 2 });
        await service.updatePublish(id, publish.id, { status: 'publishing', seriesId: 'S1' });
        await service.save(id, draftFixture('renamed'), 1);
        await service.updatePublish(id, publish.id, { status: 'done', written: 2 });

        const [record] = await service.getPublishes(id);
        assert.equal(record.seriesId, 'S1');
        assert.equal(record.status, 'done');
        assert.equal(typeof record.finishedAt, 'number');
        assert.equal(firestore.docs.get(id).publishes.length, 1);
        assert.ok(!JSON.parse(firestore.docs.get(id).data).publishes, 'not part of the draft data');
        const [summary] = await service.list();
        assert.equal(summary.publishedCount, 1);
        assert.equal(summary.title, 'renamed');
    });
});

describe('PublishService', () => {
    const json = {
        bible_series: { title: 'Matthew' },
        series_content: [
            { date: '2026-02-02', content_type: 'read', title: '', body: [] },
            { date: '2026-02-03', content_type: 'read', title: '', body: [] },
        ],
    };

    function setup(loaderOverrides = {}) {
        const drafts = new DraftService(fakeFirestore(), { now: () => { const t = Date.now(); return { toMillis: () => t }; } });
        const calls = [];
        const loader = {
            loadBibleSeries: async () => { calls.push('series'); return 'SERIES1'; },
            loadSeriesContent: async (content, seriesId, { onProgress }) => {
                calls.push(`content:${seriesId}`);
                onProgress({ written: 1, failed: 0, total: 2 });
                onProgress({ written: 1, failed: 1, total: 2 });
                return { total: 2, written: 1, failed: [{ index: 1, date: '2026-02-03', content_type: 'read', error: 'boom' }] };
            },
            ...loaderOverrides,
        };
        const publisher = new PublishService({ getDrafts: () => drafts, getLoader: () => loader, getEnv: () => 'dev' });
        return { drafts, loader, publisher, calls };
    }

    test('records the series ID immediately and the result when content finishes', async () => {
        const { drafts, publisher, calls } = setup();
        const { id: draftId } = await drafts.create(draftFixture());
        const started = await publisher.start(draftId, structuredClone(json));
        assert.equal(started.seriesId, 'SERIES1');
        assert.equal(started.status, 'publishing');
        assert.equal(started.env, 'dev');

        await Promise.all(publisher.running.values());
        const [record] = await drafts.getPublishes(draftId);
        assert.equal(record.status, 'done');
        assert.equal(record.seriesId, 'SERIES1');
        assert.equal(record.written, 1);
        assert.equal(record.failedCount, 1);
        assert.equal(record.failed[0].error, 'boom');
        assert.deepEqual(calls, ['series', 'content:SERIES1']);
    });

    test('a failure creating the series is recorded and nothing else is written', async () => {
        const { drafts, publisher, calls } = setup({ loadBibleSeries: async () => { throw new Error('permission denied'); } });
        const { id: draftId } = await drafts.create(draftFixture());
        await assert.rejects(publisher.start(draftId, structuredClone(json)), (e) => e instanceof PublishError && e.status === 502);
        const [record] = await drafts.getPublishes(draftId);
        assert.equal(record.status, 'failed');
        assert.match(record.error, /permission denied/);
        assert.deepEqual(calls, []);
    });

    test('an unknown draft is rejected before any app data is written', async () => {
        const { publisher, calls } = setup();
        await assert.rejects(publisher.start('missing', structuredClone(json)), { status: 404 });
        assert.deepEqual(calls, []);
    });

    test('rejects empty or malformed series', async () => {
        const { publisher } = setup();
        await assert.rejects(publisher.start('x', { bible_series: {}, series_content: [] }), { status: 400 });
        await assert.rejects(publisher.start('x', {}), { status: 400 });
    });
});

describe('DataLoaderService.loadSeriesContent', () => {
    test('reports written and failed entries', async () => {
        const added = [];
        const firestore = {
            collection: () => ({
                doc: () => ({
                    collection: () => ({
                        add: async (entry) => {
                            if (entry.content_type === 'bad') throw new Error('write rejected');
                            added.push(entry);
                        },
                    }),
                }),
            }),
        };
        const progress = [];
        const report = await new DataLoaderService(firestore).loadSeriesContent(
            [{ date: '2026-02-02', content_type: 'bad' }, { date: '2026-02-03', content_type: 'read' }],
            'S1',
            { onProgress: (p) => progress.push(p) },
        );
        assert.equal(report.written, 1);
        assert.deepEqual(report.failed.map((f) => [f.index, f.date, f.content_type, f.error]), [[0, '2026-02-02', 'bad', 'write rejected']]);
        assert.deepEqual(progress.at(-1), { written: 1, failed: 1, total: 2 });
        assert.equal(added.length, 1);
    });
});

describe('draft routes', () => {
    let server;
    let base;
    before(async () => {
        const service = new DraftService(fakeFirestore(), { now: () => ({ toMillis: () => Date.now() }) });
        const app = express();
        app.use(express.json());
        app.use('/api/drafts', createDraftRouter(() => ({ service, projectId: 'test-project' })));
        app.use('/api/none', createDraftRouter(() => ({ service: null, projectId: null })));
        ({ server, base } = await listen(app));
    });
    after(() => server.close());

    test('round trip and conflict status over HTTP', async () => {
        const created = await (await fetch(`${base}/api/drafts`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ draft: draftFixture() }),
        })).json();
        const put = (rev) => fetch(`${base}/api/drafts/${created.id}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ draft: draftFixture('x'), rev }),
        });
        assert.equal((await put(1)).status, 200);
        const conflict = await put(1);
        assert.equal(conflict.status, 409);
        assert.equal((await conflict.json()).rev, 2);
        const status = await (await fetch(`${base}/api/drafts/status`)).json();
        assert.deepEqual(status, { available: true, projectId: 'test-project' });
    });

    test('reports 503 when draft storage is unavailable', async () => {
        assert.equal((await fetch(`${base}/api/none`)).status, 503);
        assert.deepEqual(await (await fetch(`${base}/api/none/status`)).json(), { available: false, projectId: null });
    });
});

describe('storage', () => {
    test('slugify and safeFileName produce safe object names', () => {
        assert.equal(slugify('1 & 2 Thessalonians — 2026!'), '1_2_thessalonians_2026');
        assert.equal(slugify('Évangile'), 'evangile');
        assert.equal(safeFileName('../../My Cover.PNG', 'image/png'), 'my_cover.png');
        assert.equal(safeFileName('', 'image/jpeg'), 'cover.jpg');
    });

    test('uploads never overwrite an existing object', async () => {
        const existing = new Set(['bible_series/matthew/cover.jpg']);
        const saved = [];
        const bucket = {
            name: 'wpa-be-app-dev.appspot.com',
            file: (p) => ({
                exists: async () => [existing.has(p)],
                save: async (buffer, opts) => { saved.push({ p, opts }); existing.add(p); },
            }),
        };
        const service = new StorageService(bucket);
        const result = await service.uploadSeriesImage({
            seriesTitle: 'Matthew', filename: 'cover.jpg', contentType: 'image/jpeg', buffer: Buffer.from([1, 2, 3]),
        });
        assert.equal(result.gsUri, 'gs://wpa-be-app-dev.appspot.com/bible_series/matthew/cover_2.jpg');
        assert.equal(saved[0].opts.contentType, 'image/jpeg');
        await assert.rejects(
            service.uploadSeriesImage({ seriesTitle: 'x', filename: 'a.svg', contentType: 'image/svg+xml', buffer: Buffer.from([1]) }),
            { status: 415 },
        );
    });

    test('upload route passes the raw image body through', async () => {
        let received = null;
        const fakeService = {
            uploadSeriesImage: async (args) => {
                received = args;
                return { gsUri: 'gs://b/bible_series/romans/cover.png', path: 'bible_series/romans/cover.png', bucket: 'b' };
            },
        };
        const app = express();
        app.use('/api/storage', createStorageRouter(() => ({ service: fakeService, env: 'dev' })));
        const { server, base } = await listen(app);
        try {
            const res = await fetch(`${base}/api/storage/series-image?series=Romans&filename=cover.png`, {
                method: 'POST', headers: { 'Content-Type': 'image/png' }, body: Buffer.from([137, 80, 78, 71]),
            });
            assert.equal(res.status, 201);
            assert.equal((await res.json()).env, 'dev');
            assert.equal(received.seriesTitle, 'Romans');
            assert.deepEqual([...received.buffer], [137, 80, 78, 71]);
        } finally {
            server.close();
        }
    });
});

describe('oembed route', () => {
    test('only fetches YouTube URLs', async () => {
        const calls = [];
        const fakeFetch = async (url) => {
            calls.push(url);
            return { ok: true, json: async () => ({ title: 'King of Heaven', author_name: 'Paul Baloche' }) };
        };
        const app = express();
        app.use('/api/oembed', createOembedRouter(fakeFetch));
        const { server, base } = await listen(app);
        try {
            const ok = await fetch(`${base}/api/oembed?url=${encodeURIComponent('https://youtu.be/VO76W9Zw0cs')}`);
            assert.deepEqual(await ok.json(), { title: 'King of Heaven', author: 'Paul Baloche' });
            const blocked = await fetch(`${base}/api/oembed?url=${encodeURIComponent('http://169.254.169.254/latest')}`);
            assert.equal(blocked.status, 400);
            assert.equal(calls.length, 1);
        } finally {
            server.close();
        }
    });
});

describe('Bible batch endpoints', () => {
    const service = loadBibleService(path.join(__dirname, '..', 'src', 'data', 'niv.json'));

    test('getPassages resolves good references and reports bad ones individually', () => {
        const { results } = service.getPassages(['Matthew 1:1-3', 'Matthew 99', 'Nope 1']);
        assert.equal(results['Matthew 1:1-3'].ok, true);
        assert.equal(results['Matthew 1:1-3'].passage.verses.length, 3);
        assert.equal(results['Matthew 99'].ok, false);
        assert.equal(results['Matthew 99'].status, 404);
        assert.equal(results['Nope 1'].ok, false);
    });

    test('POST /passages and GET /aliases', async () => {
        const app = express();
        app.use('/api/bible/niv', createBibleRouter(service));
        const { server, base } = await listen(app);
        try {
            const res = await fetch(`${base}/api/bible/niv/passages`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refs: ['Jn 3:16'] }),
            });
            const body = await res.json();
            assert.equal(body.results['Jn 3:16'].passage.reference, 'John 3:16');
            const bad = await fetch(`${base}/api/bible/niv/passages`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refs: 'John 3' }),
            });
            assert.equal(bad.status, 400);
            const aliases = await (await fetch(`${base}/api/bible/niv/aliases`)).json();
            assert.ok(aliases.aliases.Matthew.includes('Mt'));
        } finally {
            server.close();
        }
    });
});
