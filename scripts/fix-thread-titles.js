#!/usr/bin/env node
// Shortens forum thread titles that are too long for the app to lay out
// (see src/services/threadTitleFix.js). Each thread at
// forums/{seriesId}/threads/{threadId} whose title is over the limit gets
// the title cut to fit with "..." at the end, and the full original title as
// its first comment (by the thread's author, dated when the thread was
// created). comment_count goes up by one.
//
// Dry run by default: lists the threads and writes nothing. With --apply,
// the original titles (and the IDs of the comments added) are first saved to
// a backup file, which --restore puts back.
//
//   npm run fix:thread-titles -- --env dev
//   npm run fix:thread-titles -- --env dev --series <seriesId> --apply
//   npm run fix:thread-titles -- --env prod --thread <threadId> --apply
//   npm run fix:thread-titles -- --env prod --apply
//   npm run fix:thread-titles -- --env prod --restore backups/thread-titles-prod-....json
//
// Options:
//   --env prod|dev|local_dev  Firebase project (local_dev = Firestore emulator on localhost:8081)
//   --series <id>             only this series' forum (repeatable; default: every forum)
//   --thread <id>             only this thread (repeatable; looked for in the --series forums, else in every forum)
//   --max-length <n>          longest title kept as it is (default 150)
//   --apply                   write the changes (after saving a backup)
//   --backup-dir <dir>        where backups go (default: backups/)
//   --restore <file>          put the titles in a backup file back, then exit
//   --verbose                 print all of the text cut off each title (default: its start)
//   --yes                     don't ask before writing to prod
//
// The same fix is in the admin CLI: npm run cli → Maintenance.

import '../src/config/loadEnv.js'; // first: .env must be loaded before anything reads process.env
import fs from 'node:fs';
import readline from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import admin from 'firebase-admin';
import { loadServiceAccount } from '../src/config/serviceAccount.js';
import { DEFAULT_BACKUP_DIR, ENVS } from '../src/cli/scriptureTasks.js';
import { restoreThreadTitleBackup, runThreadTitleFix } from '../src/cli/threadTitleTasks.js';
import { MAX_TITLE_LENGTH } from '../src/services/threadTitleFix.js';

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
                series: { type: 'string', multiple: true },
                thread: { type: 'string', multiple: true },
                'max-length': { type: 'string', default: String(MAX_TITLE_LENGTH) },
                apply: { type: 'boolean', default: false },
                'backup-dir': { type: 'string', default: DEFAULT_BACKUP_DIR },
                restore: { type: 'string' },
                verbose: { type: 'boolean', default: false },
                yes: { type: 'boolean', default: false },
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
        return admin.initializeApp({ projectId: 'wpa-be-app-dev' }, 'thread-titles').firestore();
    }
    const serviceAccount = loadServiceAccount(env);
    if (!serviceAccount) throw new Error(`No Firebase credentials found for ${env} (see README: service-account${env === 'dev' ? '-dev' : ''}.json)`);
    return admin.initializeApp({ credential: admin.credential.cert(serviceAccount) }, 'thread-titles').firestore();
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
    const maxLength = Number(args['max-length']);
    if (!Number.isInteger(maxLength) || maxLength < 4) usage('--max-length must be a whole number of at least 4');

    const firestore = connect(args.env);
    // Writing to prod asks first, unless --yes.
    const confirmWrite = (message) => (args.env === 'prod' && !args.yes ? confirm(message) : Promise.resolve(true));

    if (args.restore) {
        await restoreThreadTitleBackup({ firestore, env: args.env, file: args.restore, confirmWrite });
        return;
    }
    const result = await runThreadTitleFix({
        firestore,
        env: args.env,
        forumIds: args.series,
        threadIds: args.thread,
        apply: args.apply,
        maxLength,
        backupDir: args['backup-dir'],
        verbose: args.verbose,
        confirmWrite,
    });
    if (!args.apply && result.threads) console.log('Run again with --apply to write these changes.');
    if (result.backupFile) console.log(`Undo: npm run fix:thread-titles -- --env ${args.env} --restore ${result.backupFile}`);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(`\nFixing thread titles failed: ${error.message}`);
        process.exit(1);
    });
