#!/usr/bin/env node
// Backfills scripture stored in Firebase with API.Bible text (fetched through
// the Bible proxy) and the fields an updated app needs to fetch passages
// itself (see src/services/scriptureBackfill.js and ui/src/series/scriptureRefs.js).
//
// The Bible proxy only serves admins, so the script asks you to sign in with
// your console email and password (email from --email or BIBLE_ADMIN_EMAIL).
// That's always an admin of the project the proxy accepts (wpa-be-app; set
// BIBLE_PROXY_AUTH_ENV=dev for wpa-be-app-dev), whatever --env is.
// Restoring a backup doesn't need it.
//
// Dry run by default: prints what would change and writes nothing. With
// --apply, the current bodies of every entry about to change are first saved
// to a backup file, which --restore puts back.
//
//   npm run backfill:scripture -- --env dev
//   npm run backfill:scripture -- --env dev --series <id> --series <id> --apply
//   npm run backfill:scripture -- --env prod --bible <bibleId> --apply
//   npm run backfill:scripture -- --env prod --restore backups/scripture-prod-....json
//
// Options:
//   --env prod|dev|local_dev  Firebase project (local_dev = Firestore emulator on localhost:8081)
//   --bible <id>              API.Bible translation (default: API_BIBLE_DEFAULT_BIBLE_ID)
//   --series <id>             only this series (repeatable; default: every series)
//   --apply                   write the changes (after saving a backup)
//   --force                   also redo series already recorded as in this translation
//   --max-calls <n>           stop before starting if more than n chapter fetches
//                             could be needed (default 1000; the proxy caches, but
//                             uncached chapters count against API.Bible's quota)
//   --backup-dir <dir>        where backups go (default: backups/)
//   --restore <file>          put the bodies in a backup file back, then exit
//   --verbose                 list every entry that changes
//   --yes                     don't ask before writing to prod
//   --email <address>         admin to sign in as (default: BIBLE_ADMIN_EMAIL, else asked)
//
// Scripture settings come from the same place as the server's
// (BIBLE_API_BASE_URL, API_BIBLE_DEFAULT_BIBLE_ID; see src/config/apiBible.js).

import '../src/config/loadEnv.js'; // first: .env must be loaded before anything reads process.env
import fs from 'node:fs';
import readline from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import admin from 'firebase-admin';
import { loadServiceAccount } from '../src/config/serviceAccount.js';
import {
    DEFAULT_BACKUP_DIR, ENVS, restoreScriptureBackup, runScriptureBackfill, signInForScripture,
} from '../src/cli/scriptureTasks.js';

// The same backfill is in the admin CLI: npm run cli → Scripture.

function usage(message) {
    if (message) console.error(`Error: ${message}\n`);
    const header = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n')
        .slice(1).filter((l) => l.startsWith('//')).map((l) => l.replace(/^\/\/ ?/, ''));
    console.error(header.join('\n'));
    process.exit(message ? 1 : 0);
}

function parse() {
    try {
        return parseArgs({
            options: {
                env: { type: 'string' },
                bible: { type: 'string' },
                series: { type: 'string', multiple: true },
                apply: { type: 'boolean', default: false },
                force: { type: 'boolean', default: false },
                'max-calls': { type: 'string', default: '1000' },
                'backup-dir': { type: 'string', default: DEFAULT_BACKUP_DIR },
                restore: { type: 'string' },
                verbose: { type: 'boolean', default: false },
                yes: { type: 'boolean', default: false },
                email: { type: 'string' },
                help: { type: 'boolean', short: 'h', default: false },
            },
        }).values;
    } catch (error) {
        return usage(error.message);
    }
}

function connect(env) {
    if (env === 'local_dev') {
        process.env.FIRESTORE_EMULATOR_HOST ??= 'localhost:8081';
        return admin.initializeApp({ projectId: 'wpa-be-app-dev' }, 'scripture-backfill').firestore();
    }
    const serviceAccount = loadServiceAccount(env);
    if (!serviceAccount) throw new Error(`No Firebase credentials found for ${env} (see README: service-account${env === 'dev' ? '-dev' : ''}.json)`);
    return admin.initializeApp({ credential: admin.credential.cert(serviceAccount) }, 'scripture-backfill').firestore();
}

async function confirm(question) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
        return /^y(es)?$/i.test((await rl.question(`${question} [y/N] `)).trim());
    } finally {
        rl.close();
    }
}

async function main() {
    const args = parse();
    if (args.help) usage();
    if (!ENVS.includes(args.env)) usage('--env must be prod, dev or local_dev');

    const firestore = connect(args.env);
    // Writing to prod asks first, unless --yes.
    const confirmWrite = (message) => (args.env === 'prod' && !args.yes ? confirm(message) : Promise.resolve(true));

    if (args.restore) {
        await restoreScriptureBackup({ firestore, env: args.env, file: args.restore, confirmWrite });
        return;
    }

    const session = await signInForScripture({ email: args.email });
    const result = await runScriptureBackfill({
        firestore,
        env: args.env,
        session,
        bibleId: args.bible,
        seriesIds: args.series,
        apply: args.apply,
        force: args.force,
        maxCalls: Number(args['max-calls']),
        backupDir: args['backup-dir'],
        verbose: args.verbose,
        confirmWrite,
    });
    if (!args.apply) console.log('Run again with --apply to write these changes.');
    if (result.backupFile) console.log(`Undo: npm run backfill:scripture -- --env ${args.env} --restore ${result.backupFile}`);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(`\nBackfill failed: ${error.message}`);
        process.exit(1);
    });
