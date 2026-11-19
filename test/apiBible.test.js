import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiBibleClient, ApiBibleError, parseRateLimit, parseRetryAfter, versesFromContent, plainText } from '../src/services/apiBibleClient.js';
import { createApiBibleService, loadBibleConfig } from '../src/config/apiBible.js';
import { ScriptureBackfill, chaptersUsed, restoreBodies, rewriteScriptureBlock } from '../src/services/scriptureBackfill.js';
import { createRecompiler } from '../src/services/seriesBaseline.js';
import { PublishedSeriesService } from '../src/services/publishedSeries.js';
import { DataLoaderService } from '../src/services/dataLoaderService.js';
import { compileDraft, collectRefs, createLookup } from '../ui/src/series/compile.js';
import { importSeriesJson } from '../ui/src/series/importSeries.js';
import { TEST_BIBLE, createTestBible, loadNiv } from './helpers/fakeApiBible.js';
import { memoryFirestore } from './helpers/memoryFirestore.js';

// Chapter content as API.Bible returns it with content-type=json: paragraphs
// of verse markers and text nodes tagged with their verse ID.
const v = (number) => ({ name: 'verse', type: 'tag', attrs: { number, style: 'v', sid: `GEN 1:${number}` }, items: [{ text: number, type: 'text' }] });
const t = (text, verse) => ({ text, type: 'text', ...(verse ? { attrs: { verseId: `GEN.1.${verse}`, verseOrgIds: [`GEN.1.${verse}`] } } : {}) });
const CONTENT = [
    { name: 'para', type: 'tag', attrs: { style: 's1' }, items: [t('The Creation')] },
    { name: 'para', type: 'tag', attrs: { style: 'p' }, items: [v('1'), t('In the beginning God created the heavens and the earth.', 1), v('2'), t('Now the earth was formless', 2)] },
    { name: 'para', type: 'tag', attrs: { style: 'q1' }, items: [t('and void,', 2)] },
    {
        name: 'para', type: 'tag', attrs: { style: 'p' }, items: [
            v('3'),
            { name: 'char', type: 'tag', attrs: { style: 'wj' }, items: [t('“Let there be light,”', 3)] },
            t(' and there was light.', 3),
            { name: 'note', type: 'tag', attrs: { style: 'f' }, items: [t('Or a footnote', 3)] },
            v('4-5'),
            t('Bridged verses.', '4-5'),
            v('6'),
            t('Text without a verse ID belongs to the last marker.'),
        ],
    },
];

function jsonResponse(status, body, headers = {}) {
    return {
        ok: status >= 200 && status < 300,
        status,
        statusText: '',
        headers: { get: (name) => headers[name.toLowerCase()] ?? null },
        json: async () => body,
        text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    };
}

/** fetch stub: routes by pathname; records every call. */
function stubFetch(routes) {
    const calls = [];
    const fetch = async (url, init) => {
        const u = new URL(url);
        calls.push({ url: u, headers: init?.headers ?? {}, init });
        if (u.hostname === 'fums.api.bible') return jsonResponse(200, {});
        const handler = routes[u.pathname];
        if (!handler) return jsonResponse(404, { message: 'Not Found' });
        if (typeof handler === 'function') return handler(u, calls);
        return 'ok' in handler ? handler : jsonResponse(200, handler);
    };
    return { fetch, calls, api: () => calls.filter((c) => c.url.hostname !== 'fums.api.bible') };
}

describe('API.Bible content', () => {
    test('splits JSON content into one line of text per verse', () => {
        assert.deepEqual(versesFromContent(CONTENT), {
            1: 'In the beginning God created the heavens and the earth.',
            2: 'Now the earth was formless and void,',
            3: '“Let there be light,” and there was light.',
            4: 'Bridged verses.',
            5: '',
            6: 'Text without a verse ID belongs to the last marker.',
        });
        assert.deepEqual(versesFromContent([]), {});
    });

    test('copyright markup becomes plain text', () => {
        assert.equal(plainText('<p>Copyright &copy; 2023 <b>Example</b>&nbsp;Society</p>'), 'Copyright © 2023 Example Society');
    });
});

const BASE = 'https://wpa-be-bible-proxy.onrender.com/admin/v1';
const P = '/admin/v1'; // pathname prefix of the default base URL
const admin = (token = 'admin-token') => ({ getToken: async () => token, canRefresh: false });

