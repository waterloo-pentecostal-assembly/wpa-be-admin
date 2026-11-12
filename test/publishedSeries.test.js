import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { loadBibleService } from '../src/services/bibleService.js';
import { collectRefs, compileDraft, createLookup } from '../ui/src/series/compile.js';
import { importSeriesJson } from '../ui/src/series/importSeries.js';
import { splitReference } from '../ui/src/series/scriptureRefs.js';
import { createRecompiler } from '../src/services/seriesBaseline.js';
import { DataLoaderService } from '../src/services/dataLoaderService.js';
import { DraftService } from '../src/services/draftService.js';
import { PublishError, PublishService } from '../src/services/publishService.js';
import {
    PublishedSeriesService, buildSnippet, contentTimestamp, isoDateOf, planSeriesUpdate,
} from '../src/services/publishedSeries.js';
import { createDraftRouter, createPublishedRouter } from '../src/routes/seriesBuilderRoutes.js';

// In-memory stand-in for the Firestore APIs used on bible_series, its
// series_content subcollection, completions and the drafts collection.
function memoryFirestore() {
    const store = new Map(); // document path -> data
    let counter = 0;
    const snapshot = (path) => ({ id: path.split('/').at(-1), exists: store.has(path), data: () => (store.has(path) ? { ...store.get(path) } : undefined) });
    const docRef = (path) => ({
        id: path.split('/').at(-1),
        path,
        get: async () => snapshot(path),
        set: async (data) => { store.set(path, { ...data }); },
        update: async (patch) => {
            if (!store.has(path)) throw new Error(`No document to update: ${path}`);
            store.set(path, { ...store.get(path), ...patch });
        },
        delete: async () => { store.delete(path); },
        collection: (name) => collection(`${path}/${name}`),
    });
    const collection = (path) => {
        const children = () => [...store.keys()].filter((k) => k.startsWith(`${path}/`) && !k.slice(path.length + 1).includes('/'));
        const query = (filter = () => true, order = null) => ({
            where: (field, op, value) => query((d) => filter(d) && d[field] === value, order),
            select: () => query(filter, order),
            orderBy: (field, dir) => query(filter, { field, dir }),
            limit: () => query(filter, order),
            get: async () => {
                let docs = children().map(snapshot).filter((s) => filter(s.data()));
                if (order) {
                    // Like Firestore, ordering by a field leaves out documents without it.
                    const value = (s) => { const v = s.data()[order.field]; return v?.toMillis?.() ?? v; };
                    docs = docs.filter((s) => value(s) !== undefined)
                        .sort((a, b) => (order.dir === 'desc' ? -1 : 1) * (value(a) < value(b) ? -1 : value(a) > value(b) ? 1 : 0));
                }
                return { docs, empty: !docs.length, forEach: (fn) => docs.forEach(fn) };
            },
        });
        return {
            ...query(),
            doc: (id) => docRef(`${path}/${id ?? `auto${String(++counter).padStart(4, '0')}`}`),
            add: async (data) => {
                const ref = docRef(`${path}/auto${String(++counter).padStart(4, '0')}`);
                await ref.set(data);
                return ref;
            },
        };
    };
    const batches = [];
    return {
        store,
        batches,
        collection,
        batch: () => {
            const ops = [];
            return {
                set: (ref, data) => ops.push(() => ref.set(data)),
                update: (ref, patch) => ops.push(() => ref.update(patch)),
                delete: (ref) => ops.push(() => ref.delete()),
                commit: async () => {
                    batches.push(ops.length);
                    for (const op of ops) await op();
                },
            };
        },
        runTransaction: async (fn) => fn({
            get: (ref) => ref.get(),
            set: (ref, data) => { store.set(ref.path, { ...data }); },
        }),
    };
}

