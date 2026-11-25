import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { memoryFirestore } from './helpers/memoryFirestore.js';
import { SeriesCopyService } from '../src/services/seriesCopy.js';
import { createPublishedRouter } from '../src/routes/seriesBuilderRoutes.js';

function fakeBucket(name, files = {}) {
    const store = new Map(Object.entries(files));
    return {
        name,
        store,
        file: (path) => ({
            exists: async () => [store.has(path)],
            download: async () => {
                if (!store.has(path)) throw new Error('No such object');
                return [store.get(path).buffer];
            },
            getMetadata: async () => [{ contentType: store.get(path)?.contentType }],
            save: async (buffer, { contentType }) => { store.set(path, { buffer, contentType }); },
        }),
    };
}

const IMAGE = 'bible_series/john/cover.jpeg';

function setup({ prodImage = true } = {}) {
    const dbs = { prod: memoryFirestore(), dev: memoryFirestore() };
    const buckets = {
        prod: fakeBucket('wpa-be-app.appspot.com', prodImage ? { [IMAGE]: { buffer: Buffer.from('jpeg'), contentType: 'image/jpeg' } } : {}),
        dev: fakeBucket('wpa-be-app-dev.appspot.com'),
    };
    dbs.prod.store.set('bible_series/s1', {
        title: 'John', sub_title: '', is_active: true, is_visible: true,
        image_gs_location: `gs://wpa-be-app.appspot.com/${IMAGE}`,
        series_content_snippet: [{ content_types: [{ content_type: 'read', content_id: 'c1' }, { content_type: 'pray', content_id: 'c2' }] }],
    });
    dbs.prod.store.set('bible_series/s1/series_content/c1', { title: 'Read', content_type: 'read', body: [] });
    dbs.prod.store.set('bible_series/s1/series_content/c2', { title: 'Pray', content_type: 'pray', body: [] });
    dbs.prod.store.set('completions/x', { series_id: 's1', content_id: 'c1' });
    dbs.prod.store.set('forums/s1/threads/t1', { title: 'Hi' });
    const copier = new SeriesCopyService({ getFirestore: (env) => dbs[env] ?? null, getBucket: (env) => buckets[env] ?? null });
    return { dbs, buckets, copier };
}

describe('copying a series from prod to dev', () => {
    test('copies the series and its entries under the same IDs, inactive, with the image in the dev bucket', async () => {
        const { dbs, buckets, copier } = setup();
        const result = await copier.copy('s1');
        assert.deepEqual(
            { ...result, image: { ...result.image } },
            { seriesId: 's1', title: 'John', from: 'prod', to: 'dev', entries: 2, removed: 0, replaced: false,
                image: { gs: `gs://wpa-be-app-dev.appspot.com/${IMAGE}`, copied: true, warning: null } },
        );
        const series = dbs.dev.store.get('bible_series/s1');
        assert.equal(series.is_active, false, 'never copied active');
        assert.equal(series.is_visible, true);
        assert.equal(series.image_gs_location, `gs://wpa-be-app-dev.appspot.com/${IMAGE}`);
        assert.deepEqual(series.series_content_snippet, dbs.prod.store.get('bible_series/s1').series_content_snippet);
        assert.deepEqual(dbs.dev.store.get('bible_series/s1/series_content/c2'), { title: 'Pray', content_type: 'pray', body: [] });
        assert.equal(buckets.dev.store.get(IMAGE).contentType, 'image/jpeg');
        // Only series content: no user data.
        assert.deepEqual([...dbs.dev.store.keys()].sort(), ['bible_series/s1', 'bible_series/s1/series_content/c1', 'bible_series/s1/series_content/c2']);
        assert.equal(dbs.prod.store.get('bible_series/s1').is_active, true, 'prod untouched');
    });

    test('refuses to overwrite a dev copy unless asked, then replaces it and drops entries prod no longer has', async () => {
        const { dbs, copier } = setup();
        await copier.copy('s1');
        dbs.dev.store.set('bible_series/s1', { ...dbs.dev.store.get('bible_series/s1'), title: 'John (dev edit)', is_active: true });
        dbs.dev.store.set('bible_series/s1/series_content/old', { title: 'Old' });
        await assert.rejects(copier.copy('s1'), (e) => e.status === 409 && e.details.title === 'John (dev edit)' && e.details.is_active === true);
        assert.equal(dbs.dev.store.get('bible_series/s1').title, 'John (dev edit)', 'nothing written');

        const result = await copier.copy('s1', { replace: true });
        assert.equal(result.replaced, true);
        assert.equal(result.removed, 1);
        assert.equal(result.image.copied, false, 'already in the dev bucket');
        assert.equal(dbs.dev.store.get('bible_series/s1').title, 'John');
        assert.equal(dbs.dev.store.get('bible_series/s1').is_active, false);
        assert.equal(dbs.dev.store.has('bible_series/s1/series_content/old'), false);
    });

    test('keeps the image location (with a warning) when it can\'t be copied', async () => {
        const { dbs, copier } = setup({ prodImage: false });
        const { image } = await copier.copy('s1');
        assert.equal(image.copied, false);
        assert.match(image.warning, /couldn't be copied/);
        assert.equal(dbs.dev.store.get('bible_series/s1').image_gs_location, `gs://wpa-be-app.appspot.com/${IMAGE}`);
    });

    test('never copies to prod, and reports a missing series', async () => {
        const { dbs, copier } = setup();
        await assert.rejects(copier.copy('s1', { from: 'dev', to: 'prod' }), (e) => e.status === 400);
        await assert.rejects(copier.copy('nope'), (e) => e.status === 404);
        assert.equal(dbs.dev.store.size, 0);
    });

    test('over HTTP: only from prod (the selected environment) to dev', async () => {
        const { dbs, copier } = setup();
        let env = 'prod';
        const app = express();
        app.use(express.json());
        app.use('/api/published', createPublishedRouter(() => ({ service: null, env }), copier));
        const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
        const post = (json) => fetch(`http://127.0.0.1:${server.address().port}/api/published/s1/copy-to`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(json),
        });
        try {
            assert.equal((await post({ env: 'prod' })).status, 400);
            assert.equal((await post({ env: 'dev' })).status, 201);
            const again = await post({ env: 'dev' });
            assert.equal(again.status, 409);
            assert.deepEqual(await again.json(), { error: 'This series is already in dev', title: 'John', is_active: false });
            assert.equal((await post({ env: 'dev', replace: true })).status, 200);
            env = 'dev';
            assert.equal((await post({ env: 'dev', replace: true })).status, 400);
            assert.equal(dbs.prod.store.get('bible_series/s1').title, 'John');
        } finally {
            server.close();
        }
    });
});

