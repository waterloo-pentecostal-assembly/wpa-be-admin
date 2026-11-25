#!/usr/bin/env node
// Checks the console's access to scripture through the Bible proxy:
//   - a request without a token gets 401
//   - (with --non-admin <email>) a signed-in non-admin gets 403
//   - as an admin: /admin/whoami, the translations, and every request the
//     console makes (Bible, books with include-chapters, a chapter with the
//     console's content parameters, passage IDs) succeed; a 400 there means
//     the console sends a parameter the proxy doesn't allowlist
//   - repeating a request is served from the proxy's cache (X-Cache MISS, then HIT)
//   - /admin/routes and /admin/stats, for reference
//
//   npm run check:bible-proxy -- [--bible <id>] [--email <admin>] [--non-admin <email>] [--routes]
//
// You sign in with your console email and password (asked; the email can come
// from --email or BIBLE_ADMIN_EMAIL). Settings as for the server
// (BIBLE_API_BASE_URL, API_BIBLE_DEFAULT_BIBLE_ID; see src/config/apiBible.js).
// The same check is in the admin CLI: npm run cli → Scripture.

import '../src/config/loadEnv.js'; // first: .env must be loaded before anything reads process.env
import { parseArgs } from 'node:util';
import { ask } from '../src/services/adminSession.js';
import { runBibleProxyCheck, signInForScripture } from '../src/cli/scriptureTasks.js';

const { values: args } = parseArgs({
    options: {
        bible: { type: 'string' },
        email: { type: 'string' },
        'non-admin': { type: 'string' },
        routes: { type: 'boolean', default: false },
    },
});

try {
    const nonAdmin = args['non-admin']
        ? { email: args['non-admin'], password: await ask(`Password for ${args['non-admin']} (non-admin): `, { hidden: true }) }
        : null;
    const session = await signInForScripture({ email: args.email });
    const failures = await runBibleProxyCheck({ bibleId: args.bible, session, nonAdmin, showRoutes: args.routes });
    process.exit(failures ? 1 : 0);
} catch (error) {
    console.error(`\nCheck failed: ${error.message}`);
    process.exit(1);
}
