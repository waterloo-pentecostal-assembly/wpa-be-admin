import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { BibleService, BibleServiceError, loadBibleService } from '../src/services/bibleService.js';
import { createBibleRouter } from '../src/routes/bibleRoutes.js';

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

function startServer(service) {
    const app = express();
    app.use('/api/bible/niv', createBibleRouter(service));
    return new Promise((resolve) => {
        const server = app.listen(0, '127.0.0.1', () => {
            resolve({ server, base: `http://127.0.0.1:${server.address().port}` });
        });
    });
}

async function getJson(base, urlPath) {
    const res = await fetch(`${base}${urlPath}`);
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

describe('Bible API routes (/api/bible/niv)', () => {
    let server;
    let base;

    before(async () => {
        ({ server, base } = await startServer(new BibleService(FIXTURE)));
    });

    after(() => server.close());

    test('GET /books returns all books', async () => {
        const { status, body } = await getJson(base, '/api/bible/niv/books');
        assert.equal(status, 200);
        assert.equal(body.version, 'NIV');
        assert.deepEqual(body.books.map((b) => b.name), ['Genesis', 'Psalms', '1 Samuel']);
    });

    test('GET /books/:book/chapters returns chapters for a URL-encoded book', async () => {
        const { status, body } = await getJson(base, '/api/bible/niv/books/1%20Samuel/chapters');
        assert.equal(status, 200);
        assert.equal(body.book, '1 Samuel');
        assert.deepEqual(body.chapters, [{ chapter: 1, verseCount: 1 }]);
    });

    test('GET /books/:book/chapters returns 404 with an error for an unknown book', async () => {
        const { status, body } = await getJson(base, '/api/bible/niv/books/Hezekiah/chapters');
        assert.equal(status, 404);
        assert.match(body.error, /not found/i);
    });

    test('GET /books/:book/chapters/:chapter/verses returns the chapter verses', async () => {
        const { status, body } = await getJson(base, '/api/bible/niv/books/Genesis/chapters/1/verses');
        assert.equal(status, 200);
        assert.equal(body.book, 'Genesis');
        assert.equal(body.chapter, 1);
        assert.deepEqual(body.verses[0], {
            verse: 1,
            text: 'In the beginning God created the heavens and the earth.',
        });
    });

    test('verses route returns 400 for a malformed chapter and 404 beyond the book', async () => {
        const malformed = await getJson(base, '/api/bible/niv/books/Genesis/chapters/abc/verses');
        assert.equal(malformed.status, 400);
        assert.ok(malformed.body.error);

        const missing = await getJson(base, '/api/bible/niv/books/Genesis/chapters/99/verses');
        assert.equal(missing.status, 404);
        assert.ok(missing.body.error);
    });
});

describe('Bible API when NIV data is unavailable', () => {
    let server;
    let base;

    before(async () => {
        ({ server, base } = await startServer(null));
    });

    after(() => server.close());

    test('all endpoints return 503 with an error', async () => {
        for (const urlPath of [
            '/api/bible/niv/books',
            '/api/bible/niv/books/Genesis/chapters',
            '/api/bible/niv/books/Genesis/chapters/1/verses',
            `/api/bible/niv/passage?ref=${encodeURIComponent('Romans 4:1-6')}`,
        ]) {
            const { status, body } = await getJson(base, urlPath);
            assert.equal(status, 503, urlPath);
            assert.ok(body.error, urlPath);
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

describe('Bible passage route (/api/bible/niv/passage)', () => {
    let server;
    let base;

    before(async () => {
        ({ server, base } = await startServer(loadBibleService(NIV_FILE)));
    });

    after(() => server.close());

    test('GET ?ref=romans 4:1-6 returns the six verses', async () => {
        const { status, body } = await getJson(
            base,
            `/api/bible/niv/passage?ref=${encodeURIComponent('romans 4:1-6')}`,
        );
        assert.equal(status, 200);
        assert.equal(body.reference, 'Romans 4:1-6');
        assert.equal(body.verses.length, 6);
        assert.deepEqual(body.verses.map((v) => v.verse), [1, 2, 3, 4, 5, 6]);
    });

    test('GET without ref returns 400, unknown passage returns 404', async () => {
        const missingRef = await getJson(base, '/api/bible/niv/passage');
        assert.equal(missingRef.status, 400);
        assert.ok(missingRef.body.error);

        const unknown = await getJson(
            base,
            `/api/bible/niv/passage?ref=${encodeURIComponent('Romans 4:1-99')}`,
        );
        assert.equal(unknown.status, 404);
        assert.ok(unknown.body.error);
    });
});
