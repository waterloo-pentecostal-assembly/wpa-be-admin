import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { signInAdmin } from '../src/services/adminSession.js';

// Firebase Authentication's REST API: password sign-in and token refresh.
function fakeFirebaseAuth({ password = 'right' } = {}) {
    const calls = [];
    let issued = 0;
    const fetch = async (url, init) => {
        const u = new URL(url);
        calls.push({ url: u, init });
        const reply = (status, body) => ({ ok: status < 300, status, statusText: '', json: async () => body });
        if (u.pathname.endsWith('/accounts:signInWithPassword')) {
            const body = JSON.parse(init.body);
            if (body.password !== password) return reply(400, { error: { message: 'INVALID_LOGIN_CREDENTIALS' } });
            return reply(200, { idToken: `id-${++issued}`, refreshToken: 'refresh-1', expiresIn: '3600', localId: 'uid-1', email: body.email });
        }
        if (u.hostname === 'securetoken.googleapis.com') {
            const form = new URLSearchParams(init.body);
            assert.equal(form.get('grant_type'), 'refresh_token');
            return reply(200, { id_token: `id-${++issued}`, refresh_token: `refresh-${issued}`, expires_in: '3600' });
        }
        return reply(404, {});
    };
    return { fetch, calls };
}

describe('admin sign-in for scripts', () => {
    test('signs in with email and password using the web API key, and refreshes the ID token when asked or near expiry', async () => {
        const firebase = fakeFirebaseAuth();
        let clock = 0;
        const session = await signInAdmin({ apiKey: 'web-key', email: 'admin@wpa.church', password: 'right', fetch: firebase.fetch, now: () => clock });
        assert.equal(session.uid, 'uid-1');
        assert.equal(session.canRefresh, true);
        assert.equal(firebase.calls[0].url.searchParams.get('key'), 'web-key');

        assert.equal(await session.getToken(), 'id-1');
        assert.equal(await session.getToken(true), 'id-2', 'forced refresh (after a 401)');
        clock = 56 * 60 * 1000; // within five minutes of expiry
        assert.equal(await session.getToken(), 'id-3');
        assert.equal(await session.getToken(), 'id-3');
        assert.equal(firebase.calls.length, 3);
    });

    test('a wrong password is reported plainly', async () => {
        await assert.rejects(
            signInAdmin({ apiKey: 'k', email: 'a@b.co', password: 'wrong', fetch: fakeFirebaseAuth().fetch }),
            /Wrong email or password/,
        );
        await assert.rejects(signInAdmin({ apiKey: null, email: 'a@b.co', password: 'x' }), /web API key/);
    });
});

describe('saved admin sign-in', () => {
    const tmpDir = async () => (await import('node:fs')).mkdtempSync((await import('node:path')).join((await import('node:os')).tmpdir(), 'wpa-session-'));
    // A Firebase Auth fake whose refresh endpoint accepts only issued refresh tokens.
    function firebaseWithRefresh() {
        const valid = new Set();
        const calls = [];
        let issued = 0;
        const reply = (status, body) => ({ ok: status < 300, status, statusText: '', json: async () => body });
        const fetch = async (url, init) => {
            const u = new URL(url);
            calls.push(u.pathname);
            if (u.pathname.endsWith('/accounts:signInWithPassword')) {
                const token = `refresh-${++issued}`;
                valid.add(token);
                return reply(200, { idToken: `id-${issued}`, refreshToken: token, expiresIn: '3600', localId: 'uid-1', email: JSON.parse(init.body).email });
            }
            const token = new URLSearchParams(init.body).get('refresh_token');
            if (!valid.has(token)) return reply(400, { error: { message: 'TOKEN_EXPIRED' } });
            return reply(200, { id_token: `id-${++issued}`, refresh_token: token, expires_in: '3600', user_id: 'uid-1' });
        };
        return { fetch, calls, valid };
    }

    test('the first run asks for the password and saves the sign-in (owner-only); the next run asks nothing', async () => {
        const fs = await import('node:fs');
        const { promptAdminSignIn, loadSavedSession, forgetAdminSession } = await import('../src/services/adminSession.js');
        const dir = await tmpDir();
        const firebase = firebaseWithRefresh();
        let asked = 0;
        const options = { apiKey: 'k', projectId: 'proj', dir, fetch: firebase.fetch, askEmail: async () => { asked++; return 'admin@wpa.church'; }, askPassword: async () => { asked++; return 'pw'; } };

        const first = await promptAdminSignIn(options);
        assert.equal(asked, 2);
        assert.equal(await first.getToken(), 'id-1');
        const saved = loadSavedSession('proj', { dir });
        assert.equal(saved.refreshToken, 'refresh-1');
        assert.equal(saved.email, 'admin@wpa.church');
        const file = fs.readdirSync(dir).map((f) => `${dir}/${f}`)[0];
        assert.equal(fs.statSync(file).mode & 0o777, 0o600);

        const second = await promptAdminSignIn(options);
        assert.equal(asked, 2, 'no prompts');
        assert.equal(second.email, 'admin@wpa.church');
        assert.equal(await second.getToken(), 'id-2');

        assert.equal(forgetAdminSession('proj', { dir }), true);
        await promptAdminSignIn(options);
        assert.equal(asked, 4, 'asked again after signing out');
    });

    test('a revoked saved sign-in is deleted and the password asked; a different --email ignores it; remember: false saves nothing', async () => {
        const { promptAdminSignIn, loadSavedSession, saveSession } = await import('../src/services/adminSession.js');
        const dir = await tmpDir();
        const firebase = firebaseWithRefresh();
        let asked = 0;
        const askPassword = async () => { asked++; return 'pw'; };
        saveSession('proj', { email: 'admin@wpa.church', uid: 'uid-1', refreshToken: 'revoked' }, { dir });

        const session = await promptAdminSignIn({ apiKey: 'k', projectId: 'proj', dir, fetch: firebase.fetch, email: 'admin@wpa.church', askPassword });
        assert.equal(asked, 1);
        assert.equal(loadSavedSession('proj', { dir }).refreshToken, session.refreshToken);

        await promptAdminSignIn({ apiKey: 'k', projectId: 'proj', dir, fetch: firebase.fetch, email: 'someone-else@wpa.church', askPassword });
        assert.equal(asked, 2, 'a saved sign-in for another account is not used');

        const other = await tmpDir();
        await promptAdminSignIn({ apiKey: 'k', projectId: 'proj', dir: other, fetch: firebase.fetch, email: 'a@wpa.church', askPassword, remember: false });
        assert.equal(loadSavedSession('proj', { dir: other }), null);
    });

    test('a network failure keeps the saved sign-in', async () => {
        const { promptAdminSignIn, loadSavedSession, saveSession } = await import('../src/services/adminSession.js');
        const dir = await tmpDir();
        saveSession('proj', { email: 'admin@wpa.church', uid: 'uid-1', refreshToken: 'r' }, { dir });
        const offline = async () => { throw new TypeError('fetch failed'); };
        await assert.rejects(promptAdminSignIn({ apiKey: 'k', projectId: 'proj', dir, fetch: offline }), /fetch failed/);
        assert.equal(loadSavedSession('proj', { dir }).refreshToken, 'r');
    });
});
