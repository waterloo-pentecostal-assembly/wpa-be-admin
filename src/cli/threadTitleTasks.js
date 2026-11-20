// Fixing forum thread titles that are too long (src/services/threadTitleFix.js),
// shared by the admin CLI (Maintenance) and scripts/fix-thread-titles.js.

import fs from 'node:fs';
import path from 'node:path';
import { ThreadTitleFix, MAX_TITLE_LENGTH } from '../services/threadTitleFix.js';
import { DEFAULT_BACKUP_DIR, projectLabel } from './scriptureTasks.js';

const BACKUP_PREFIX = 'thread-titles';

const preview = (text, n = 100) => (text.length > n ? `${text.slice(0, n)}…` : text);

/** The part of `title` that the new title leaves out (what only the first comment keeps). */
export function removedPart(title, newTitle) {
    const kept = newTitle.endsWith('...') ? newTitle.slice(0, -3) : newTitle;
    return title.startsWith(kept) ? title.slice(kept.length).trimStart() : title;
}

/**
 * Finds threads with titles over the limit and (with `apply`) shortens them,
 * adding each original title as the thread's first comment. Writes a backup
 * before changing anything.
 *
 * @param {object} options
 * @param {import('firebase-admin').firestore.Firestore} options.firestore
 * @param {string} options.env - prod | dev | local_dev (recorded in the backup)
 * @param {string[]|null} [options.forumIds] - only these forums (= series IDs); default: all
 * @param {string[]|null} [options.threadIds] - only these threads (in those forums); default: all
 * @param {boolean} [options.apply] - write; otherwise a dry run
 * @param {number} [options.maxLength]
 * @param {string} [options.backupDir]
 * @param {boolean} [options.verbose] - print all of the cut-off text (default: its start)
 * @param {(message: string) => Promise<boolean>} [options.confirmWrite]
 * @param {ThreadTitleFix} [options.fixer] - for tests
 * @returns {Promise<{ applied: boolean, threads: number, backupFile: string|null }>}
 */
export async function runThreadTitleFix({
    firestore, env, forumIds = null, threadIds = null, apply = false, maxLength = MAX_TITLE_LENGTH,
    backupDir = DEFAULT_BACKUP_DIR, verbose = false, confirmWrite = async () => true, fixer = null,
}) {
    const fix = fixer ?? new ThreadTitleFix(firestore, { maxLength });
    console.log(`${apply ? 'Fixing' : 'Dry run for'} thread titles over ${fix.maxLength} characters in ${projectLabel(env)}`);
    const plan = await fix.plan(forumIds, {
        threadIds,
        onSkip: (where, reason) => console.log(`  Skipped ${where}: ${reason}`),
    });
    const seriesTitles = new Map();
    for (const forumId of new Set(plan.map((p) => p.forumId))) {
        const doc = await firestore.collection('bible_series').doc(forumId).get();
        seriesTitles.set(forumId, doc.exists ? doc.data().title : null);
    }
    for (const item of plan) {
        console.log(`\n  ${seriesTitles.get(item.forumId) ?? '(no series)'} [${item.forumId}] thread ${item.threadId} by ${item.comment.author_name ?? item.comment.author_id ?? 'unknown'}`);
        const removed = removedPart(item.title, item.newTitle);
        console.log(`    title now:  ${item.title.length} chars`);
        console.log(`    new title:  ${item.newTitle}  (${item.newTitle.length} chars)`);
        console.log(`    cut off:    ${verbose ? removed : preview(removed)}  (${removed.length} chars; the full title becomes the first comment)`);
    }
    console.log(`\n${plan.length} ${plan.length === 1 ? 'thread' : 'threads'} to fix${plan.length ? ': each gets a shorter title and its full title as the first comment' : ''}.`);
    const result = { applied: false, threads: plan.length, backupFile: null };
    if (!apply || !plan.length) return result;

    if (!(await confirmWrite(`Fix ${plan.length} thread titles in ${env} (${projectLabel(env)})?`))) {
        console.log('Cancelled; nothing written.');
        return result;
    }
    const withIds = fix.assignCommentIds(plan);
    fs.mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(backupDir, `${BACKUP_PREFIX}-${env}-${stamp}.json`);
    fs.writeFileSync(backupFile, JSON.stringify({
        kind: BACKUP_PREFIX,
        env,
        created_at: new Date().toISOString(),
        threads: withIds.map(({ forumId, threadId, path: p, title, newTitle, commentId }) => ({ forumId, threadId, path: p, title, newTitle, commentId })),
    }, null, 2));
    console.log(`Backup of ${withIds.length} original titles written to ${backupFile}`);
    const fixed = await fix.apply(withIds);
    console.log(`Fixed ${fixed} threads.`);
    return { applied: true, threads: fixed, backupFile };
}

/** Thread title backups for an environment, newest first: [{ file, name, createdAt, threads }]. */
export function listThreadTitleBackups(env, backupDir = DEFAULT_BACKUP_DIR) {
    if (!fs.existsSync(backupDir)) return [];
    return fs.readdirSync(backupDir)
        .filter((name) => name.startsWith(`${BACKUP_PREFIX}-${env}-`) && name.endsWith('.json'))
        .map((name) => {
            const file = path.join(backupDir, name);
            try {
                const backup = JSON.parse(fs.readFileSync(file, 'utf8'));
                return { file, name, createdAt: backup.created_at, threads: backup.threads?.length ?? 0 };
            } catch {
                return null;
            }
        })
        .filter(Boolean)
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

/**
 * Undoes a fix from its backup: original titles back, added comments deleted.
 * @returns {Promise<{ restored: number, skipped: string[] }|null>} null if cancelled
 */
export async function restoreThreadTitleBackup({ firestore, env, file, confirmWrite = async () => true, fixer = null }) {
    const backup = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (backup.kind !== BACKUP_PREFIX) throw new Error(`${path.basename(file)} is not a thread title backup`);
    if (backup.env !== env) throw new Error(`Backup is for ${backup.env}, not ${env}`);
    if (!(await confirmWrite(`Put back ${backup.threads.length} long thread titles (and delete the comments added for them) in ${env} (${projectLabel(env)}) from ${path.basename(file)}?`))) {
        console.log('Cancelled; nothing written.');
        return null;
    }
    const result = await (fixer ?? new ThreadTitleFix(firestore)).restore(backup.threads);
    console.log(`Restored ${result.restored} threads.`);
    for (const p of result.skipped) console.log(`  skipped ${p}: its title changed since the fix (or it was deleted)`);
    return result;
}
