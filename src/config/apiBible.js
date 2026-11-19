// Scripture settings. Bible content comes from our Bible proxy
// (wpa-be-bible-proxy), which holds the API.Bible keys: this console has no
// API.Bible credentials and authenticates each call with the signed-in
// admin's Firebase ID token (see src/services/apiBibleClient.js).
//
// Environment variables:
//   BIBLE_API_BASE_URL          the proxy's API.Bible base URL
//                               (default https://wpa-be-bible-proxy.onrender.com/admin/v1)
//   API_BIBLE_DEFAULT_BIBLE_ID  translation used when a series doesn't pick one
//   API_BIBLE_BIBLE_IDS         comma-separated translations admins may pick;
//                               empty = every Bible the proxy can serve
//   API_BIBLE_FUMS              "false" to stop reporting FUMS views
//   BIBLE_API_RATE_LIMIT        optional cap on requests this server sends the
//                               proxy, e.g. "5/s" or "60/min" (default: none)

import { ApiBibleClient, DEFAULT_BIBLE_API_BASE_URL, DEFAULT_RATE_LIMIT, parseRateLimit } from '../services/apiBibleClient.js';
import { ApiBibleService } from '../services/apiBibleService.js';

const list = (value) => String(value ?? '').split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ baseUrl: string, defaultBibleId: string|null, bibleIds: string[], fums: boolean, rateLimit: { requests: number, perMs: number }|null }}
 */
export function loadBibleConfig(env = process.env) {
    const rateLimit = env.BIBLE_API_RATE_LIMIT ? parseRateLimit(env.BIBLE_API_RATE_LIMIT) : DEFAULT_RATE_LIMIT;
    if (env.BIBLE_API_RATE_LIMIT && !rateLimit) console.warn(`Ignoring BIBLE_API_RATE_LIMIT="${env.BIBLE_API_RATE_LIMIT}" (use e.g. "5/s" or "60/min"); not pacing requests`);
    return {
        baseUrl: env.BIBLE_API_BASE_URL || DEFAULT_BIBLE_API_BASE_URL,
        defaultBibleId: env.API_BIBLE_DEFAULT_BIBLE_ID || null,
        bibleIds: list(env.API_BIBLE_BIBLE_IDS),
        fums: String(env.API_BIBLE_FUMS ?? 'true').toLowerCase() !== 'false',
        rateLimit: rateLimit ?? DEFAULT_RATE_LIMIT,
    };
}

/**
 * Builds the ApiBibleService for the proxy. It has no credentials of its own:
 * call `service.withAuth(auth)` for a copy that sends an admin's ID token.
 *
 * @returns {{ service: ApiBibleService, config: ReturnType<typeof loadBibleConfig> }}
 */
export function createApiBibleService(env = process.env, { fetch } = {}) {
    const config = loadBibleConfig(env);
    const client = new ApiBibleClient({ baseUrl: config.baseUrl, fums: config.fums, rateLimit: config.rateLimit, ...(fetch ? { fetch } : {}) });
    const service = new ApiBibleService(client, { defaultBibleId: config.defaultBibleId, allowedBibleIds: config.bibleIds });
    return { service, config };
}
