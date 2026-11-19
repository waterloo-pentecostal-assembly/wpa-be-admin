import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryFirestore } from './helpers/memoryFirestore.js';
import { fillEmptyPsalmsVerses } from '../src/cli/maintenance.js';
import { DataManagerService } from '../src/services/dataManagerService.js';
import { DataFetchingService } from '../src/services/dataFetchingService.js';

describe('CLI maintenance tasks', () => {
    test('fillEmptyPsalmsVerses fills only empty Psalms entries it has text for', () => {
        const json = {
            series_content: [{
                body: [
                    { body_type: 'scripture', scriptures: [
                        { book: 'Psalms', chapter: '23', verses: {} },
                        { book: 'Psalms', chapter: '1', verses: { 1: 'kept' } },
                        { book: 'Psalms', chapter: '999', verses: {} },
                        { book: 'Romans', chapter: '8', verses: {} },
                    ] },
                    { body_type: 'text', paragraphs: ['x'] },
                ],
            }],
        };
        const filled = fillEmptyPsalmsVerses(json, { Psalms: { 23: { 1: 'The Lord is my shepherd' }, 1: { 1: 'other' } } });
        assert.equal(filled, 1);
        const [ps23, ps1, ps999, rom8] = json.series_content[0].body[0].scriptures;
        assert.deepEqual(ps23.verses, { 1: 'The Lord is my shepherd' });
        assert.deepEqual(ps1.verses, { 1: 'kept' });
        assert.deepEqual(ps999.verses, {});
        assert.deepEqual(rom8.verses, {});
    });

    test('updateYoutubeLinks reports in a dry run, then converts; embed URLs and unparseable links are left alone', async () => {
        const firestore = memoryFirestore();
        await firestore.collection('bible_series').doc('s1').set({ title: 'S' });
        const content = firestore.collection('bible_series').doc('s1').collection('series_content');
        await content.doc('c1').set({ body: [
            { body_type: 'link', link: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', text: 'Song' },
            { body_type: 'link', link: 'https://youtube.com/embed/dQw4w9WgXcQ', text: 'Already' },
            { body_type: 'link', link: 'https://youtube.com/@channel', text: 'Unparseable' },
            { body_type: 'text', paragraphs: ['hi'] },
        ] });
        await content.doc('c2').set({ body: [{ body_type: 'link', link: 'https://example.org', text: 'Other' }] });
        const service = new DataManagerService(firestore);
        const before = JSON.stringify(firestore.store.get('bible_series/s1/series_content/c1'));

        const dry = await service.updateYoutubeLinks({ dryRun: true, log: () => {} });
        assert.deepEqual(dry, [{ seriesId: 's1', contentId: 'c1', from: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', to: 'https://youtube.com/embed/dQw4w9WgXcQ' }]);
        assert.equal(JSON.stringify(firestore.store.get('bible_series/s1/series_content/c1')), before, 'a dry run writes nothing');

        const applied = await service.updateYoutubeLinks({ log: () => {} });
        assert.equal(applied.length, 1);
        const links = firestore.store.get('bible_series/s1/series_content/c1').body.map((b) => b.link);
        assert.deepEqual(links, ['https://youtube.com/embed/dQw4w9WgXcQ', 'https://youtube.com/embed/dQw4w9WgXcQ', 'https://youtube.com/@channel', undefined]);
        assert.deepEqual(await service.updateYoutubeLinks({ dryRun: true, log: () => {} }), [], 'nothing left to convert');
    });

    test('getUniqueUsersForSeries returns the count', async () => {
        const firestore = memoryFirestore();
        for (const [id, user] of [['a', 'u1'], ['b', 'u1'], ['c', 'u2']]) {
            await firestore.collection('completions').doc(id).set({ series_id: 's1', user_id: user });
        }
        await firestore.collection('completions').doc('d').set({ series_id: 's2', user_id: 'u3' });
        assert.equal(await new DataFetchingService(firestore).getUniqueUsersForSeries('s1'), 2);
    });
});

describe('Firebase web API key lookup', () => {
    test('dev reads firebase-client-config-dev.json (via FIREBASE_CLIENT_CONFIG_DEV); prod does not use it', async () => {
        const { loadWebApiKey } = await import('../src/config/firebaseClient.js');
        const saved = { ...process.env };
        try {
            delete process.env.FIREBASE_WEB_API_KEY_DEV;
            delete process.env.FIREBASE_WEB_API_KEY;
            process.env.FIREBASE_CLIENT_CONFIG_DEV = JSON.stringify({ apiKey: 'dev-key', projectId: 'proj-dev' });
            assert.equal(loadWebApiKey('dev', 'proj-dev'), 'dev-key');
            assert.equal(loadWebApiKey('dev', 'other-project'), null, 'a config for another project is ignored');
            process.env.FIREBASE_WEB_API_KEY_DEV = 'explicit';
            assert.equal(loadWebApiKey('dev', 'proj-dev'), 'explicit', 'the env var wins');
            assert.notEqual(loadWebApiKey('prod', 'proj-dev'), 'dev-key');
        } finally {
            for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
            Object.assign(process.env, saved);
        }
    });
});

describe('deleting old prayer requests', () => {
    test('counts, then deletes (with subcollections) only requests dated before the cutoff', async () => {
        const { DataDeletingService } = await import('../src/services/dataDeletingService.js');
        const firestore = memoryFirestore();
        const requests = firestore.collection('prayer_requests');
        await requests.doc('old').set({ date: new Date('2024-01-01T10:00:00'), request: 'a' });
        await requests.doc('old').collection('reports').doc('r1').set({ by: 'u1' });
        await requests.doc('lastDay').set({ date: new Date('2024-12-31T23:30:00'), request: 'b' });
        await requests.doc('cutoff').set({ date: new Date('2025-01-01T00:00:00'), request: 'c' });
        await requests.doc('new').set({ date: new Date('2025-06-01T09:00:00'), request: 'd' });
        await requests.doc('undated').set({ request: 'e' });
        const service = new DataDeletingService(firestore);
        const before = new Date('2025-01-01T00:00:00');

        assert.equal(await service.countOldPrayerRequests(before), 2);
        assert.ok(firestore.store.has('prayer_requests/old'), 'counting deletes nothing');

        const progress = [];
        assert.equal(await service.deleteOldPrayerRequests(before, { onProgress: (n, total) => progress.push(`${n}/${total}`) }), 2);
        assert.deepEqual(progress, ['1/2', '2/2']);
        assert.deepEqual([...firestore.store.keys()].sort(), ['prayer_requests/cutoff', 'prayer_requests/new', 'prayer_requests/undated']);
        assert.equal(await service.deleteOldPrayerRequests(before), 0);
    });
});