describe('ApiBibleClient (through the Bible proxy)', () => {
    const chapterBody = { data: { id: 'GEN.1', reference: 'Genesis 1', copyright: '<p>Public Domain</p>', content: CONTENT }, meta: { fumsToken: 'tok-1' } };

    test('calls the proxy with the admin\'s ID token (no API key), asks for JSON without notes or titles, caches chapters and reports FUMS', async () => {
        const stub = stubFetch({ [`${P}/bibles/b1/chapters/GEN.1`]: chapterBody });
        const client = new ApiBibleClient({ fetch: stub.fetch, auth: admin('id-token-1') });
        const [first, second] = await Promise.all([client.getChapter('b1', 'GEN.1'), client.getChapter('b1', 'GEN.1')]);
        await client.getChapter('b1', 'GEN.1');
        assert.equal(first, second);
        assert.equal(first.copyright, 'Public Domain');
        assert.equal(first.verses['1'], 'In the beginning God created the heavens and the earth.');

        const [call] = stub.api();
        assert.equal(stub.api().length, 1, 'concurrent and repeated requests share one call');
        assert.equal(client.requestCount, 1);
        assert.equal(call.url.origin + call.url.pathname, `${BASE}/bibles/b1/chapters/GEN.1`);
        assert.equal(call.headers.authorization, 'Bearer id-token-1');
        assert.equal('api-key' in call.headers, false, 'no API.Bible key is sent');
        assert.equal(call.url.searchParams.get('content-type'), 'json');
        assert.equal(call.url.searchParams.get('include-notes'), 'false');
        assert.equal(call.url.searchParams.get('include-titles'), 'false');
        assert.equal(call.url.searchParams.get('include-verse-numbers'), 'true');
        // Only allowlisted parameters (content-type and include-*) are sent.
        for (const key of call.url.searchParams.keys()) assert.match(key, /^(content-type|include-[a-z-]+)$/);

        await new Promise((resolve) => setImmediate(resolve));
        const fums = stub.calls.filter((c) => c.url.hostname === 'fums.api.bible');
        assert.equal(fums.length, 1, 'the fumsToken the proxy passes through is reported');
        assert.equal(fums[0].url.searchParams.get('t'), 'tok-1');
    });

    test('the base URL is configurable', async () => {
        const stub = stubFetch({ '/v1/bibles/b1': { data: { id: 'b1', name: 'B', copyright: '' } } });
        await new ApiBibleClient({ baseUrl: 'http://localhost:9999/v1/', fetch: stub.fetch, auth: admin() }).getBible('b1');
        assert.equal(stub.api()[0].url.href, 'http://localhost:9999/v1/bibles/b1');
    });

    test('withAuth copies share caches but send their own token', async () => {
        const stub = stubFetch({ [`${P}/bibles/b1/chapters/GEN.1`]: chapterBody, [`${P}/bibles/b1/chapters/GEN.2`]: chapterBody });
        const base = new ApiBibleClient({ fetch: stub.fetch, fums: false });
        const alice = base.withAuth(admin('alice'));
        const bob = base.withAuth(admin('bob'));
        await alice.getChapter('b1', 'GEN.1');
        await bob.getChapter('b1', 'GEN.1');
        await bob.getChapter('b1', 'GEN.2');
        assert.deepEqual(stub.api().map((c) => c.headers.authorization), ['Bearer alice', 'Bearer bob']);
        assert.equal(base.requestCount, 2);
        base.clearCache();
        await alice.getChapter('b1', 'GEN.1');
        assert.equal(stub.api().length, 3);
    });

    test('without credentials nothing is sent and the error is a 401', async () => {
        const stub = stubFetch({});
        await assert.rejects(new ApiBibleClient({ fetch: stub.fetch }).getBible('b1'), (e) => e instanceof ApiBibleError && e.status === 401);
        await assert.rejects(new ApiBibleClient({ fetch: stub.fetch, auth: admin(null) }).getBible('b1'), (e) => e.status === 401);
        assert.equal(stub.calls.length, 0);
    });

    test('FUMS reporting can be turned off', async () => {
        const stub = stubFetch({ [`${P}/bibles/b1/chapters/GEN.1`]: chapterBody });
        await new ApiBibleClient({ fetch: stub.fetch, auth: admin(), fums: false }).getChapter('b1', 'GEN.1');
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(stub.calls.length, 1);
    });

    test('books keep only numbered chapters', async () => {
        const stub = stubFetch({
            [`${P}/bibles/b1/books`]: (u) => {
                assert.deepEqual([...u.searchParams.keys()], ['include-chapters']);
                assert.equal(u.searchParams.get('include-chapters'), 'true');
                return jsonResponse(200, { data: [{ id: 'GEN', name: 'Genesis', chapters: [{ number: 'intro' }, { number: '2' }, { number: '1' }] }] });
            },
        });
        const books = await new ApiBibleClient({ fetch: stub.fetch, auth: admin() }).getBooks('b1');
        assert.deepEqual(books, [{ id: 'GEN', name: 'Genesis', chapters: [1, 2] }]);
    });

    const proxyError = (status, message, headers = {}) => jsonResponse(status, { statusCode: status, error: 'Err', message }, headers);
    const bibleOne = jsonResponse(200, { data: { id: 'b1', abbreviation: 'B1', name: 'Bible One', copyright: 'c' } });

    test('401: a refreshable session (CLI) refreshes its token and retries once', async () => {
        const tokens = [];
        let attempts = 0;
        const stub = stubFetch({ [`${P}/bibles/b1`]: () => (++attempts === 1 ? proxyError(401, 'Token expired.') : bibleOne) });
        const session = { canRefresh: true, getToken: async (force) => { tokens.push(force); return force ? 'fresh' : 'stale'; } };
        const client = new ApiBibleClient({ fetch: stub.fetch, auth: session, retryDelayMs: 1 });
        assert.equal((await client.getBible('b1')).abbreviation, 'B1');
        assert.deepEqual(tokens, [false, true]);
        assert.deepEqual(stub.api().map((c) => c.headers.authorization), ['Bearer stale', 'Bearer fresh']);

        const always = stubFetch({ [`${P}/bibles/b1`]: proxyError(401, 'Token revoked.') });
        const again = new ApiBibleClient({ fetch: always.fetch, auth: session, retryDelayMs: 1 });
        await assert.rejects(again.getBible('b1'), (e) => e.status === 401 && /sign in again/.test(e.message) && /Token revoked/.test(e.message));
        assert.equal(always.api().length, 2, 'only one retry');
    });

    test('401 with a forwarded token goes back to the caller without a retry (the browser refreshes)', async () => {
        const stub = stubFetch({ [`${P}/bibles/b1`]: proxyError(401, 'Token expired.') });
        await assert.rejects(new ApiBibleClient({ fetch: stub.fetch, auth: admin() }).getBible('b1'), (e) => e.status === 401 && e.upstreamStatus === 401);
        assert.equal(stub.api().length, 1);
    });

    test('403, 404 and 400 keep their meaning', async () => {
        const forbidden = stubFetch({ [`${P}/bibles/b1`]: proxyError(403, 'Not an admin.') });
        await assert.rejects(new ApiBibleClient({ fetch: forbidden.fetch, auth: admin() }).getBible('b1'), (e) => e.status === 403 && /Not an admin/.test(e.message));

        const missing = new ApiBibleClient({ fetch: stubFetch({}).fetch, auth: admin() });
        await assert.rejects(missing.getChapter('b1', 'GEN.99'), (e) => e.status === 404 && e.upstreamStatus === 404);

        const errors = [];
        const original = console.error;
        console.error = (...a) => errors.push(a.join(' '));
        try {
            const bad = stubFetch({ [`${P}/bibles/b1`]: proxyError(400, 'Unsupported query parameter: foo.') });
            await assert.rejects(new ApiBibleClient({ fetch: bad.fetch, auth: admin() }).getBible('b1'), (e) => e.status === 400 && /Unsupported query parameter/.test(e.message));
            assert.equal(bad.api().length, 1, '400 is not retried');
        } finally {
            console.error = original;
        }
        assert.match(errors.join('\n'), /rejected \/admin\/v1\/bibles\/b1/, 'a 400 is logged as a bug in the request');
    });

    test('429: waits out a short Retry-After and retries; a long one is returned with retryAfter', async () => {
        let attempts = 0;
        const waits = [];
        const stub = stubFetch({ [`${P}/bibles/b1`]: () => (++attempts === 1 ? proxyError(429, 'Slow down.', { 'retry-after': '0' }) : bibleOne) });
        const client = new ApiBibleClient({ fetch: stub.fetch, auth: admin() });
        const started = Date.now();
        assert.equal((await client.getBible('b1')).abbreviation, 'B1');
        waits.push(Date.now() - started);
        assert.equal(attempts, 2);

        const long = stubFetch({ [`${P}/bibles/b1`]: proxyError(429, 'Slow down.', { 'retry-after': '120' }) });
        await assert.rejects(
            new ApiBibleClient({ fetch: long.fetch, auth: admin() }).getBible('b1'),
            (e) => e.status === 429 && e.retryAfter === 120 && /Try again in 120 seconds/.test(e.message),
        );
        assert.equal(long.api().length, 1, 'not retried when the wait is too long');
    });

    test('a 429 pauses every request through the client (and its withAuth copies) until Retry-After', async () => {
        const sent = [];
        let limited = true;
        const stub = stubFetch(Object.fromEntries(['GEN.1', 'GEN.2', 'GEN.3'].map((id) => [`${P}/bibles/b1/chapters/${id}`, () => {
            sent.push({ id, at: Date.now() });
            if (limited) {
                limited = false;
                return proxyError(429, 'Slow down.', { 'retry-after': '1', 'ratelimit-limit': '60' });
            }
            return jsonResponse(200, chapterBody);
        }])));
        const base = new ApiBibleClient({ fetch: stub.fetch, fums: false, concurrency: 1 });
        const warnings = [];
        const original = console.warn;
        console.warn = (...a) => warnings.push(a.join(' '));
        try {
            await Promise.all([
                base.withAuth(admin('a')).getChapter('b1', 'GEN.1'),
                base.withAuth(admin('b')).getChapter('b1', 'GEN.2'),
                base.withAuth(admin('c')).getChapter('b1', 'GEN.3'),
            ]);
        } finally {
            console.warn = original;
        }
        assert.equal(sent.length, 4, 'three chapters plus one retry, nothing else');
        const pausedAt = sent[0].at;
        for (const later of sent.slice(1)) assert.ok(later.at - pausedAt >= 900, 'nothing is sent during the pause');
        assert.equal(warnings.length, 1);
        assert.match(warnings[0], /429 on \/admin\/v1\/bibles\/b1\/chapters\/GEN\.1 from Bible proxy \("Slow down\."\) .*pausing 1s .*ratelimit-limit=60/);
    });

    test('a 429 says whether the proxy or the edge in front of it sent it', async () => {
        const original = console.warn;
        const warnings = [];
        console.warn = (...a) => warnings.push(a.join(' '));
        try {
            const proxy = stubFetch({ [`${P}/bibles/b1`]: proxyError(429, 'Rate limit exceeded: 60 requests per minute.', { 'retry-after': '45' }) });
            await assert.rejects(
                new ApiBibleClient({ fetch: proxy.fetch, auth: admin() }).getBible('b1'),
                (e) => e.status === 429 && /Too many scripture requests: the Bible proxy's rate limit \(Rate limit exceeded: 60 requests per minute\.\)\. Try again in 45 seconds/.test(e.message),
            );
            const edge = stubFetch({ [`${P}/bibles/b1`]: jsonResponse(429, '<html><body><h1>Error 1015</h1>You are being rate limited</body></html>', { 'content-type': 'text/html', 'retry-after': '60' }) });
            await assert.rejects(
                new ApiBibleClient({ fetch: edge.fetch, auth: admin() }).getBible('b1'),
                (e) => e.status === 429 && /rate limited by Cloudflare\/Render in front of the proxy, not the proxy app \(Error 1015 You are being rate limited\)/.test(e.message),
            );
        } finally {
            console.warn = original;
        }
        assert.match(warnings[0], /from Bible proxy/);
        assert.match(warnings[1], /from Cloudflare\/Render in front of the proxy/);
    });

    test('while paused for longer than the client will wait, requests fail at once without being sent', async () => {
        const stub = stubFetch({
            [`${P}/bibles/b1/chapters/GEN.1`]: proxyError(429, 'Slow down.', { 'retry-after': '90' }),
            [`${P}/bibles/b1/chapters/GEN.2`]: chapterBody,
        });
        const client = new ApiBibleClient({ fetch: stub.fetch, auth: admin(), fums: false });
        const original = console.warn;
        console.warn = () => {};
        try {
            await assert.rejects(client.getChapter('b1', 'GEN.1'), (e) => e.status === 429 && e.retryAfter === 90);
            await assert.rejects(client.getChapter('b1', 'GEN.2'), (e) => e.status === 429 && e.retryAfter >= 89);
        } finally {
            console.warn = original;
        }
        assert.equal(stub.api().length, 1);
    });

    test('502/503: "try again later", respecting Retry-After', async () => {
        const down = stubFetch({ [`${P}/bibles/b1`]: proxyError(503, 'Upstream unavailable and nothing cached.') });
        await assert.rejects(
            new ApiBibleClient({ fetch: down.fetch, auth: admin() }).getBible('b1'),
            (e) => e.status === 503 && e.retryAfter === null && /temporarily unavailable; try again later/.test(e.message),
        );
        assert.equal(down.api().length, 1, 'no Retry-After: not retried');

        let attempts = 0;
        const blip = stubFetch({ [`${P}/bibles/b1`]: () => (++attempts === 1 ? proxyError(502, 'Bad gateway.', { 'retry-after': '0' }) : bibleOne) });
        assert.equal((await new ApiBibleClient({ fetch: blip.fetch, auth: admin() }).getBible('b1')).abbreviation, 'B1');

        const later = stubFetch({ [`${P}/bibles/b1`]: proxyError(502, 'Bad gateway.', { 'retry-after': '60' }) });
        await assert.rejects(new ApiBibleClient({ fetch: later.fetch, auth: admin() }).getBible('b1'), (e) => e.status === 503 && e.retryAfter === 60);
    });

    test('network errors and other server errors are retried, then reported', async () => {
        let attempts = 0;
        const flaky = stubFetch({ [`${P}/bibles/b1`]: () => (++attempts < 3 ? jsonResponse(500, {}) : bibleOne) });
        assert.equal((await new ApiBibleClient({ fetch: flaky.fetch, auth: admin(), retryDelayMs: 1 }).getBible('b1')).abbreviation, 'B1');
        assert.equal(attempts, 3);

        const offline = new ApiBibleClient({ fetch: async () => { throw new Error('ECONNREFUSED'); }, auth: admin(), retryDelayMs: 1, maxRetries: 1 });
        await assert.rejects(offline.getBible('b1'), (e) => e.status === 502 && /Could not reach the Bible proxy/.test(e.message));
    });

    test('send() reaches the proxy\'s admin endpoints with the token', async () => {
        const stub = stubFetch({ '/admin/cache/purge': (u, calls) => jsonResponse(200, { purged: true, method: calls.at(-1).init?.method }) });
        const client = new ApiBibleClient({ fetch: async (url, init) => { const r = await stub.fetch(url, init); stub.calls.at(-1).init = init; return r; }, auth: admin() });
        const { body } = await client.send('/admin/cache/purge', { method: 'POST', json: { all: true }, absolute: true });
        assert.equal(body.purged, true);
        const call = stub.calls.at(-1);
        assert.equal(call.url.href, 'https://wpa-be-bible-proxy.onrender.com/admin/cache/purge');
        assert.equal(call.init.method, 'POST');
        assert.equal(call.init.body, '{"all":true}');
        assert.equal(call.headers.authorization, 'Bearer admin-token');
    });

    test('a failed request is not cached', async () => {
        let fail = true;
        const stub = stubFetch({ [`${P}/bibles/b1/chapters/GEN.1`]: () => (fail ? jsonResponse(404, {}) : jsonResponse(200, chapterBody)) });
        const client = new ApiBibleClient({ fetch: stub.fetch, auth: admin(), fums: false });
        await assert.rejects(client.getChapter('b1', 'GEN.1'));
        fail = false;
        assert.equal((await client.getChapter('b1', 'GEN.1')).id, 'GEN.1');
    });

    test('requests are paced: at most rateLimit.requests start per window, across withAuth copies', async () => {
        const started = [];
        const stub = stubFetch(Object.fromEntries(['GEN.1', 'GEN.2', 'GEN.3', 'GEN.4', 'GEN.5'].map((id) => [`${P}/bibles/b1/chapters/${id}`, () => {
            started.push(Date.now());
            return jsonResponse(200, chapterBody);
        }])));
        const base = new ApiBibleClient({ fetch: stub.fetch, fums: false, rateLimit: { requests: 2, perMs: 300 } });
        const t0 = Date.now();
        await Promise.all(['GEN.1', 'GEN.2', 'GEN.3', 'GEN.4', 'GEN.5'].map((id, i) => base.withAuth(admin(`u${i}`)).getChapter('b1', id)));
        const offsets = started.map((t) => t - t0).sort((a, b) => a - b);
        assert.ok(offsets[1] < 150, 'the first two go at once');
        assert.ok(offsets[2] >= 280 && offsets[3] >= 280, 'the next two wait for the window');
        assert.ok(offsets[4] >= 580, 'the fifth waits for the window after that');
    });

    test('parseRateLimit reads "5/s", "60/min" and similar', () => {
        assert.deepEqual(parseRateLimit('5/s'), { requests: 5, perMs: 1000 });
        assert.deepEqual(parseRateLimit(' 60 / min '), { requests: 60, perMs: 60_000 });
        assert.deepEqual(parseRateLimit('100/10s'), { requests: 100, perMs: 10_000 });
        assert.deepEqual(parseRateLimit('300/h'), { requests: 300, perMs: 3_600_000 });
        assert.equal(parseRateLimit('fast'), null);
        assert.equal(parseRateLimit('0/s'), null);
        assert.deepEqual(loadBibleConfig({ BIBLE_API_RATE_LIMIT: '30/min' }).rateLimit, { requests: 30, perMs: 60_000 });
        assert.equal(loadBibleConfig({}).rateLimit, null, 'no pacing by default');
    });

    test('parseRetryAfter reads seconds and HTTP dates', () => {
        assert.equal(parseRetryAfter('5'), 5);
        assert.equal(parseRetryAfter(null), null);
        assert.equal(parseRetryAfter('soon'), null);
        assert.equal(parseRetryAfter(new Date(Date.UTC(2030, 0, 1, 0, 0, 30)).toUTCString(), Date.UTC(2030, 0, 1)), 30);
    });
});

