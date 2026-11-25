#!/usr/bin/env node
// Fills `search_tokens` on every existing users and challenge_groups document,
// so the app's people search and "Find a group" can find them (see
// src/services/searchTokens.js and specs/search-tokens-functions.md).
//
// Only `search_tokens` is written, with `update`, and only where the tokens
// differ: running it twice writes nothing the second time. Run it once per
// environment after the backend triggers that keep the field up to date
// (updateUserSearchTokens, updateGroupSearchTokens in wpa-be-firebase) are
// deployed; otherwise documents created or renamed afterwards have no tokens.
// Each write fires those triggers (and, on users, updatePrayerRequestUserSnippet) once.
//
//   npm run backfill:search-tokens -- --env dev --dry-run
//   npm run backfill:search-tokens -- --env dev
//   npm run backfill:search-tokens -- --env prod --collection challenge_groups
//
// Options:
//   --env prod|dev|local_dev  Firebase project (local_dev = Firestore emulator on localhost:8081)
//   --dry-run                 print what would change; write nothing
//   --collection <name>       only users or only challenge_groups (default: both)
//   --verbose                 list every document that changes
//   --yes                     don't ask before writing to prod

import '../src/config/loadEnv.js'; // first: .env must be loaded before anything reads process.env
import fs from 'node:fs';
import readline from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import admin from 'firebase-admin';
import { loadServiceAccount } from '../src/config/serviceAccount.js';
import { SEARCHABLE_COLLECTIONS } from '../src/services/searchTokens.js';
import { backfillSearchTokens } from '../src/services/searchTokensBackfill.js';

const ENVS = ['prod', 'dev', 'local_dev'];

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
                'dry-run': { type: 'boolean', default: false },
                collection: { type: 'string' },
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
        return { firestore: admin.initializeApp({ projectId: 'wpa-be-app-dev' }, 'search-tokens').firestore(), project: `emulator ${process.env.FIRESTORE_EMULATOR_HOST}` };
    }
    const serviceAccount = loadServiceAccount(env);
    if (!serviceAccount) throw new Error(`No Firebase credentials found for ${env} (see README: service-account${env === 'dev' ? '-dev' : ''}.json)`);
    return { firestore: admin.initializeApp({ credential: admin.credential.cert(serviceAccount) }, 'search-tokens').firestore(), project: serviceAccount.project_id };
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
    if (args.collection && !Object.hasOwn(SEARCHABLE_COLLECTIONS, args.collection)) usage(`--collection must be ${Object.keys(SEARCHABLE_COLLECTIONS).join(' or ')}`);
    const collections = args.collection ? [args.collection] : Object.keys(SEARCHABLE_COLLECTIONS);
    const dryRun = args['dry-run'];

    const { firestore, project } = connect(args.env);
    if (!dryRun && args.env === 'prod' && !args.yes && !(await confirm(`Write search_tokens to ${collections.join(' and ')} in PROD (${project})?`))) {
        console.log('Cancelled; nothing written.');
        return 0;
    }
    console.log(`${dryRun ? 'Dry run: ' : ''}search_tokens for ${collections.join(' and ')} in ${args.env} (${project})`);
    const summary = await backfillSearchTokens(firestore, { collections, dryRun, verbose: args.verbose, log: console.log });

    let failed = 0;
    for (const [name, r] of Object.entries(summary)) {
        failed += r.failed;
        console.log(`${name}: scanned ${r.scanned}, ${dryRun ? 'would update' : 'updated'} ${r.updated}, unchanged ${r.unchanged}, failed ${r.failed}`
            + (r.changedSince ? `, ${r.changedSince} changed or deleted since being read (left to the trigger)` : ''));
        for (const e of r.errors) console.log(`  ! ${e}`);
    }
    if (dryRun && Object.values(summary).some((r) => r.updated)) console.log('Run again without --dry-run to write these changes.');
    return failed ? 1 : 0;
}

main()
    .then((code) => process.exit(code))
    .catch((error) => {
        console.error(`\nBackfill failed: ${error.message}`);
        process.exit(1);
    });
