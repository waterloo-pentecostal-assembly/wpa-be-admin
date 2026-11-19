// Signs in as an admin from the command line, for scripts that call the Bible
// proxy (which only accepts admins' Firebase ID tokens and has no
// service-to-service auth). Uses the same email/password sign-in as the
// console (Firebase Authentication's REST API with the project's public web
// API key), so the script acts as that admin: no service account or stored
// key is involved.
//
// To avoid asking for the password every run, the session's refresh token is
// saved (like `firebase login`) to ~/.config/wpa-be-admin/ (owner-only file),
// one per project, and later runs exchange it for a fresh ID token. It lasts
// until you sign out (forgetAdminSession), change your password, or it is
// revoked. BIBLE_ADMIN_REMEMBER=0 turns saving off.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

const IDENTITY_TOOLKIT = 'https://identitytoolkit.googleapis.com/v1';
const SECURE_TOKEN = 'https://securetoken.googleapis.com/v1/token';
// Refresh this long before the token's expiry.
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export class AdminSessionError extends Error {}

async function postJson(fetchImpl, url, body, form = false) {
    const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': form ? 'application/x-www-form-urlencoded' : 'application/json' },
        body: form ? new URLSearchParams(body).toString() : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
        const code = json?.error?.message || res.statusText;
        throw new AdminSessionError(code === 'INVALID_LOGIN_CREDENTIALS' || code === 'INVALID_PASSWORD' || code === 'EMAIL_NOT_FOUND'
            ? 'Wrong email or password'
            : `Sign-in failed (${code})`);
    }
    return json;
}

/**
 * Signs in with email and password.
 *
 * @param {{ apiKey: string, email: string, password: string, fetch?: typeof fetch, now?: () => number,
 *   onRefreshToken?: (refreshToken: string, user: { uid: string, email: string }) => void }} options
 *   `onRefreshToken` is called with the refresh token now and whenever it changes.
 * @returns {Promise<AdminSession>}
 *
 * @typedef {{ uid: string, email: string, canRefresh: true, refreshToken: string,
 *   getToken: (forceRefresh?: boolean) => Promise<string> }} AdminSession
 *   A BibleAuth (see apiBibleClient.js) that refreshes its ID token when
 *   it is about to expire or when asked to.
 */
export async function signInAdmin({ apiKey, email, password, fetch: fetchImpl = globalThis.fetch, now = () => Date.now(), onRefreshToken }) {
    if (!apiKey) throw new AdminSessionError('No Firebase web API key to sign in with');
    const signedIn = await postJson(
        fetchImpl,
        `${IDENTITY_TOOLKIT}/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`,
        { email, password, returnSecureToken: true },
    );
    return session({
        apiKey, fetchImpl, now, onRefreshToken,
        uid: signedIn.localId,
        email: signedIn.email ?? email,
        idToken: signedIn.idToken,
        refreshToken: signedIn.refreshToken,
        expiresIn: signedIn.expiresIn,
    });
}

/**
 * Resumes a session from a saved refresh token (exchanging it for an ID token
 * straight away, so a revoked or expired one fails here).
 *
 * @param {{ apiKey: string, refreshToken: string, email?: string, fetch?: typeof fetch, now?: () => number,
 *   onRefreshToken?: (refreshToken: string, user: { uid: string, email: string }) => void }} options
 * @returns {Promise<AdminSession>}
 */
export async function resumeAdminSession({ apiKey, refreshToken, email, fetch: fetchImpl = globalThis.fetch, now = () => Date.now(), onRefreshToken }) {
    if (!apiKey) throw new AdminSessionError('No Firebase web API key to sign in with');
    const refreshed = await postJson(
        fetchImpl,
        `${SECURE_TOKEN}?key=${encodeURIComponent(apiKey)}`,
        { grant_type: 'refresh_token', refresh_token: refreshToken },
        true,
    );
    return session({
        apiKey, fetchImpl, now, onRefreshToken,
        uid: refreshed.user_id,
        email,
        idToken: refreshed.id_token,
        refreshToken: refreshed.refresh_token,
        expiresIn: refreshed.expires_in,
    });
}

function session({ apiKey, fetchImpl, now, onRefreshToken, uid, email, idToken: firstIdToken, refreshToken: firstRefreshToken, expiresIn }) {
    let idToken = firstIdToken;
    let refreshToken = firstRefreshToken;
    let expiresAt = now() + Number(expiresIn ?? 3600) * 1000;
    let refreshing = null;
    const who = { uid, email };
    onRefreshToken?.(refreshToken, who);

    const refresh = async () => {
        const refreshed = await postJson(
            fetchImpl,
            `${SECURE_TOKEN}?key=${encodeURIComponent(apiKey)}`,
            { grant_type: 'refresh_token', refresh_token: refreshToken },
            true,
        );
        idToken = refreshed.id_token;
        if (refreshed.refresh_token && refreshed.refresh_token !== refreshToken) {
            refreshToken = refreshed.refresh_token;
            onRefreshToken?.(refreshToken, who);
        }
        expiresAt = now() + Number(refreshed.expires_in ?? 3600) * 1000;
    };

    return {
        uid,
        email,
        canRefresh: true,
        get refreshToken() {
            return refreshToken;
        },
        async getToken(forceRefresh = false) {
            if (forceRefresh || now() > expiresAt - REFRESH_MARGIN_MS) {
                refreshing ??= refresh().finally(() => { refreshing = null; });
                await refreshing;
            }
            return idToken;
        },
    };
}