describe('scripture configuration', () => {
    test('the proxy is the default; BIBLE_API_BASE_URL and the translation settings are read from the environment', () => {
        assert.equal(loadBibleConfig({}).baseUrl, 'https://wpa-be-bible-proxy.onrender.com/admin/v1');
        const config = loadBibleConfig({ BIBLE_API_BASE_URL: 'http://localhost:8080/admin/v1', API_BIBLE_DEFAULT_BIBLE_ID: 'b1', API_BIBLE_BIBLE_IDS: ' b1, b2 ,', API_BIBLE_FUMS: 'false' });
        assert.equal(config.baseUrl, 'http://localhost:8080/admin/v1');
        assert.equal(config.defaultBibleId, 'b1');
        assert.deepEqual(config.bibleIds, ['b1', 'b2']);
        assert.equal(config.fums, false);
        assert.equal('apiKey' in config, false, 'no API.Bible credentials');
    });

    test('the service needs no key; an API.Bible key in the environment is ignored', async () => {
        const stub = stubFetch({
            [`${P}/bibles/b1`]: { data: { id: 'b1', abbreviation: 'B1', name: 'B', copyright: '' } },
            [`${P}/bibles/b1/books`]: { data: [{ id: 'GEN', name: 'Genesis', chapters: [{ number: '1' }] }] },
        });
        const { service } = createApiBibleService({ API_BIBLE_KEY: 'should-not-be-used', API_BIBLE_DEFAULT_BIBLE_ID: 'b1' }, { fetch: stub.fetch });
        await assert.rejects(service.getBible('default'), (e) => e.status === 401, 'unscoped calls have no credentials');
        assert.equal((await service.withAuth(admin('tok')).getBible('default')).abbreviation, 'B1');
        assert.equal(stub.api().length, 2);
        for (const call of stub.api()) assert.deepEqual(Object.keys(call.headers).sort(), ['accept', 'authorization']);
        const [call] = stub.api();
        assert.equal(call.headers.authorization, 'Bearer tok');
    });
});