const series = { title: 'Matthew', sub_title: '', image_gs_location: 'gs://b/m.png', is_active: false, is_visible: true };
const body = (text) => [{ body_type: 'text', paragraphs: [text] }];
const content = () => [
    { title: 'Read', content_type: 'read', date: '2026-02-02', body: body('Mon read') },
    { title: 'Pray', content_type: 'pray', date: '2026-02-02', body: body('Mon pray') },
    { title: 'Read', content_type: 'read', date: '2026-02-03', body: body('Tue read') },
    { title: 'Pray', content_type: 'pray', date: '2026-02-03', body: body('Tue pray') },
    { title: 'Read', content_type: 'read', date: '2026-02-04', body: body('Wed read') },
];

async function publishFixture(firestore) {
    const loader = new DataLoaderService(firestore);
    const seriesId = await loader.loadBibleSeries({ ...series });
    await loader.loadSeriesContent(content(), seriesId);
    return seriesId;
}

/** Snippet as [date, [[type, id]...]] for readable assertions. */
function snippetOf(firestore, seriesId) {
    const data = firestore.store.get(`bible_series/${seriesId}`);
    return {
        days: data.series_content_snippet.map((d) => [isoDateOf(d.date), d.content_types.map((c) => [c.content_type, c.content_id])]),
        start: isoDateOf(data.start_date),
        end: isoDateOf(data.end_date),
    };
}

function contentDocs(firestore, seriesId) {
    const prefix = `bible_series/${seriesId}/series_content/`;
    return [...firestore.store.entries()]
        .filter(([k]) => k.startsWith(prefix))
        .map(([k, v]) => ({ id: k.slice(prefix.length), ...v, date: isoDateOf(v.date) }));
}

describe('buildSnippet', () => {
    test('groups entries by day in date order and keeps their order within a day', () => {
        const entries = [
            { id: 'b1', content_type: 'read', date: contentTimestamp('2026-02-03') },
            { id: 'a1', content_type: 'read', date: contentTimestamp('2026-02-02') },
            { id: 'b2', content_type: 'pray', date: contentTimestamp('2026-02-03') },
            { id: 'a2', content_type: 'pray', date: contentTimestamp('2026-02-02') },
        ];
        const result = buildSnippet(entries);
        assert.deepEqual(
            result.series_content_snippet.map((d) => [isoDateOf(d.date), d.content_types.map((c) => c.content_id)]),
            [['2026-02-02', ['a1', 'a2']], ['2026-02-03', ['b1', 'b2']]],
        );
        assert.equal(isoDateOf(result.start_date), '2026-02-02');
        assert.equal(isoDateOf(result.end_date), '2026-02-03');
    });

    test('content dates are midnight in Toronto', () => {
        const ts = contentTimestamp('2026-07-01');
        assert.equal(ts.toDate().toISOString(), '2026-07-01T04:00:00.000Z');
        assert.equal(isoDateOf(ts), '2026-07-01');
        assert.throws(() => contentTimestamp('July 1'));
    });
});

describe('publishing writes the snippet', () => {
    test('in series order, with start and end dates', async () => {
        const firestore = memoryFirestore();
        const seriesId = await publishFixture(firestore);
        const docs = contentDocs(firestore, seriesId);
        const id = (date, type) => docs.find((d) => d.date === date && d.content_type === type).id;
        assert.deepEqual(snippetOf(firestore, seriesId), {
            days: [
                ['2026-02-02', [['read', id('2026-02-02', 'read')], ['pray', id('2026-02-02', 'pray')]]],
                ['2026-02-03', [['read', id('2026-02-03', 'read')], ['pray', id('2026-02-03', 'pray')]]],
                ['2026-02-04', [['read', id('2026-02-04', 'read')]]],
            ],
            start: '2026-02-02',
            end: '2026-02-04',
        });
    });
});

