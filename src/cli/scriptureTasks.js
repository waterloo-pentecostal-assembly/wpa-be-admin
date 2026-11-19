// Scripture maintenance shared by the admin CLI (src/cli/scripture.js) and the
// standalone scripts (scripts/backfill-scripture.js, scripts/check-bible-proxy.js):
//
// - runScriptureBackfill: rewrites scripture stored in Firebase with API.Bible
//   text fetched through the Bible proxy (dry run unless `apply`), saving a
//   backup before it writes
// - restoreScriptureBackup: puts a backup back
// - runBibleProxyCheck: checks the console's access to the proxy
//
// The Bible proxy only serves admins, so these sign in as one
// (signInForScripture). Prompts are passed in so each caller can use its own.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApiBibleService } from '../config/apiBible.js';
import { loadServiceAccount } from '../config/serviceAccount.js';
import { loadClientConfigFor, loadWebApiKey, webApiKeyVar } from '../config/firebaseClient.js';
import { forgetAdminSession, promptAdminSignIn, sessionDir, signInAdmin } from '../services/adminSession.js';
import { ScriptureBackfill, chaptersUsed, restoreBodies } from '../services/scriptureBackfill.js';
import { passageIdsFor } from '../../ui/src/series/scriptureRefs.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DEFAULT_BACKUP_DIR = path.join(ROOT, 'backups');
export const ENVS = ['prod', 'dev', 'local_dev'];

/**
 * Which project to sign in to for the Bible proxy. This only decides who may
 * fetch scripture, not which data is read or written, so it doesn't follow
 * the data environment: it's the project whose admins the proxy accepts
 * (wpa-be-app, the one the console signs in to). BIBLE_PROXY_AUTH_ENV=dev
 * switches it once the proxy also accepts wpa-be-app-dev tokens.
 */
export function authEnvFor() {
    return process.env.BIBLE_PROXY_AUTH_ENV === 'dev' ? 'dev' : 'prod';
}

/** The Firebase project an environment's data lives in, for messages. */
export function projectLabel(env) {
    if (env === 'local_dev') return `wpa-be-app-dev (emulator ${process.env.FIRESTORE_EMULATOR_HOST ?? 'localhost:8081'})`;
    return loadServiceAccount(env)?.project_id ?? env;
}

/** The project signed in to for the Bible proxy (see authEnvFor). */
export function proxyProjectId() {
    const authEnv = authEnvFor();
    return loadServiceAccount(authEnv)?.project_id ?? loadClientConfigFor(authEnv)?.projectId ?? null;
}

/**
 * Forgets the saved Bible proxy sign-in (see promptAdminSignIn).
 * @returns {{ projectId: string|null, forgotten: boolean, dir: string }}
 */
export function signOutOfScripture() {
    const projectId = proxyProjectId();
    return { projectId, forgotten: forgetAdminSession(projectId), dir: sessionDir() };
}

/**
 * Signs in as an admin of the project the Bible proxy accepts (see authEnvFor),
 * whichever environment's data is being worked on.
 * @param {{ email?: string, askEmail?: Function, askPassword?: Function }} options
 */
export async function signInForScripture({ email, askEmail, askPassword } = {}) {
    const authEnv = authEnvFor();
    const projectId = proxyProjectId();
    const apiKey = loadWebApiKey(authEnv, projectId);
    if (!apiKey) throw new Error(`No Firebase web API key for ${authEnv}: set ${webApiKeyVar(authEnv)} or add src/config/${authEnv === 'dev' ? 'firebase-client-config-dev.json' : 'firebase-client-config.json'} (Firebase console → Project settings → General)`);
    return promptAdminSignIn({ apiKey, email, projectId, ...(askEmail && { askEmail }), ...(askPassword && { askPassword }) });
}

/**
 * Backfills scripture in `firestore` (see src/services/scriptureBackfill.js).
 *
 * @param {object} options
 * @param {import('firebase-admin').firestore.Firestore} options.firestore
 * @param {string} options.env - prod | dev | local_dev (recorded in the backup)
 * @param {object} options.session - an admin session (signInForScripture)
 * @param {string} [options.bibleId] - translation (default: API_BIBLE_DEFAULT_BIBLE_ID)
 * @param {string[]} [options.seriesIds] - only these series (default: all)
 * @param {boolean} [options.apply] - write (after a backup); otherwise a dry run
 * @param {boolean} [options.force] - redo series already recorded in the translation
 * @param {number} [options.maxCalls] - stop if more chapter fetches could be needed
 * @param {string} [options.backupDir]
 * @param {boolean} [options.verbose] - list every entry that changes
 * @param {(message: string) => Promise<boolean>} [options.confirmWrite] - asked before writing
 * @returns {Promise<{ applied: boolean, backupFile: string|null, updates: number, series: number, errors: number }>}
 */