// A second translation built from the NIV data: different text, a verse it
// doesn't have (Matthew 17:21) and no book of Jude.
function altTranslation() {
    const niv = loadNiv();
    const data = {};
    for (const [book, chapters] of Object.entries(niv)) {
        if (book === 'Jude') continue;
        data[book] = {};
        for (const [chapter, verses] of Object.entries(chapters)) {
            data[book][chapter] = Object.fromEntries(Object.keys(verses).map((n) => [n, `ALT ${book} ${chapter}:${n}`]));
        }
    }
    delete data.Matthew['17']['21'];
    return { alt: { info: { id: 'alt', abbreviation: 'ALT', name: 'Alternate Version', language: 'English', copyright: 'Alt copyright' }, data } };
}

describe('ApiBibleService in another translation', () => {
    const { service, client } = createTestBible({ extra: altTranslation() });

    test('whole chapters skip verses the translation leaves out', async () => {
        const passage = await service.getPassage('alt', 'Matthew 17');
        assert.equal(passage.verses.length, 26);
        assert.ok(!passage.verses.some((x) => x.verse === 21));
        assert.equal(passage.reference, 'Matthew 17:1-20, 22-27');
        assert.equal(passage.bible.copyright, 'Alt copyright');
        assert.equal(passage.verses[0].text, 'ALT Matthew 17:1');
        await assert.rejects(service.getPassage('alt', 'Matthew 17:21'), { status: 404 });
    });

    test('books the translation lacks are not found; outages fail the whole batch', async () => {
        const { results } = await service.getPassages('alt', ['Jude 1:1-3', 'John 3:16']);
        assert.equal(results['Jude 1:1-3'].ok, false);
        assert.equal(results['John 3:16'].ok, true);

        const original = client.getChapter;
        client.getChapter = async () => { throw new ApiBibleError('API.Bible rate limit reached', 503, 429); };
        try {
            await assert.rejects(service.getPassages('alt', ['Romans 2:1']), { status: 503 });
        } finally {
            client.getChapter = original;
        }
    });

    test('chapter lookups are isolated between concurrent requests', async () => {
        const [a, b] = await Promise.all([service.getPassage('alt', 'Romans 1:1'), service.getPassage('default', 'Romans 1:1')]);
        assert.equal(a.verses[0].text, 'ALT Romans 1:1');
        assert.notEqual(b.verses[0].text, 'ALT Romans 1:1');
    });
});