/** Asks a question on the terminal; `hidden` doesn't echo the answer (passwords). */
export function ask(question, { hidden = false } = {}) {
    return new Promise((resolve, reject) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
        if (hidden) {
            rl._writeToOutput = (text) => {
                if (text.includes(question)) rl.output.write(text);
            };
        }
        rl.question(question, (answer) => {
            if (hidden) rl.output.write('\n');
            rl.close();
            resolve(answer.trim());
        });
        rl.on('SIGINT', () => {
            rl.close();
            reject(new AdminSessionError('Cancelled'));
        });
    });
}

/** Where saved sign-ins live: $XDG_CONFIG_HOME/wpa-be-admin or ~/.config/wpa-be-admin. */
export function sessionDir(env = process.env) {
    return path.join(env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'wpa-be-admin');
}

const sessionFile = (projectId, dir) => path.join(dir, `admin-session-${String(projectId).replace(/[^\w.-]/g, '_')}.json`);

/** The saved sign-in for a project, or null. */
export function loadSavedSession(projectId, { dir = sessionDir() } = {}) {
    if (!projectId) return null;
    try {
        const saved = JSON.parse(fs.readFileSync(sessionFile(projectId, dir), 'utf8'));
        return saved?.refreshToken ? saved : null;
    } catch {
        return null;
    }
}

/** Saves a project's sign-in, readable only by you. */
export function saveSession(projectId, { email, uid, refreshToken }, { dir = sessionDir() } = {}) {
    if (!projectId || !refreshToken) return;
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = sessionFile(projectId, dir);
    fs.writeFileSync(file, `${JSON.stringify({ projectId, email, uid, refreshToken, savedAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 });
    fs.chmodSync(file, 0o600);
}

/** Forgets a project's saved sign-in. @returns {boolean} whether there was one */
export function forgetAdminSession(projectId, { dir = sessionDir() } = {}) {
    if (!projectId) return false;
    try {
        fs.unlinkSync(sessionFile(projectId, dir));
        return true;
    } catch {
        return false;
    }
}

const rememberEnabled = (env = process.env) => !['0', 'false', 'no'].includes(String(env.BIBLE_ADMIN_REMEMBER ?? '').toLowerCase());

/**
 * Signs in for a script. Uses the project's saved sign-in if there is one
 * (and it is for `email`, when given); otherwise the email from `email` or
 * BIBLE_ADMIN_EMAIL (else asked) and the password, asked without echoing,
 * and saves the sign-in for next time. `askEmail` and `askPassword` replace
 * the terminal prompts (e.g. with the CLI's).
 */
export async function promptAdminSignIn({
    apiKey,
    email = process.env.BIBLE_ADMIN_EMAIL,
    projectId = null,
    askEmail = () => ask('Email: '),
    askPassword = () => ask('Password: ', { hidden: true }),
    remember = rememberEnabled(),
    dir = sessionDir(),
    fetch: fetchImpl = globalThis.fetch,
} = {}) {
    const persist = remember && projectId
        ? (refreshToken, user) => {
            try {
                saveSession(projectId, { ...user, refreshToken }, { dir });
            } catch (error) {
                console.warn(`Couldn't save the sign-in (${error.message}); you'll be asked again next time.`);
            }
        }
        : undefined;

    const saved = remember ? loadSavedSession(projectId, { dir }) : null;
    if (saved && (!email || saved.email?.toLowerCase() === email.toLowerCase())) {
        try {
            const session = await resumeAdminSession({
                apiKey, refreshToken: saved.refreshToken, email: saved.email, fetch: fetchImpl,
                onRefreshToken: persist,
            });
            console.log(`Signed in as ${session.email} (saved sign-in for ${projectId}).`);
            return session;
        } catch (error) {
            if (!(error instanceof AdminSessionError)) throw error; // offline etc.: keep it for next time
            forgetAdminSession(projectId, { dir });
            console.log(`The saved sign-in for ${projectId} no longer works (${error.message}); sign in again.`);
        }
    }

    console.log(`Sign in as an admin${projectId ? ` of ${projectId}` : ''} (the Bible proxy only serves admins).`);
    const address = email || await askEmail();
    const password = await askPassword(address);
    const session = await signInAdmin({ apiKey, email: address, password, fetch: fetchImpl, onRefreshToken: persist });
    console.log(`Signed in as ${session.email}${persist ? ` (saved: you won't be asked again for ${projectId} until you sign out)` : ''}.`);
    return session;
}
