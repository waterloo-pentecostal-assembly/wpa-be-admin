// Server-side access control for the admin console's API. Every /api route
// needs a signed-in admin's Firebase ID token except the few the console
// needs before anyone has signed in.

/**
 * Routes that answer without signing in, as [method, path under /api]. The
 * console loads these before its sign-in page: the Firebase client config
 * (public by design) and which environment the server is on.
 */
export const PUBLIC_API_ROUTES = [
    ['GET', '/firebase-config'],
    ['GET', '/env/current'],
];

/** Reads a JWT's payload without verifying it (only to pick which project verifies it). */
function decodeJwtPayload(token) {
    try {
        return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    } catch {
        return null;
    }
}

const MAX_CACHED_SESSIONS = 500;

/**
 * Lets a request through only with a valid Firebase ID token of a signed-in
 * admin (profile `is_admin` true, matching the console's login check). The
 * token is verified by the project that issued it, which can differ from the
 * selected environment: the console signs in against one project and can
 * manage either. Disabled and signed-out (revoked) admins are rejected.
 * Sets `req.admin` = { uid, email, projectId }.
 *
 * Checking costs a call to Firebase Auth and a Firestore read, so a token
 * that passed is trusted for `cacheMs` (default a minute): revoking an
 * admin's sessions or admin access takes effect within that time.
 *
 * @param {(projectId: string) => { auth: import('firebase-admin').auth.Auth, firestore: import('firebase-admin').firestore.Firestore }|null} resolveProject
 * @param {{ cacheMs?: number, now?: () => number }} [options]
 */
export function createRequireAdmin(resolveProject, { cacheMs = 60_000, now = () => Date.now() } = {}) {
    const verified = new Map(); // token -> { admin, until }

    const remember = (token, admin, expiresAtSeconds) => {
        if (!cacheMs) return;
        if (verified.size >= MAX_CACHED_SESSIONS) {
            for (const [key, entry] of verified) if (entry.until <= now()) verified.delete(key);
            if (verified.size >= MAX_CACHED_SESSIONS) verified.delete(verified.keys().next().value);
        }
        const until = Math.min(now() + cacheMs, typeof expiresAtSeconds === 'number' ? expiresAtSeconds * 1000 : Infinity);
        verified.set(token, { admin, until });
    };

    return async (req, res, next) => {
        // Already checked further up (the /api-wide guard).
        if (req.admin) return next();

        const token = /^Bearer (.+)$/i.exec(req.get('authorization') ?? '')?.[1];
        if (!token) return res.status(401).json({ error: 'Sign in again to continue (no credentials were sent)' });

        const cached = verified.get(token);
        if (cached && cached.until > now()) {
            req.admin = cached.admin;
            return next();
        }
        verified.delete(token);

        const projectId = decodeJwtPayload(token)?.aud;
        const project = typeof projectId === 'string' ? resolveProject(projectId) : null;
        if (!project) return res.status(401).json({ error: 'Your sign-in is for a Firebase project this server cannot verify' });

        let decoded;
        try {
            decoded = await project.auth.verifyIdToken(token, true);
        } catch {
            return res.status(401).json({ error: 'Your session has expired or was revoked; sign in again' });
        }

        try {
            const users = project.firestore.collection('users');
            const own = await users.doc(decoded.uid).get();
            let isAdmin = own.exists && own.data().is_admin === true;
            if (!isAdmin && !own.exists && decoded.email) {
                const byEmail = await users.where('email', '==', decoded.email).get();
                isAdmin = byEmail.docs.some((doc) => doc.data().is_admin === true);
            }
            if (!isAdmin) return res.status(403).json({ error: 'Administrator access is required' });
        } catch (error) {
            console.error('Could not check admin access:', error);
            return res.status(503).json({ error: 'Could not check administrator access' });
        }

        req.admin = { uid: decoded.uid, email: decoded.email ?? null, projectId };
        remember(token, req.admin, decoded.exp);
        return next();
    };
}

/**
 * Requires an admin for every route under where it is mounted, except
 * `publicRoutes`. Mount it with `app.use('/api', ...)` before any /api route:
 * Express then matches it exactly as it matches the routes (case-insensitive,
 * trailing slashes), so no spelling of a path can reach a route without it.
 * A path that only looks public (e.g. a different spelling) needs signing in.
 *
 * @param {import('express').RequestHandler} requireAdmin
 * @param {Array<[string, string]>} [publicRoutes]
 */
export function protectApi(requireAdmin, publicRoutes = PUBLIC_API_ROUTES) {
    const open = new Set(publicRoutes.map(([method, path]) => `${method.toUpperCase()} ${path.toLowerCase()}`));
    return (req, res, next) => {
        const path = req.path.toLowerCase().replace(/(.)\/+$/, '$1');
        // HEAD is answered by GET routes, so it is public wherever GET is.
        const method = req.method === 'HEAD' ? 'GET' : req.method;
        if (open.has(`${method} ${path}`)) return next();
        return requireAdmin(req, res, next);
    };
}