describe('updating a series across translations', () => {
    const legacyBlock = (book, chapter, verses) => ({
        attribution: 'Copyright © 1973 1978 1984 2011 by Biblica, Inc. TM\nUsed by permission. All rights reserved worldwide',
        bible_version: 'Scripture quotations taken from The Holy Bible, New International Version® NIV®',
        body_type: 'scripture',
        scriptures: [{ book, chapter, title: '', verses }],
    });

    async function publishLegacy(firestore) {
        const loader = new DataLoaderService(firestore);
        const seriesId = await loader.loadBibleSeries({ title: 'Legacy', sub_title: '', image_gs_location: '', is_active: false, is_visible: true });
        await loader.loadSeriesContent([
            { title: 'Read', content_type: 'read', date: '2026-02-02', body: [legacyBlock('Romans', '1', { 1: 'old 1', 2: 'old 2' })] },
            { title: 'Read', content_type: 'read', date: '2026-02-03', body: [legacyBlock('Psalm', '23', { 1: 'old', 2: 'old' }), { body_type: 'text', paragraphs: ['Think.'] }] },
        ], seriesId);
        return seriesId;
    }

    test('an untouched draft in the default translation has nothing to update; picking another translation rewrites scripture', async () => {
        const firestore = memoryFirestore();
        const seriesId = await publishLegacy(firestore);
        const { service: bible } = createTestBible({ extra: altTranslation() });
        const recompile = createRecompiler(bible);
        const published = new PublishedSeriesService(firestore, { recompile });

        const opened = await recompile(await published.export(seriesId));
        assert.equal((await published.plan(seriesId, opened)).summary.writeCount, 0);

        const exported = await published.export(seriesId);
        const draft = importSeriesJson(exported).draft;
        draft.meta.bible_id = 'alt';
        const { results } = await bible.getPassages('alt', collectRefs(draft));
        const json = compileDraft(draft, createLookup(new Map(Object.entries(results)))).json;
        const { summary, writes } = await published.plan(seriesId, json);
        assert.deepEqual(summary.updated.map((u) => u.fields), [['body'], ['body']]);
        assert.deepEqual(summary.series, [{ field: 'scripture_bible_id', from: '', to: 'alt' }]);
        await published.apply(seriesId, writes);
        const { series: storedSeries, content: stored } = await published.read(seriesId);
        assert.equal(storedSeries.scripture_bible_id, 'alt');
        assert.equal(stored[0].body[0].scriptures[0].verses['1'], 'ALT Romans 1:1');
        assert.deepEqual(stored[0].body[0].scriptures[0].passage_ids, ['ROM.1.1-ROM.1.2']);
        assert.equal('bible' in stored[0].body[0], false, 'blocks carry no translation; apps choose their own');
        assert.equal(stored[1].body[1].paragraphs[0], 'Think.');

        // Reopened, the draft keeps the series' translation and has nothing to update.
        const reopened = importSeriesJson(await published.export(seriesId)).draft;
        assert.equal(reopened.meta.bible_id, 'alt');
        const again = await bible.getPassages('alt', collectRefs(reopened));
        const json2 = compileDraft(reopened, createLookup(new Map(Object.entries(again.results)))).json;
        assert.equal((await published.plan(seriesId, json2)).summary.writeCount, 0);
    });
});

