import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import express from 'express';
import { PUBLIC_API_ROUTES, createRequireAdmin, protectApi } from '../src/routes/apiAuth.js';

// A token whose payload names the project (aud) that issued it.
const tokenFor = (name, aud = 'proj') => `h.${Buffer.from(JSON.stringify({ aud, sub: name })).toString('base64url')}.${name}`;

/** Firebase Auth + Firestore stand-ins: `tokens` maps token -> decoded claims; `profiles` maps uid -> profile. */
function fakeProject({ tokens = {}, profiles = {} } = {}) {
    const calls = { verify: 0, profileReads: 0 };
    return {
        calls,
        auth: {
            verifyIdToken: async (token) => {
                calls.verify += 1;
                if (!tokens[token]) throw new Error('auth/invalid-id-token');
                return tokens[token];
            },
        },
        firestore: {
            collection: () => ({
                doc: (uid) => ({
                    get: async () => {
                        calls.profileReads += 1;
                        return { exists: uid in profiles, data: () => profiles[uid] };
                    },
                }),
                where: () => ({ get: async () => ({ docs: [] }) }),
            }),
        },
    };
}

const exp = (secondsFromNow) => Math.floor(Date.now() / 1000) + secondsFromNow;
const ADMIN = tokenFor('admin');
const MEMBER = tokenFor('member');
const project = () => fakeProject({
    tokens: {
        [ADMIN]: { uid: 'a1', email: 'admin@wpa.church', exp: exp(3600) },
        [MEMBER]: { uid: 'm1', email: 'member@example.com', exp: exp(3600) },
    },
    profiles: { a1: { is_admin: true }, m1: { is_admin: false } },
});

/** An app mounted like server.js: the guard on /api, then routes (some spelled oddly). */
async function start(proj, options) {
    const app = express();
    app.use('/api', protectApi(createRequireAdmin((id) => (id === 'proj' ? proj : null), options)));
    app.use(express.json());
    const ok = (req, res) => res.json({ ok: true, admin: req.admin ?? null });
    app.get('/api/firebase-config', ok);
    app.get('/api/env/current', ok);
    app.post('/api/env/switch', ok);
    app.get('/api/drafts', ok);
    app.post('/api/drafts/:id/publish', ok);
    const router = express.Router();
    router.get('/books', ok);
    app.use('/api/bible/niv', router);
    const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const call = async (path, { method = 'GET', token } = {}) => {
        const res = await fetch(`${base}${path}`, { method, headers: token ? { Authorization: `Bearer ${token}` } : {} });
        return { status: res.status, body: method === 'HEAD' ? null : await res.json().catch(() => null) };
    };
    return { server, call };
}

describe('protectApi', () => {
    test('every route needs an admin, however the path is spelled', async () => {
        const { server, call } = await start(project());
        try {
            for (const [method, path] of [
                ['GET', '/api/drafts'],
                ['GET', '/API/drafts'], // Express matches routes case-insensitively
                ['GET', '/api/Drafts/'],
                ['HEAD', '/api/drafts'],
                ['POST', '/api/drafts/d1/publish'],
                ['POST', '/api/env/switch'],
                ['GET', '/api/bible/niv/books'],
                ['GET', '/api/no-such-route'],
            ]) {
                const res = await call(path, { method });
                assert.equal(res.status, 401, `${method} ${path} without a token`);
            }
            assert.match((await call('/api/drafts')).body.error, /no credentials/);
            assert.equal((await call('/api/drafts', { token: 'not-a-jwt' })).status, 401);
            assert.equal((await call('/api/drafts', { token: tokenFor('x', 'other-project') })).status, 401);
            assert.equal((await call('/api/drafts', { token: tokenFor('forged') })).status, 401);
        } finally {
            server.close();
        }
    });

    test('only the pre-sign-in routes are public', async () => {
        assert.deepEqual(PUBLIC_API_ROUTES, [['GET', '/firebase-config'], ['GET', '/env/current']]);
        const { server, call } = await start(project());
        try {
            assert.equal((await call('/api/firebase-config')).status, 200);
            assert.equal((await call('/api/firebase-config/')).status, 200);
            assert.equal((await call('/API/Env/Current')).status, 200);
            assert.equal((await call('/api/env/current', { method: 'HEAD' })).status, 200);
            // The same paths with another method aren't public.
            assert.equal((await call('/api/firebase-config', { method: 'POST' })).status, 401);
            assert.equal((await call('/api/env/current', { method: 'DELETE' })).status, 401);
        } finally {
            server.close();
        }
    });

    test('admins get through with req.admin set; other users are refused', async () => {
        const { server, call } = await start(project());
        try {
            const res = await call('/api/drafts', { token: ADMIN });
            assert.equal(res.status, 200);
            assert.deepEqual(res.body.admin, { uid: 'a1', email: 'admin@wpa.church', projectId: 'proj' });
            assert.equal((await call('/api/drafts/d1/publish', { method: 'POST', token: ADMIN })).status, 200);
            const member = await call('/api/drafts', { token: MEMBER });
            assert.equal(member.status, 403);
            assert.match(member.body.error, /Administrator access/);
        } finally {
            server.close();
        }
    });
});