describe('updating a published series', () => {
    test('edits entries in place, moves, adds and removes, and rebuilds the snippet', async () => {
        const firestore = memoryFirestore();
        const seriesId = await publishFixture(firestore);
        const before = contentDocs(firestore, seriesId);
        const idOf = (date, type) => before.find((d) => d.date === date && d.content_type === type).id;
        firestore.store.set('completions/c1', { series_id: seriesId, content_id: idOf('2026-02-04', 'read') });
        firestore.store.set('completions/c2', { series_id: seriesId, content_id: idOf('2026-02-02', 'read') });

        const edited = content();
        edited[0].body = body('Mon read (fixed)');           // edit
        edited[3].date = '2026-02-05';                         // Tue pray moved to Thu
        edited.splice(4, 1);                                   // Wed read removed
        edited.splice(3, 0, { title: 'Song', content_type: 'song', date: '2026-02-03', body: body('Tue song') }); // added
        const json = { bible_series: { ...series, title: 'Matthew (2026)' }, series_content: edited };

        const service = new PublishedSeriesService(firestore);
        const { writes, summary } = await service.plan(seriesId, json);
        assert.deepEqual(summary.series, [{ field: 'title', from: 'Matthew', to: 'Matthew (2026)' }]);
        assert.deepEqual(summary.updated.map((u) => [u.id, u.fields, u.fromDate]), [
            [idOf('2026-02-02', 'read'), ['body'], undefined],
            [idOf('2026-02-03', 'pray'), ['date'], '2026-02-03'],
        ]);
        assert.deepEqual(summary.added.map((a) => [a.date, a.content_type]), [['2026-02-03', 'song']]);
        assert.deepEqual(summary.removed.map((r) => [r.id, r.completions]), [[idOf('2026-02-04', 'read'), 1]]);
        assert.equal(summary.unchanged, 2);
        assert.equal(summary.snippetChanged, true);
        assert.equal(summary.writeCount, 5);

        await service.apply(seriesId, writes);
        const after = contentDocs(firestore, seriesId);
        const afterId = (date, type) => after.find((d) => d.date === date && d.content_type === type)?.id;
        assert.equal(after.length, 5);
        assert.equal(afterId('2026-02-02', 'read'), idOf('2026-02-02', 'read'), 'edited in place');
        assert.equal(afterId('2026-02-05', 'pray'), idOf('2026-02-03', 'pray'), 'moved, same document');
        assert.equal(afterId('2026-02-04', 'read'), undefined);
        assert.deepEqual(after.find((d) => d.id === idOf('2026-02-02', 'read')).body, body('Mon read (fixed)'));
        assert.equal(firestore.store.get(`bible_series/${seriesId}`).title, 'Matthew (2026)');
        assert.deepEqual(snippetOf(firestore, seriesId), {
            days: [
                ['2026-02-02', [['read', idOf('2026-02-02', 'read')], ['pray', idOf('2026-02-02', 'pray')]]],
                ['2026-02-03', [['read', idOf('2026-02-03', 'read')], ['song', afterId('2026-02-03', 'song')]]],
                ['2026-02-05', [['pray', idOf('2026-02-03', 'pray')]]],
            ],
            start: '2026-02-02',
            end: '2026-02-05',
        });

        const again = await service.plan(seriesId, json);
        assert.equal(again.summary.writeCount, 0, 'nothing left to change');
    });

    test('ignores map key order and missing optional fields, but repairs a wrong snippet', async () => {
        const firestore = memoryFirestore();
        const seriesId = await publishFixture(firestore);
        const ref = `bible_series/${seriesId}`;
        const { sub_title, ...withoutSubtitle } = firestore.store.get(ref);
        assert.equal(sub_title, '');
        firestore.store.set(ref, withoutSubtitle);
        const json = {
            bible_series: series,
            series_content: content().map((e) => ({ body: e.body.map((b) => ({ paragraphs: b.paragraphs, body_type: b.body_type })), date: e.date, content_type: e.content_type, title: e.title })),
        };
        const service = new PublishedSeriesService(firestore);
        assert.equal((await service.plan(seriesId, json)).summary.writeCount, 0);

        // Snippet built out of order (what the Cloud Function did when writes raced).
        const data = firestore.store.get(ref);
        firestore.store.set(ref, { ...data, series_content_snippet: [...data.series_content_snippet].reverse() });
        const { writes, summary } = await service.plan(seriesId, json);
        assert.equal(summary.snippetChanged, true);
        assert.equal(summary.writeCount, 1);
        await service.apply(seriesId, writes);
        assert.equal(snippetOf(firestore, seriesId).days[0][0], '2026-02-02');
    });

    test('splits large updates into batches with the series document last', async () => {
        const firestore = memoryFirestore();
        const current = { series: { ...series }, content: [] };
        const many = Array.from({ length: 500 }, (_, i) => ({ title: '', content_type: `t${i}`, date: '2026-02-02', body: [] }));
        const service = new PublishedSeriesService(firestore);
        firestore.store.set('bible_series/S', { ...series });
        let n = 0;
        const { writes } = planSeriesUpdate(current, { bible_series: series, series_content: many }, { newId: () => `n${n++}` });
        assert.equal(await service.apply('S', writes), 501);
        assert.deepEqual(firestore.batches, [450, 51]);
        assert.equal(firestore.store.get('bible_series/S').series_content_snippet[0].content_types.length, 500);
    });

    test('exports a series as builder JSON in series order', async () => {
        const firestore = memoryFirestore();
        const seriesId = await publishFixture(firestore);
        const json = await new PublishedSeriesService(firestore).export(seriesId);
        assert.deepEqual(json.bible_series, series);
        assert.deepEqual(json.series_content, content());
        assert.equal(await new PublishedSeriesService(firestore).export('missing'), null);
    });
});