describe('scripture backfill', () => {
    const block = (book, chapter, verses, title = '') => ({
        attribution: 'Biblica', bible_version: 'NIV', body_type: 'scripture', scriptures: [{ book, chapter, title, verses }],
    });

    async function setup() {
        const firestore = memoryFirestore();
        const { service: bible, client } = createTestBible({ extra: altTranslation() });
        const series = firestore.collection('bible_series');
        await series.doc('s1').set({ title: 'Series one' });
        await series.doc('s2').set({ title: 'Series two' });
        await series.doc('s3').set({ title: 'Series three' });
        const content = (id) => series.doc(id).collection('series_content');
        await content('s1').doc('e1').set({ title: 'Read', body: [block('Psalm', '23', { 1: 'old', 2: 'old', 3: 'old' }, 'The Shepherd'), { body_type: 'text', paragraphs: ['Hi'] }] });
        await content('s1').doc('e2').set({ title: 'Read', body: [block('Matthew', '17', { 20: 'old', 21: 'old', 22: 'old' })] });
        await content('s1').doc('e3').set({ title: 'Read', body: [block('Jude', '1', { 1: 'old' })] });
        await content('s1').doc('e4').set({ title: 'Pray', body: [{ body_type: 'text', paragraphs: ['Pray'] }] });
        await content('s2').doc('e5').set({ title: 'Read', body: [block('Romans', '8', { 28: 'old' })] });
        // Written by an earlier version that stored the translation on each block.
        await content('s3').doc('e6').set({ title: 'Read', body: [{ ...block('John', '3', { 16: 'old' }), bible: { provider: 'api.bible', bible_id: 'x' } }] });
        firestore.store.get('bible_series/s3/series_content/e6').body[0].scriptures[0].book_id = 'JHN';
        return { firestore, bible, client };
    }

    test('rewrites verse text in the translation and adds what the app needs to fetch it', async () => {
        const { bible } = await setup();
        const { block: rewritten, warnings, error } = await rewriteScriptureBlock(block('Psalm', '23', { 1: 'old', 3: 'old' }, 'The Shepherd'), bible, 'alt');
        assert.equal(error, null);
        assert.deepEqual(warnings, []);
        assert.deepEqual(rewritten, {
            attribution: 'Alt copyright',
            bible_version: 'Scripture quotations taken from Alternate Version (ALT)',
            body_type: 'scripture',
            scriptures: [{
                book: 'Psalm', // stored names and titles are kept for existing apps
                chapter: '23',
                title: 'The Shepherd',
                verses: { 1: 'ALT Psalms 23:1', 3: 'ALT Psalms 23:3' },
                passage_ids: ['PSA.23.1-PSA.23.1', 'PSA.23.3-PSA.23.3'],
            }],
        });
    });

    test('plans per series: drops missing verses, leaves untranslatable blocks, records complete series', async () => {
        const { firestore, bible, client } = await setup();
        const backfill = new ScriptureBackfill(firestore, bible, { bibleId: 'alt' });
        assert.deepEqual((await backfill.listSeries()).map((s) => s.id), ['s1', 's2', 's3']);
        assert.deepEqual(await backfill.listSeries(['s2', 'nope']), [
            { id: 's2', title: 'Series two', scripture_bible_id: null },
            { id: 'nope', title: null, missing: true },
        ]);

        const content = await backfill.readContent('s1');
        assert.deepEqual([...chaptersUsed(content)].sort(), ['jude|1', 'matthew|17', 'psalm|23']);

        const [s1, s2, s3] = await backfill.listSeries();
        const plan = await backfill.planSeries(s1, content);
        assert.equal(plan.blocks, 3);
        assert.deepEqual(plan.updates.map((u) => u.id), ['e1', 'e2']);
        assert.equal(plan.warnings.length, 1);
        assert.match(plan.warnings[0], /s1\/e2 .*Matthew 17:21 not in ALT; removed/);
        assert.equal(plan.errors.length, 1);
        assert.match(plan.errors[0], /s1\/e3 .*Jude 1 is not in this translation; left unchanged/);
        assert.equal(plan.markSeries, false, 'not recorded while a block is still in another translation');
        const e2 = plan.updates.find((u) => u.id === 'e2').after[0].scriptures[0];
        assert.deepEqual(Object.keys(e2.verses), ['20', '22']);
        assert.deepEqual(e2.passage_ids, ['MAT.17.20-MAT.17.20', 'MAT.17.22-MAT.17.22']);
        // Non-scripture blocks are kept as they are.
        assert.deepEqual(plan.updates[0].after[1], { body_type: 'text', paragraphs: ['Hi'] });

        const plan2 = await backfill.planSeries(s2);
        const plan3 = await backfill.planSeries(s3);
        assert.equal(plan2.markSeries, true);
        assert.equal('bible' in plan3.updates[0].after[0], false, 'per-block translation from the earlier version is removed');
        assert.equal('book_id' in plan3.updates[0].after[0].scriptures[0], false, 'book_id from the earlier version is removed');

        // Nothing is written until apply; then only `body` and the series' translation change.
        assert.equal(firestore.store.get('bible_series/s1/series_content/e1').body[0].scriptures[0].verses['1'], 'old');
        assert.deepEqual(await backfill.apply([plan, plan2, plan3]), { entries: 4, series: 2 });
        const e1 = firestore.store.get('bible_series/s1/series_content/e1');
        assert.equal(e1.title, 'Read');
        assert.equal(e1.body[0].scriptures[0].verses['1'], 'ALT Psalms 23:1');
        assert.equal(firestore.store.get('bible_series/s1').scripture_bible_id, undefined);
        assert.equal(firestore.store.get('bible_series/s2').scripture_bible_id, 'alt');

        // Recorded series are skipped without any API.Bible calls; incomplete ones are planned again.
        const [s1Again, s2Again] = await backfill.listSeries();
        const calls = client.chapterRequests.length;
        const skipped = await backfill.planSeries(s2Again);
        assert.equal(skipped.skipped, true);
        assert.equal(client.chapterRequests.length, calls);
        const again = await backfill.planSeries(s1Again);
        assert.deepEqual(again.updates, [], 'already-rewritten blocks don\'t change again');
        const forced = await new ScriptureBackfill(firestore, bible, { bibleId: 'alt', force: true }).planSeries(s2Again);
        assert.equal(forced.skipped, false);
        assert.deepEqual(forced.updates, [], 'rewriting in the same translation changes nothing');

        // The backup puts everything back.
        await restoreBodies(
            firestore,
            [plan, plan2].flatMap((p) => p.updates.map((u) => ({ path: u.path, body: u.before }))),
            [{ id: 's2', scripture_bible_id: plan2.previousBibleId }],
        );
        assert.equal(firestore.store.get('bible_series/s1/series_content/e1').body[0].scriptures[0].verses['1'], 'old');
        assert.equal(firestore.store.get('bible_series/s2').scripture_bible_id, null);
        await assert.rejects(restoreBodies(firestore, [{ path: 'users/u1', body: [] }]), /Unexpected document path/);
    });

    test('the default translation is used when none is given', async () => {
        const { firestore, bible } = await setup();
        const backfill = new ScriptureBackfill(firestore, bible);
        assert.equal(backfill.bibleId, TEST_BIBLE.id);
        const plan = await backfill.planSeries({ id: 's2' });
        const [after] = plan.updates[0].after;
        assert.equal(after.attribution, TEST_BIBLE.copyright);
        assert.deepEqual(after.scriptures[0].passage_ids, ['ROM.8.28-ROM.8.28']);
    });
});