export async function runScriptureBackfill({
    firestore, env, session, bibleId = 'default', seriesIds = null, apply = false, force = false,
    maxCalls = 1000, backupDir = DEFAULT_BACKUP_DIR, verbose = false, confirmWrite = async () => true,
}) {
    const projectId = projectLabel(env);
    const bible = createApiBibleService().service.withAuth(session);
    const backfill = new ScriptureBackfill(firestore, bible, { bibleId: bibleId || 'default', force });
    const translation = await bible.getBible(backfill.bibleId);
    console.log(`${apply ? 'Backfilling' : 'Dry run for'} ${projectId} with ${translation.abbreviation} (${translation.name}, ${translation.id})${force ? ', redoing series already in it' : ''}`);

    const series = await backfill.listSeries(seriesIds?.length ? seriesIds : undefined);
    for (const s of series.filter((x) => x.missing)) console.warn(`  Series ${s.id} not found; skipped`);
    const current = series.filter((s) => !s.missing && backfill.isCurrent(s));
    for (const s of current) console.log(`  ${s.title || '(untitled)'} [${s.id}] is already in ${translation.abbreviation}; skipped (force to redo)`);
    const found = series.filter((s) => !s.missing && !backfill.isCurrent(s));

    // Read everything first so the cost is known before any fetch.
    const contents = new Map();
    for (const s of found) contents.set(s.id, await backfill.readContent(s.id));
    const chapters = chaptersUsed([...contents.values()].flat());
    console.log(`${found.length} series, ${[...contents.values()].reduce((n, c) => n + c.length, 0)} entries, up to ${chapters.size} chapters to fetch from the Bible proxy`);
    if (Number.isFinite(maxCalls) && chapters.size > maxCalls) {
        throw new Error(`That could take ${chapters.size} chapter fetches (limit ${maxCalls}). Do fewer series at a time, or raise the limit.`);
    }

    const plans = [];
    for (const s of found) {
        const plan = await backfill.planSeries(s, contents.get(s.id));
        plans.push(plan);
        console.log(`\n${s.title || '(untitled)'} [${s.id}]: ${plan.updates.length} of ${plan.entries} entries change`
            + ` (${plan.blocks} scripture blocks, ${plan.errors.length} not rewritable)`
            + (plan.markSeries ? '' : plan.errors.length ? `; not recorded as ${translation.abbreviation} until those are fixed` : ''));
        for (const e of plan.errors) console.log(`  ! ${e}`);
        for (const w of plan.warnings) console.log(`  ~ ${w}`);
        if (verbose) for (const u of plan.updates) console.log(`  · ${u.path}`);
    }

    const updates = plans.flatMap((p) => p.updates);
    const marked = plans.filter((p) => p.markSeries);
    const errors = plans.reduce((n, p) => n + p.errors.length, 0);
    const result = { applied: false, backupFile: null, updates: updates.length, series: marked.length, errors };
    console.log(`\nTotal: ${updates.length} entries to update, ${errors} blocks left unchanged, ${marked.length} series to record as ${translation.abbreviation}. Bible proxy requests made: ${bible.client.requestCount}.`);
    if (!apply) {
        console.log('Dry run: nothing was written.');
        return result;
    }
    if (!updates.length && !marked.length) {
        console.log('Nothing to write.');
        return result;
    }
    if (!(await confirmWrite(`Write ${updates.length} entries and ${marked.length} series to ${env} (${projectId})?`))) {
        console.log('Cancelled: nothing was written.');
        return result;
    }

    fs.mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(backupDir, `scripture-${env}-${stamp}.json`);
    fs.writeFileSync(backupFile, JSON.stringify({
        env,
        project: projectId,
        bible_id: backfill.bibleId,
        created_at: new Date().toISOString(),
        docs: updates.map((u) => ({ path: u.path, body: u.before })),
        series: marked.map((p) => ({ id: p.seriesId, scripture_bible_id: p.previousBibleId })),
    }, null, 2));
    console.log(`Backup of ${updates.length} entries and ${marked.length} series written to ${backupFile}`);

    const written = await backfill.apply(plans);
    console.log(`Updated ${written.entries} entries and ${written.series} series. To undo, restore ${path.relative(process.cwd(), backupFile)}.`);
    return { ...result, applied: true, backupFile };
}

