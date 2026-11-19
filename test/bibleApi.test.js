import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { BibleService, BibleServiceError, loadBibleService } from '../src/services/bibleService.js';
import { createBibleProxyAdminRouter, createBibleRouter } from '../src/routes/bibleRoutes.js';
import { ApiBibleClient, ApiBibleError } from '../src/services/apiBibleClient.js';
import { ApiBibleService } from '../src/services/apiBibleService.js';
import { FakeApiBibleClient, createTestBible } from './helpers/fakeApiBible.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const NIV_FILE = path.join(__dirname, '..', 'src', 'data', 'niv.json');

// Small fixture with out-of-lexicographic-order chapter/verse numbers so the
// tests prove numeric (not string) ordering.
const FIXTURE = {
    Genesis: {
        '10': { '2': 'Gen 10:2', '10': 'Gen 10:10', '1': 'Gen 10:1' },
        '2': { '1': 'Gen 2:1' },
        '1': { '1': 'In the beginning God created the heavens and the earth.', '2': 'Gen 1:2' },
    },
    Psalms: {
        '1': { '1': 'Psalm 1:1' },
    },
    '1 Samuel': {
        '1': { '1': '1 Samuel 1:1' },
    },
};

const FIXTURE_BIBLE = { id: 'fx', abbreviation: 'FX', name: 'Fixture Version', language: 'English', copyright: 'Fixture copyright' };

function fixtureService(options = { defaultBibleId: 'fx' }) {
    return new ApiBibleService(new FakeApiBibleClient({ fx: { info: FIXTURE_BIBLE, data: FIXTURE } }), options);
}

function startServer(service) {
    const app = express();
    app.use('/api/bible', createBibleRouter(service, { unavailableReason: 'Bible API not configured' }));
    return new Promise((resolve) => {
        const server = app.listen(0, '127.0.0.1', () => {
            resolve({ server, base: `http://127.0.0.1:${server.address().port}` });
        });
    });
}

// The admin's ID token, which the /api guard has checked and the routes
// forward to the Bible proxy.
const ADMIN_TOKEN = 'admin-id-token';