describe('opening a published series in the builder', () => {
    const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
    const bible = loadBibleService(path.join(root, 'src', 'data', 'niv.json'));
    const compile = (draft) => {
        const singles = new Map();
        for (const ref of collectRefs(draft)) {
            for (const part of splitReference(ref)) singles.set(part, { ok: true, passage: bible.getPassage(part) });
        }
        return compileDraft(draft, createLookup(singles)).json;
    };

    test('a series published from a draft opens and compiles back with nothing to update', async () => {
        const original = JSON.parse(fs.readFileSync(path.join(root, 'src', 'data', 'bible_series', 'matthew_2026.json'), 'utf8'));
        const json = compile(importSeriesJson(original).draft);
        const firestore = memoryFirestore();
        const loader = new DataLoaderService(firestore);
        const seriesId = await loader.loadBibleSeries(structuredClone(json.bible_series));
        await loader.loadSeriesContent(structuredClone(json.series_content), seriesId);

        const service = new PublishedSeriesService(firestore);
        const reopened = compile(importSeriesJson(await service.export(seriesId)).draft);
        const { summary } = await service.plan(seriesId, reopened);
        assert.equal(summary.writeCount, 0);
        assert.equal(summary.unchanged, json.series_content.length);
    });

    // Older series were loaded from hand-written JSON with the CLI. Opening one
    // can't reproduce it exactly (blank scripture titles, another NIV edition,
    // trailing spaces); an untouched draft must still have nothing to update.
    const dir = path.join(root, 'src', 'data', 'bible_series');
    const files = fs.readdirSync(dir).filter((f) => {
        try {
            return Array.isArray(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).series_content);
        } catch {
            return false;
        }
    });

    async function loadLikeCli(file) {
        const original = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
        const firestore = memoryFirestore();
        const loader = new DataLoaderService(firestore);
        const seriesId = await loader.loadBibleSeries({ ...original.bible_series });
        await loader.loadSeriesContent(original.series_content, seriesId);
        const recompile = createRecompiler(bible);
        const service = new PublishedSeriesService(firestore, { recompile });
        return { firestore, seriesId, service, opened: recompile(await service.export(seriesId)) };
    }

    test('series loaded with the CLI open with nothing to update', async () => {
        assert.ok(files.length > 10);
        for (const file of files) {
            const { seriesId, service, opened } = await loadLikeCli(file);
            const { summary } = await service.plan(seriesId, opened);
            assert.deepEqual(
                { series: summary.series, updated: summary.updated.map((u) => `${u.date} ${u.content_type} ${u.fields}`) },
                { series: [], updated: [] },
                file,
            );
        }
    });

    test('only what the draft changed is written; untouched blocks keep their stored form', async () => {
        const { firestore, seriesId, service, opened } = await loadLikeCli('Romans-2025.json');
        const edited = structuredClone(opened);
        const target = edited.series_content.find((e) => e.content_type === 'reflect');
        target.body.find((b) => b.body_type === 'question').questions[0] = 'What stood out to you?';
        const { writes, summary } = await service.plan(seriesId, edited);
        assert.deepEqual(summary.updated.map((u) => [u.date, u.content_type, u.fields]), [[target.date, 'reflect', ['body']]]);
        const [{ before, after }] = summary.updated;
        assert.deepEqual(after.filter((l) => !before.includes(l)), ['What stood out to you?']);
        const original = contentDocs(firestore, seriesId).find((d) => d.date === target.date && d.content_type === 'reflect');
        await service.apply(seriesId, writes);
        const stored = contentDocs(firestore, seriesId).find((d) => d.date === target.date && d.content_type === 'reflect');
        // Only the edited block is replaced; the scripture keeps its stored form.
        stored.body.forEach((block, i) => {
            assert.deepEqual(block, block.body_type === 'question' ? target.body[i] : original.body[i]);
        });
        assert.equal((await service.plan(seriesId, edited)).summary.writeCount, 0);
    });
});