/** Backups for an environment, newest first: [{ file, name, createdAt, entries, series }]. */
export function listBackups(env, backupDir = DEFAULT_BACKUP_DIR) {
    if (!fs.existsSync(backupDir)) return [];
    return fs.readdirSync(backupDir)
        .filter((name) => name.startsWith(`scripture-${env}-`) && name.endsWith('.json'))
        .map((name) => {
            const file = path.join(backupDir, name);
            try {
                const backup = JSON.parse(fs.readFileSync(file, 'utf8'));
                return { file, name, createdAt: backup.created_at, entries: backup.docs?.length ?? 0, series: backup.series?.length ?? 0 };
            } catch {
                return null;
            }
        })
        .filter(Boolean)
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

/**
 * Puts a backup's entry bodies and series translations back.
 * @param {{ firestore: object, env: string, file: string, confirmWrite?: (message: string) => Promise<boolean> }} options
 */
export async function restoreScriptureBackup({ firestore, env, file, confirmWrite = async () => true }) {
    const backup = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (backup.env !== env) throw new Error(`Backup is for ${backup.env}, not ${env}`);
    const message = `Restore ${backup.docs.length} entries${backup.series?.length ? ` and ${backup.series.length} series` : ''} in ${env} (${projectLabel(env)}) from ${path.basename(file)} (made ${backup.created_at})?`;
    if (!(await confirmWrite(message))) {
        console.log('Cancelled: nothing was written.');
        return 0;
    }
    const written = await restoreBodies(firestore, backup.docs, backup.series ?? []);
    console.log(`Restored ${written} entries${backup.series?.length ? ` and ${backup.series.length} series` : ''}.`);
    return written;
}

/**
 * Checks the console's access to the Bible proxy: no token → 401; a
 * non-admin → 403 (if `nonAdmin` is given); as the admin, whoami, the
 * translations and each request the console makes; a repeat is a cache hit.
 *
 * @param {{ bibleId?: string, session: object, nonAdmin?: { email: string, password: string }, showRoutes?: boolean }} options
 * @returns {Promise<number>} failed checks
 */
export async function runBibleProxyCheck({ bibleId, session, nonAdmin = null, showRoutes = false }) {
    let failures = 0;
    const pass = (message) => console.log(`  ok    ${message}`);
    const fail = (message) => {
        failures++;
        console.log(`  FAIL  ${message}`);
    };

    const { service, config } = createApiBibleService();
    const origin = new URL(config.baseUrl).origin;
    console.log(`Bible proxy: ${config.baseUrl}`);

    try {
        const anonymous = await fetch(`${config.baseUrl}/bibles`, { headers: { accept: 'application/json' } });
        const anonymousBody = await anonymous.json().catch(() => ({}));
        if (anonymous.status === 401) pass(`no token → 401 (${anonymousBody.message ?? ''})`);
        else fail(`no token → ${anonymous.status}, expected 401`);

        if (nonAdmin) {
            const authEnv = authEnvFor();
            const apiKey = loadWebApiKey(authEnv, loadServiceAccount(authEnv)?.project_id ?? null);
            const other = await signInAdmin({ apiKey, email: nonAdmin.email, password: nonAdmin.password });
            const res = await fetch(`${config.baseUrl}/bibles`, { headers: { authorization: `Bearer ${await other.getToken()}` } });
            if (res.status === 403) pass('non-admin → 403');
            else fail(`non-admin → ${res.status}, expected 403`);
        }

        const bible = service.withAuth(session);
        const { client } = bible;

        const whoami = await client.send('/admin/whoami', { absolute: true });
        pass(`admin → /admin/whoami ${whoami.status}: ${JSON.stringify(whoami.body)}`);

        const { default: defaultId, bibles } = await bible.listTranslations();
        pass(`translations (${config.bibleIds.length ? 'API_BIBLE_BIBLE_IDS' : 'all the proxy serves'}): ${bibles.length}`);
        for (const b of bibles.slice(0, 20)) console.log(`        ${b.id === defaultId ? '*' : ' '} ${b.id}  ${b.abbreviation}  ${b.name}`);
        if (bibles.length > 20) console.log(`          … and ${bibles.length - 20} more`);

        const id = bible.resolveBibleId(bibleId || 'default');
        const info = await bible.getBible(id);
        pass(`Bible ${id}: ${info.abbreviation} (${info.name})`);

        const books = await client.getBooks(id);
        pass(`books with include-chapters: ${books.length} books`);

        const passage = await bible.getPassage(id, 'Romans 8:28-30');
        pass(`chapter text (content-type=json, include-*): ${passage.reference} has ${passage.verses.length} verses`);
        for (const v of passage.verses) console.log(`          ${v.verse}  ${v.text}`);

        for (const passageId of [...passageIdsFor('ROM', 8, [28, 29]), ...passageIdsFor('JHN', 3, [16])]) {
            const { body } = await client.send(`/bibles/${encodeURIComponent(id)}/passages/${encodeURIComponent(passageId)}`, { params: { 'content-type': 'text' } });
            pass(`passage ${passageId} → ${body.data?.reference}`);
        }

        const chapterPath = `/bibles/${encodeURIComponent(id)}/chapters/PSA.23`;
        const first = await client.send(chapterPath, { params: { 'content-type': 'text' } });
        const second = await client.send(chapterPath, { params: { 'content-type': 'text' } });
        const [a, b] = [first.headers.get('x-cache'), second.headers.get('x-cache')];
        if (b === 'HIT') pass(`X-Cache ${a} then ${b}${a === 'HIT' ? ' (already cached before this run)' : ''}`);
        else fail(`X-Cache ${a} then ${b}, expected HIT on the repeat`);
        if (!first.body?.meta?.fumsToken) console.log('  note  no meta.fumsToken on the chapter response');

        const stats = await client.send('/admin/stats', { absolute: true });
        console.log(`\n/admin/stats: ${JSON.stringify(stats.body, null, 2)}`);
        if (showRoutes) {
            const routes = await client.send('/admin/routes', { absolute: true });
            console.log(`\n${origin}/admin/routes: ${JSON.stringify(routes.body, null, 2)}`);
        }
        console.log(`\nProxy requests made: ${client.requestCount}`);
    } catch (error) {
        fail(error.message);
    }

    console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
    return failures;
}