async function getJson(base, urlPath, { token = ADMIN_TOKEN } = {}) {
    const res = await fetch(`${base}${urlPath}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    const body = await res.json();
    return { status: res.status, headers: res.headers, body };
}

describe('BibleService (fixture data)', () => {
    const service = new BibleService(FIXTURE);

    test('getBooks returns every book in file order with chapter counts', () => {
        assert.deepEqual(service.getBooks(), {
            version: 'NIV',
            books: [
                { name: 'Genesis', chapterCount: 3 },
                { name: 'Psalms', chapterCount: 1 },
                { name: '1 Samuel', chapterCount: 1 },
            ],
        });
    });

    test('getChapters returns chapters sorted numerically with verse counts', () => {
        assert.deepEqual(service.getChapters('Genesis'), {
            version: 'NIV',
            book: 'Genesis',
            chapters: [
                { chapter: 1, verseCount: 2 },
                { chapter: 2, verseCount: 1 },
                { chapter: 10, verseCount: 3 },
            ],
        });
    });

    test('getChapters resolves book names case-insensitively to the canonical name', () => {
        assert.equal(service.getChapters('genesis').book, 'Genesis');
        assert.equal(service.getChapters('GENESIS').book, 'Genesis');
    });

    test('getChapters resolves the singular "Psalm" alias to "Psalms"', () => {
        assert.equal(service.getChapters('Psalm').book, 'Psalms');
    });

    test('getChapters throws a 404 BibleServiceError for an unknown book', () => {
        assert.throws(
            () => service.getChapters('Hezekiah'),
            (err) => err instanceof BibleServiceError && err.status === 404,
        );
    });

    test('getVerses returns verses sorted numerically as {verse, text}', () => {
        assert.deepEqual(service.getVerses('Genesis', '10'), {
            version: 'NIV',
            book: 'Genesis',
            chapter: 10,
            verses: [
                { verse: 1, text: 'Gen 10:1' },
                { verse: 2, text: 'Gen 10:2' },
                { verse: 10, text: 'Gen 10:10' },
            ],
        });
    });

    test('getVerses accepts a numeric chapter and rejects malformed chapters with 400', () => {
        assert.equal(service.getVerses('Genesis', 1).chapter, 1);
        for (const bad of ['abc', '0', '-1', '1.5', '']) {
            assert.throws(
                () => service.getVerses('Genesis', bad),
                (err) => err instanceof BibleServiceError && err.status === 400,
                `expected 400 for chapter ${JSON.stringify(bad)}`,
            );
        }
    });

    test('getVerses throws 404 for a chapter outside the book', () => {
        assert.throws(
            () => service.getVerses('Genesis', '99'),
            (err) => err instanceof BibleServiceError && err.status === 404,
        );
        assert.throws(
            () => service.getVerses('Hezekiah', '1'),
            (err) => err instanceof BibleServiceError && err.status === 404,
        );
    });
});

describe('Bible API routes (/api/bible/:bibleId)', () => {
    let server;
    let base;

    before(async () => {
        ({ server, base } = await startServer(fixtureService()));
    });

    after(() => server.close());

    test('GET /books returns the translation\'s books in canonical order', async () => {
        for (const id of ['default', 'fx']) {
            const { status, body } = await getJson(base, `/api/bible/${id}/books`);
            assert.equal(status, 200);
            assert.equal(body.version, 'FX');
            assert.equal(body.bible.id, 'fx');
            assert.deepEqual(body.books.map((b) => b.name), ['Genesis', '1 Samuel', 'Psalms']);
            assert.deepEqual(body.books[0], { name: 'Genesis', chapterCount: 3 });
        }
    });

    test('GET /books/:book/chapters lists the translation\'s chapters with usual verse counts', async () => {
        const { status, body } = await getJson(base, '/api/bible/default/books/1%20Samuel/chapters');
        assert.equal(status, 200);
        assert.equal(body.book, '1 Samuel');
        // Verse counts come from the versification table, not a chapter fetch.
        assert.deepEqual(body.chapters, [{ chapter: 1, verseCount: 28 }]);
        const genesis = await getJson(base, '/api/bible/default/books/genesis/chapters');
        assert.deepEqual(genesis.body.chapters.map((c) => c.chapter), [1, 2, 10]);
    });

    test('GET /books/:book/chapters returns 404 with an error for an unknown book', async () => {
        const { status, body } = await getJson(base, '/api/bible/default/books/Hezekiah/chapters');
        assert.equal(status, 404);
        assert.match(body.error, /not found/i);
    });

    test('GET /books/:book/chapters/:chapter/verses returns the chapter verses', async () => {
        const { status, body } = await getJson(base, '/api/bible/default/books/Genesis/chapters/1/verses');
        assert.equal(status, 200);
        assert.equal(body.book, 'Genesis');
        assert.equal(body.chapter, 1);
        assert.deepEqual(body.verses[0], {
            verse: 1,
            text: 'In the beginning God created the heavens and the earth.',
        });
    });

    test('verses route returns 400 for a malformed chapter and 404 beyond the book', async () => {
        const malformed = await getJson(base, '/api/bible/default/books/Genesis/chapters/abc/verses');
        assert.equal(malformed.status, 400);
        assert.ok(malformed.body.error);

        const missing = await getJson(base, '/api/bible/default/books/Genesis/chapters/99/verses');
        assert.equal(missing.status, 404);
        assert.ok(missing.body.error);
    });

    test('GET /translations lists translations and the default; unknown Bibles are 404', async () => {
        const { status, body } = await getJson(base, '/api/bible/translations');
        assert.equal(status, 200);
        assert.equal(body.default, 'fx');
        assert.deepEqual(body.bibles.map((b) => [b.id, b.abbreviation]), [['fx', 'FX']]);
        const unknown = await getJson(base, '/api/bible/nope/books');
        assert.equal(unknown.status, 404);
        assert.match(unknown.body.error, /nope/);
    });
});

describe('Bible API translation settings', () => {
    test('only allowed translations are served', async () => {
        const { server, base } = await startServer(fixtureService({ defaultBibleId: 'fx', allowedBibleIds: ['fx'] }));
        try {
            const blocked = await getJson(base, `/api/bible/other/passage?ref=${encodeURIComponent('Genesis 1:1')}`);
            assert.equal(blocked.status, 400);
            assert.match(blocked.body.error, /not enabled/);
        } finally {
            server.close();
        }
    });

    test('without a default, "default" is a configuration error but explicit IDs work', async () => {
        const { server, base } = await startServer(fixtureService({}));
        try {
            const noDefault = await getJson(base, '/api/bible/default/books');
            assert.equal(noDefault.status, 503);
            assert.match(noDefault.body.error, /API_BIBLE_DEFAULT_BIBLE_ID/);
            assert.equal((await getJson(base, '/api/bible/fx/books')).status, 200);
        } finally {
            server.close();
        }
    });

    test('the first allowed translation is the default when none is set', () => {
        const service = fixtureService({ allowedBibleIds: ['fx', 'other'] });
        assert.equal(service.resolveBibleId('default'), 'fx');
        assert.equal(service.resolveBibleId(''), 'fx');
    });
});

describe('Bible API without a Bible service', () => {
    let server;
    let base;

    before(async () => {
        ({ server, base } = await startServer(null));
    });

    after(() => server.close());

    test('all endpoints return 503 with an error', async () => {
        for (const urlPath of [
            '/api/bible/translations',
            '/api/bible/default/books',
            '/api/bible/default/books/Genesis/chapters',
            '/api/bible/default/books/Genesis/chapters/1/verses',
            `/api/bible/default/passage?ref=${encodeURIComponent('Romans 4:1-6')}`,
        ]) {
            const { status, body } = await getJson(base, urlPath);
            assert.equal(status, 503, urlPath);
            assert.equal(body.error, 'Bible API not configured', urlPath);
        }
    });
});

describe('BibleService against the real niv.json', () => {
    test('loadBibleService reads the bundled NIV file', () => {
        assert.ok(fs.existsSync(NIV_FILE), 'src/data/niv.json must exist');
        const service = loadBibleService(NIV_FILE);

        const { books } = service.getBooks();
        assert.equal(books.length, 66);
        assert.deepEqual(books[0], { name: 'Genesis', chapterCount: 50 });
        assert.deepEqual(books.at(-1), { name: 'Revelation', chapterCount: 22 });

        const psalms = service.getChapters('Psalms');
        assert.equal(psalms.chapters.length, 150);
        assert.deepEqual(psalms.chapters[0], { chapter: 1, verseCount: 6 });

        const john3 = service.getVerses('John', '3');
        const verse16 = john3.verses.find((v) => v.verse === 16);
        assert.match(verse16.text, /For God so loved the world/);

        // Boundary: last chapter of the last book exists, the next does not.
        assert.equal(service.getVerses('Revelation', '22').chapter, 22);
        assert.throws(
            () => service.getVerses('Revelation', '23'),
            (err) => err instanceof BibleServiceError && err.status === 404,
        );
        // Single-chapter book boundary.
        assert.equal(service.getVerses('Jude', '1').chapter, 1);
        assert.throws(
            () => service.getVerses('Jude', '2'),
            (err) => err instanceof BibleServiceError && err.status === 404,
        );
    });
});

describe('BibleService passage references (real niv.json)', () => {
    const service = loadBibleService(NIV_FILE);
    const coords = (result) => result.verses.map((v) => [v.chapter, v.verse]);

    test('resolves a verse range like "romans 4:1-6" to exactly those verses', () => {
        const result = service.getPassage('romans 4:1-6');
        assert.equal(result.version, 'NIV');
        assert.equal(result.reference, 'Romans 4:1-6');
        assert.equal(result.book, 'Romans');
        assert.equal(result.chapter, 4);
        assert.deepEqual(result.chapters, [4]);
        assert.deepEqual(coords(result), [[4, 1], [4, 2], [4, 3], [4, 4], [4, 5], [4, 6]]);
        assert.match(result.verses[0].text, /^What then shall we say/);
        assert.match(result.verses.at(-1).text, /^David says the same thing/);
    });

    test('resolves a single verse and a whole chapter', () => {
        const single = service.getPassage('John 3:16');
        assert.equal(single.reference, 'John 3:16');
        assert.deepEqual(coords(single), [[3, 16]]);

        const whole = service.getPassage('Romans 4');
        assert.equal(whole.reference, 'Romans 4');
        assert.equal(whole.verses.length, 25);
        assert.deepEqual(coords(whole).at(-1), [4, 25]);
    });

    test('resolves multiple ranges in one chapter, sorted and de-duplicated', () => {
        const disjoint = service.getPassage('Romans 4:5, 1-3');
        assert.deepEqual(coords(disjoint), [[4, 1], [4, 2], [4, 3], [4, 5]]);
        assert.equal(disjoint.reference, 'Romans 4:1-3, 5');

        const overlapping = service.getPassage('Romans 4:3, 1-3');
        assert.deepEqual(coords(overlapping), [[4, 1], [4, 2], [4, 3]]);
        assert.equal(overlapping.reference, 'Romans 4:1-3');
    });

    test('resolves cross-chapter and whole-chapter ranges', () => {
        const cross = service.getPassage('Romans 4:23-5:2');
        assert.equal(cross.reference, 'Romans 4:23-5:2');
        assert.equal(cross.chapter, null);
        assert.deepEqual(cross.chapters, [4, 5]);
        assert.deepEqual(coords(cross), [[4, 23], [4, 24], [4, 25], [5, 1], [5, 2]]);

        const chapters = service.getPassage('Romans 4-5');
        assert.equal(chapters.reference, 'Romans 4-5');
        assert.equal(chapters.verses.length, 46);
        assert.deepEqual(coords(chapters)[0], [4, 1]);
        assert.deepEqual(coords(chapters).at(-1), [5, 21]);
    });

    test('resolves common book abbreviations to canonical books', () => {
        assert.equal(service.getPassage('Rom 4:1').book, 'Romans');
        assert.equal(service.getPassage('Ps 23:1').book, 'Psalms');
        assert.equal(service.getPassage('Psalm 23').verses.length, 6);
        const cor = service.getPassage('1 Cor 13:4');
        assert.equal(cor.book, '1 Corinthians');
        assert.match(cor.verses[0].text, /^Love is patient/);
        assert.equal(service.getPassage('1 Sam 1:1').book, '1 Samuel');
        assert.equal(service.getPassage('Gen 1:1').book, 'Genesis');
    });

    test('rejects malformed references with 400', () => {
        for (const bad of ['', '   ', 'not a reference', 'Romans', 'Romans 4:6-1', 'Romans 4:0', 'Romans 0:1', 'Romans 4:1-']) {
            assert.throws(
                () => service.getPassage(bad),
                (err) => err instanceof BibleServiceError && err.status === 400,
                `expected 400 for ${JSON.stringify(bad)}`,
            );
        }
        assert.throws(
            () => service.getPassage(undefined),
            (err) => err instanceof BibleServiceError && err.status === 400,
        );
    });

    test('returns 404 for unknown books, chapters, and verses (no clamping)', () => {
        for (const missing of ['Hezekiah 1:1', 'Romans 99', 'Romans 4:99', 'Romans 4:1-99', 'Romans 4:23-99:1']) {
            assert.throws(
                () => service.getPassage(missing),
                (err) => err instanceof BibleServiceError && err.status === 404,
                `expected 404 for ${JSON.stringify(missing)}`,
            );
        }
    });
});

describe('Bible passage route (/api/bible/:bibleId/passage)', () => {
    let server;
    let base;
    let client;

    before(async () => {
        const bible = createTestBible();
        client = bible.client;
        ({ server, base } = await startServer(bible.service));
    });

    after(() => server.close());

    test('GET ?ref=romans 4:1-6 returns the six verses', async () => {
        const { status, body } = await getJson(
            base,
            `/api/bible/default/passage?ref=${encodeURIComponent('romans 4:1-6')}`,
        );
        assert.equal(status, 200);
        assert.equal(body.reference, 'Romans 4:1-6');
        assert.equal(body.bookId, 'ROM');
        assert.equal(body.bible.id, 'test-niv');
        assert.match(body.bible.copyright, /Biblica/);
        assert.equal(body.verses.length, 6);
        assert.deepEqual(body.verses.map((v) => v.verse), [1, 2, 3, 4, 5, 6]);
    });

    test('lookups are made with the requesting admin\'s ID token', async () => {
        await getJson(base, `/api/bible/default/passage?ref=${encodeURIComponent('John 3:16')}`, { token: 'someone-else' });
        const auth = client.auths.at(-1);
        assert.equal(await auth.getToken(), 'someone-else');
        assert.equal(auth.canRefresh, false, 'a forwarded token is not refreshed on the server');
    });

    test('only the chapters a reference touches are fetched, once', async () => {
        const before = client.chapterRequests.length;
        await getJson(base, `/api/bible/default/passage?ref=${encodeURIComponent('Romans 4:23-5:2')}`);
        assert.deepEqual(client.chapterRequests.slice(before), ['ROM.4', 'ROM.5']);
    });

    test('very long passages are refused before anything is fetched', async () => {
        const before = client.chapterRequests.length;
        const { status, body } = await getJson(base, `/api/bible/default/passage?ref=${encodeURIComponent('Psalms 1-150')}`);
        assert.equal(status, 400);
        assert.match(body.error, /too long/);
        assert.equal(client.chapterRequests.length, before);
    });

    test('GET without ref returns 400, unknown passage returns 404', async () => {
        const missingRef = await getJson(base, '/api/bible/default/passage');
        assert.equal(missingRef.status, 400);
        assert.ok(missingRef.body.error);

        const unknown = await getJson(
            base,
            `/api/bible/default/passage?ref=${encodeURIComponent('Romans 4:1-99')}`,
        );
        assert.equal(unknown.status, 404);
        assert.ok(unknown.body.error);
    });
});

describe('Bible proxy errors through /api/bible', () => {
    // A client whose every call fails the way the proxy can fail.
    function failingService(error) {
        const client = new FakeApiBibleClient({});
        client.getBible = async () => { throw error; };
        client.getBooks = async () => { throw error; };
        return new ApiBibleService(client, { defaultBibleId: 'b1' });
    }

    test('401, 403, 429 and 503 keep their status, and Retry-After is passed on', async () => {
        for (const [error, status, retryAfter] of [
            [new ApiBibleError('Your session has expired; sign in again', 401, 401), 401, null],
            [new ApiBibleError('The Bible proxy only serves administrators', 403, 403), 403, null],
            [new ApiBibleError('Too many scripture requests; try again in 30 seconds', 429, 429, { retryAfter: 30 }), 429, '30'],
            [new ApiBibleError('Scripture is temporarily unavailable; try again later', 503, 502), 503, null],
        ]) {
            const { server, base } = await startServer(failingService(error));
            try {
                const { status: got, headers, body } = await getJson(base, '/api/bible/default/books');
                assert.equal(got, status, error.message);
                assert.equal(body.error, error.message);
                assert.equal(headers.get('retry-after'), retryAfter);
            } finally {
                server.close();
            }
        }
    });
});

describe('Bible proxy admin routes (/api/bible-proxy)', () => {
    let server;
    let base;
    const calls = [];
    let reply = { status: 200, body: { ok: true } };

    before(async () => {
        const client = new ApiBibleClient({
            baseUrl: 'https://proxy.test/admin/v1',
            fums: false,
            fetch: async (url, init) => {
                calls.push({ url: String(url), init });
                return {
                    ok: reply.status < 300,
                    status: reply.status,
                    statusText: '',
                    headers: { get: (name) => reply.headers?.[name.toLowerCase()] ?? null },
                    json: async () => reply.body,
                    text: async () => JSON.stringify(reply.body),
                };
            },
        });
        const app = express();
        app.use('/api/bible-proxy', createBibleProxyAdminRouter(new ApiBibleService(client)));
        await new Promise((resolve) => {
            server = app.listen(0, '127.0.0.1', () => {
                base = `http://127.0.0.1:${server.address().port}`;
                resolve();
            });
        });
    });

    after(() => server.close());

    const post = (urlPath, json, token = ADMIN_TOKEN) => fetch(`${base}${urlPath}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
        body: JSON.stringify(json),
    });

    test('stats, whoami and routes are fetched from the proxy as the requesting admin', async () => {
        for (const name of ['stats', 'whoami', 'routes']) {
            reply = { status: 200, body: { name } };
            const { status, body } = await getJson(base, `/api/bible-proxy/${name}`);
            assert.equal(status, 200);
            assert.deepEqual(body, { name });
            assert.equal(calls.at(-1).url, `https://proxy.test/admin/${name}`);
            assert.equal(calls.at(-1).init.headers.authorization, `Bearer ${ADMIN_TOKEN}`);
        }
    });

    test('a purge needs exactly one target and is forwarded as is', async () => {
        reply = { status: 200, body: { purged: 3 } };
        for (const target of [{ all: true }, { bibleId: 'de4e12af7f28f599-02' }, { audioBibleId: 'abc_1' }]) {
            const res = await post('/api/bible-proxy/cache/purge', target);
            assert.equal(res.status, 200);
            assert.equal(calls.at(-1).url, 'https://proxy.test/admin/cache/purge');
            assert.equal(calls.at(-1).init.method, 'POST');
            assert.deepEqual(JSON.parse(calls.at(-1).init.body), target);
        }
        const before = calls.length;
        for (const bad of [{}, { all: false }, { all: true, bibleId: 'x' }, { bibleId: '../x' }, { other: 1 }]) {
            assert.equal((await post('/api/bible-proxy/cache/purge', bad)).status, 400, JSON.stringify(bad));
        }
        assert.equal(calls.length, before, 'invalid purges are not sent');
    });

    test('the proxy\'s errors are passed on', async () => {
        reply = { status: 403, body: { statusCode: 403, error: 'Forbidden', message: 'Not an admin.' } };
        const { status, body } = await getJson(base, '/api/bible-proxy/stats');
        assert.equal(status, 403);
        assert.match(body.error, /Not an admin/);
    });
});