describe('copying a draft from prod to dev', () => {
    test('moves its cover image into the dev bucket and makes the copy inactive', async () => {
        const { DraftService } = await import('../src/services/draftService.js');
        const { createDraftRouter } = await import('../src/routes/seriesBuilderRoutes.js');
        const { buckets, copier } = setup();
        const now = () => { const t = Date.now(); return { toMillis: () => t }; };
        const stores = { prod: new DraftService(memoryFirestore(), { now, env: 'prod' }), dev: new DraftService(memoryFirestore(), { now, env: 'dev' }) };
        const app = express();
        app.use(express.json());
        app.use('/api/drafts', createDraftRouter(() => ({ service: stores.prod, projectId: 'p', env: 'prod' }), null, (e) => stores[e], {
            copyImage: (gs, from, to) => copier.copyImage(gs, from, to),
        }));
        const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
        const copy = (id, json) => fetch(`http://127.0.0.1:${server.address().port}/api/drafts/${id}/copy-to`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(json),
        });
        try {
            const { id } = await stores.prod.create({
                meta: { title: 'John', image_gs_location: `gs://wpa-be-app.appspot.com/${IMAGE}`, is_active: true, is_visible: true },
                days: [],
            });
            const res = await copy(id, { env: 'dev' });
            assert.equal(res.status, 201);
            const body = await res.json();
            assert.deepEqual(body.image, { gs: `gs://wpa-be-app-dev.appspot.com/${IMAGE}`, copied: true, warning: null });
            const { draft } = await stores.dev.get(body.id);
            assert.equal(draft.meta.image_gs_location, `gs://wpa-be-app-dev.appspot.com/${IMAGE}`);
            assert.equal(draft.meta.is_active, false);
            assert.equal(draft.meta.is_visible, true);
            assert.equal(buckets.dev.store.get(IMAGE).contentType, 'image/jpeg');
            assert.equal((await stores.prod.get(id)).draft.meta.image_gs_location, `gs://wpa-be-app.appspot.com/${IMAGE}`, 'prod draft unchanged');

            // Replacing it again reuses the image already in dev.
            const again = await (await copy(id, { env: 'dev', replace: true })).json();
            assert.equal(again.image.copied, false);
            assert.equal(again.image.gs, `gs://wpa-be-app-dev.appspot.com/${IMAGE}`);
        } finally {
            server.close();
        }
    });

    test('images are never copied into prod', async () => {
        const { copier } = setup();
        await assert.rejects(copier.copyImage(`gs://wpa-be-app-dev.appspot.com/${IMAGE}`, 'dev', 'prod'), (e) => e.status === 400);
    });
});