describe('PublishService updates', () => {
    async function setup() {
        const firestore = memoryFirestore();
        const seriesId = await publishFixture(firestore);
        const drafts = new DraftService(firestore, { now: () => { const t = Date.now(); return { toMillis: () => t }; } });
        const { id: draftId } = await drafts.create({ meta: { title: 'Matthew' }, days: [] });
        const publisher = new PublishService({
            getDrafts: () => drafts,
            getLoader: () => new DataLoaderService(firestore),
            getPublished: () => new PublishedSeriesService(firestore),
            getEnv: () => 'dev',
        });
        return { firestore, seriesId, drafts, draftId, publisher };
    }
    const edited = () => {
        const c = content();
        c[0].title = 'Read today';
        return { bible_series: series, series_content: c };
    };

    test('links a draft to one series, and a series to one draft', async () => {
        const { seriesId, drafts, draftId, publisher } = await setup();
        await assert.rejects(publisher.previewUpdate(draftId, edited()), (e) => e.status === 404 && /hasn't been published/.test(e.message));

        const { record } = await publisher.link(draftId, seriesId, { updatedBy: 'uid-admin-1' });
        assert.equal(record.kind, 'import');
        assert.equal(record.total, 5);
        assert.equal(record.updated_by, 'uid-admin-1');
        assert.deepEqual(await publisher.link(draftId, seriesId), { seriesId }, 'linking twice is a no-op');
        assert.equal((await drafts.getPublishes(draftId)).publishes.length, 1);
        await assert.rejects(publisher.link(draftId, 'other'), (e) => e.status === 409 && /already linked/.test(e.message));

        // A second draft can't be linked to the same series; the error names the existing draft.
        const { id: secondId } = await drafts.create({ meta: { title: 'Matthew again' }, days: [] });
        await assert.rejects(publisher.link(secondId, 'missing'), { status: 404 });
        await assert.rejects(publisher.link(secondId, seriesId), (e) => e.status === 409 && e.details.draftId === draftId);
        await drafts.remove(draftId);
        await publisher.link(secondId, seriesId);
        assert.deepEqual((await drafts.list()).map((d) => [d.id, d.seriesId]), [[secondId, seriesId]], 'deleted drafts do not count');

        const preview = await publisher.previewUpdate(secondId, edited());
        assert.equal(preview.updated.length, 1);
        assert.equal(preview.seriesId, seriesId);
        assert.equal(preview.env, 'dev');
    });

    test('a published draft updates its series instead of publishing again, unless the series was deleted', async () => {
        const { firestore, seriesId, drafts, draftId, publisher } = await setup();
        await publisher.link(draftId, seriesId);
        await assert.rejects(publisher.start(draftId, edited()), (e) => e.status === 409 && e.details.seriesId === seriesId);

        firestore.store.delete(`bible_series/${seriesId}`);
        await assert.rejects(publisher.previewUpdate(draftId, edited()), (e) => e.status === 404 && e.details.seriesMissing && /deleted/.test(e.message));
        const started = await publisher.start(draftId, edited(), { updatedBy: 'uid-admin-1' });
        await Promise.all(publisher.running.values());
        assert.notEqual(started.seriesId, seriesId);
        assert.equal((await drafts.getPublishes(draftId)).seriesId, started.seriesId);
        assert.equal(firestore.store.get(`bible_series/${started.seriesId}`).series_content_snippet.length, 3);
    });

    test('applies the previewed changes and records them on the draft', async () => {
        const { firestore, seriesId, drafts, draftId, publisher } = await setup();
        await publisher.link(draftId, seriesId);
        const preview = await publisher.previewUpdate(draftId, edited());

        // Someone edits the series in the console after the preview.
        const other = contentDocs(firestore, seriesId).find((d) => d.content_type === 'pray');
        await firestore.collection('bible_series').doc(seriesId).collection('series_content').doc(other.id).update({ title: 'Changed' });
        await assert.rejects(publisher.applyUpdate(draftId, edited(), preview.planHash), { status: 409 });

        const fresh = await publisher.previewUpdate(draftId, edited());
        const result = await publisher.applyUpdate(draftId, edited(), fresh.planHash, { updatedBy: 'uid-editor-2' });
        assert.equal(result.record.status, 'done');
        assert.equal(result.record.kind, 'update');
        assert.equal(result.record.updated, 2);
        assert.equal(result.record.updated_by, 'uid-editor-2');
        assert.ok(contentDocs(firestore, seriesId).some((d) => d.title === 'Read today'));

        const { publishes } = await drafts.getPublishes(draftId);
        assert.deepEqual(publishes.map((r) => [r.kind, r.status]), [['import', 'done'], ['update', 'done']]);

        const noop = await publisher.applyUpdate(draftId, edited());
        assert.equal(noop.record, null);
        assert.equal((await drafts.getPublishes(draftId)).publishes.length, 2);
    });

    test('a failed write is recorded', async () => {
        const { firestore, seriesId, drafts, draftId, publisher } = await setup();
        await publisher.link(draftId, seriesId);
        firestore.batch = () => ({ set() {}, update() {}, delete() {}, commit: async () => { throw new Error('permission denied'); } });
        await assert.rejects(publisher.applyUpdate(draftId, edited()), { status: 502 });
        const { publishes: [, record] } = await drafts.getPublishes(draftId);
        assert.equal(record.status, 'failed');
        assert.match(record.error, /permission denied/);
    });
});

describe('published series routes', () => {
    test('list, export, and update over HTTP', async () => {
        const firestore = memoryFirestore();
        const seriesId = await publishFixture(firestore);
        const published = new PublishedSeriesService(firestore);
        const drafts = new DraftService(firestore, { now: () => { const t = Date.now(); return { toMillis: () => t }; } });
        const publisher = new PublishService({ getDrafts: () => drafts, getLoader: () => null, getPublished: () => published, getEnv: () => 'dev' });
        const app = express();
        app.use(express.json());
        // As set by the API's admin check (src/routes/apiAuth.js).
        app.use((req, res, next) => { req.admin = { uid: 'uid-admin-1', email: 'admin@wpa.church', projectId: 'p' }; next(); });
        app.use('/api/published', createPublishedRouter(() => ({ service: published, env: 'dev' })));
        app.use('/api/drafts', createDraftRouter(() => ({ service: drafts, projectId: 'p' }), publisher));
        const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
        const base = `http://127.0.0.1:${server.address().port}`;
        const post = (url, json) => fetch(`${base}${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(json) });
        try {
            const list = await (await fetch(`${base}/api/published`)).json();
            assert.equal(list.env, 'dev');
            assert.deepEqual(list.series.map((s) => [s.id, s.title, s.startDate, s.endDate]), [[seriesId, 'Matthew', '2026-02-02', '2026-02-04']]);
            const exported = await (await fetch(`${base}/api/published/${seriesId}`)).json();
            assert.equal(exported.series_content.length, 5);
            assert.equal((await fetch(`${base}/api/published/nope`)).status, 404);

            const { id: draftId } = await drafts.create({ meta: { title: 'Matthew' }, days: [] });
            assert.equal((await post(`/api/drafts/${draftId}/link`, { seriesId })).status, 201);
            const { id: otherId } = await drafts.create({ meta: { title: 'Matthew' }, days: [] });
            const duplicate = await post(`/api/drafts/${otherId}/link`, { seriesId });
            assert.equal(duplicate.status, 409);
            assert.equal((await duplicate.json()).draftId, draftId);
            const json = { bible_series: { ...series, is_active: true }, series_content: content() };
            const preview = await (await post(`/api/drafts/${draftId}/update-preview`, { json })).json();
            assert.deepEqual(preview.series, [{ field: 'is_active', from: false, to: true }]);
            // Who made the change is the verified admin, whatever the body claims.
            const applied = await post(`/api/drafts/${draftId}/update`, { json, planHash: preview.planHash, updatedBy: 'someone-else' });
            assert.equal(applied.status, 200);
            assert.equal((await applied.json()).record.updated_by, 'uid-admin-1');
            assert.equal(firestore.store.get(`bible_series/${seriesId}`).is_active, true);
            assert.equal((await post(`/api/drafts/${otherId}/update`, { json })).status, 404, 'not published');
        } finally {
            server.close();
        }
    });
});

describe('drafts per environment', () => {
    test('a draft is copied to the other environment once, then replaced on request', async () => {
        const now = () => { const t = Date.now(); return { toMillis: () => t }; };
        const stores = {
            prod: new DraftService(memoryFirestore(), { now, env: 'prod' }),
            dev: new DraftService(memoryFirestore(), { now, env: 'dev' }),
        };
        const app = express();
        app.use(express.json());
        app.use('/api/drafts', createDraftRouter(() => ({ service: stores.dev, projectId: 'wpa-be-app-dev', env: 'dev' }), null, (env) => stores[env]));
        const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
        const base = `http://127.0.0.1:${server.address().port}`;
        const copy = (id, body) => fetch(`${base}/api/drafts/${id}/copy-to`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        try {
            const { id } = await stores.dev.create({ meta: { title: 'Psalms' }, days: [{ date: '2026-07-06' }] });
            await stores.dev.setSeriesId(id, 'DEV1');
            await stores.dev.addPublish(id, { status: 'done' });

            assert.deepEqual((await stores.prod.list()).length, 0, 'drafts are not shared');
            const first = await copy(id, { env: 'prod' });
            assert.equal(first.status, 201);
            const { id: prodId } = await first.json();
            const [listed] = await stores.prod.list();
            assert.equal(listed.id, prodId);
            assert.equal(listed.seriesId, null, 'the linked series stays with the source environment');
            assert.deepEqual((await stores.prod.getPublishes(prodId)).publishes, []);
            assert.equal((await stores.prod.get(prodId)).draft.meta.title, 'Psalms');

            await stores.dev.save(id, { meta: { title: 'Psalms 2026' }, days: [] }, 1);
            const again = await copy(id, { env: 'prod' });
            assert.equal(again.status, 409);
            assert.equal((await again.json()).draftId, prodId);
            const replaced = await copy(id, { env: 'prod', replace: true });
            assert.equal(replaced.status, 200);
            assert.equal((await stores.prod.get(prodId)).draft.meta.title, 'Psalms 2026');
            assert.equal((await stores.prod.list()).length, 1);

            assert.equal((await copy(id, { env: 'dev' })).status, 400);
            const missing = await fetch(`${base}/api/drafts/not-in-dev`);
            assert.equal(missing.status, 404);
            assert.match((await missing.json()).error, /not found in dev/);
        } finally {
            server.close();
        }
    });
});