describe('createRequireAdmin', () => {
    test('trusts a verified admin token for a while, then checks again', async () => {
        let clock = 1_000_000;
        const proj = project();
        const { server, call } = await start(proj, { cacheMs: 60_000, now: () => clock });
        try {
            await call('/api/drafts', { token: ADMIN });
            await call('/api/drafts', { token: ADMIN });
            await call('/api/bible/niv/books', { token: ADMIN });
            assert.deepEqual(proj.calls, { verify: 1, profileReads: 1 });

            clock += 60_001;
            assert.equal((await call('/api/drafts', { token: ADMIN })).status, 200);
            assert.deepEqual(proj.calls, { verify: 2, profileReads: 2 });

            // Refusals aren't remembered: a newly made admin gets in straight away.
            await call('/api/drafts', { token: MEMBER });
            await call('/api/drafts', { token: MEMBER });
            assert.equal(proj.calls.verify, 4);
        } finally {
            server.close();
        }
    });

    test('never trusts a token past its expiry', async () => {
        const nowSeconds = 2_000_000;
        let clock = nowSeconds * 1000;
        const soon = tokenFor('soon');
        const proj = fakeProject({ tokens: { [soon]: { uid: 'a1', exp: nowSeconds + 5 } }, profiles: { a1: { is_admin: true } } });
        const { server, call } = await start(proj, { cacheMs: 60_000, now: () => clock });
        try {
            await call('/api/drafts', { token: soon });
            clock += 6_000; // past exp, well inside cacheMs
            await call('/api/drafts', { token: soon });
            assert.equal(proj.calls.verify, 2);
        } finally {
            server.close();
        }
    });

    test('a request already checked by the /api guard is not checked again', async () => {
        const proj = project();
        const requireAdmin = createRequireAdmin(() => proj, { cacheMs: 0 });
        const app = express();
        app.use('/api', protectApi(requireAdmin));
        app.get('/api/users', requireAdmin, (req, res) => res.json({ ok: true }));
        const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
        try {
            const res = await fetch(`http://127.0.0.1:${server.address().port}/api/users`, { headers: { Authorization: `Bearer ${ADMIN}` } });
            assert.equal(res.status, 200);
            assert.equal(proj.calls.verify, 1);
        } finally {
            server.close();
        }
    });
});

describe('server.js', () => {
    test('the /api guard comes before every /api route and before body parsing', () => {
        const source = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
        const guard = source.indexOf("app.use('/api', protectApi(");
        assert.ok(guard > 0, 'server.js mounts protectApi on /api');
        const routes = [...source.matchAll(/app\.(?:get|post|put|patch|delete|use|all)\(\s*['"`]\/api/g)].map((m) => m.index);
        assert.ok(routes.length > 5);
        for (const index of routes) {
            if (index === guard) continue;
            assert.ok(index > guard, `an /api route at offset ${index} is mounted before the guard`);
        }
        assert.ok(source.indexOf('app.use(express.json(') > guard, 'JSON bodies are parsed after the guard');
        assert.equal(/app\.use\(\s*cors\(\s*\)\s*\)/.test(source), false, 'CORS is not open to every origin');
    });
});
