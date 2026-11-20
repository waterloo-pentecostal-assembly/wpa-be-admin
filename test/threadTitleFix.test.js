import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { memoryFirestore } from './helpers/memoryFirestore.js';
import { MAX_TITLE_LENGTH, ThreadTitleFix, truncateTitle } from '../src/services/threadTitleFix.js';
import { listThreadTitleBackups, restoreThreadTitleBackup, runThreadTitleFix } from '../src/cli/threadTitleTasks.js';

// FieldValue.increment stand-in the memory store can apply.
const INC = Symbol('increment');
const increment = (n) => ({ [INC]: n });
function applyIncrements(firestore) {
    const original = firestore.batch;
    firestore.batch = () => {
        const batch = original();
        const update = batch.update;
        batch.update = (ref, patch) => update(ref, Object.fromEntries(Object.entries(patch).map(([k, v]) => {
            if (v && typeof v === 'object' && INC in v) {
                const current = firestore.store.get(ref.path)?.[k] ?? 0;
                return [k, current + v[INC]];
            }
            return [k, v];
        })));
        return batch;
    };
    return firestore;
}

const long = (n, word = 'Lorem ') => word.repeat(Math.ceil(n / word.length)).slice(0, n);
const created = { toMillis: () => 1772541631000, seconds: 1772541631 };

async function seeded() {
    const firestore = applyIncrements(memoryFirestore());
    await firestore.collection('bible_series').doc('series1').set({ title: 'Sample Series 3' });
    const threads = firestore.collection('forums').doc('series1').collection('threads');
    const author = { author_id: 'u1', author_image_url: 'https://img/u1', author_name: 'Jane Doe' };
    await threads.doc('longOne').set({ ...author, title: long(400), comment_count: 2, created_at: created, updated_at: created, is_frozen: false, is_hidden: false });
    await threads.doc('longOne').collection('comments').doc('c1').set({ body: 'reply', liked_by: ['u2'], created_at: { toMillis: () => 1772541700000 } });
    await threads.doc('exactly150').set({ ...author, title: long(150), comment_count: 0, created_at: created });
    await threads.doc('short').set({ ...author, title: 'This is a test', comment_count: 4, created_at: created });
    // A forum with no document of its own, only threads; its comments use a map for liked_by.
    const other = firestore.collection('forums').doc('series2').collection('threads');
    await other.doc('longTwo').set({ author_id: 'u3', author_name: 'Sam', title: long(200, 'Pray for '), comment_count: 0, created_at: created });
    await other.doc('withMap').set({ author_id: 'u3', title: 'ok', comment_count: 1, created_at: created });
    await other.doc('withMap').collection('comments').doc('m1').set({ body: 'hi', liked_by: { u1: true } });
    return firestore;
}

describe('truncateTitle', () => {
    test('cuts to at most 150 characters ending in "...", without splitting characters or leaving a trailing space', () => {
        assert.equal(MAX_TITLE_LENGTH, 150);
        assert.equal(truncateTitle('short'), 'short');
        assert.equal(truncateTitle(long(150)), long(150));
        const cut = truncateTitle(long(151));
        assert.equal(cut.length, 150);
        assert.ok(cut.endsWith('...'));
        assert.equal(truncateTitle(`${'a'.repeat(146)} bcdef`), `${'a'.repeat(146)}...`, 'the space before the cut is dropped');
        const emoji = truncateTitle(`${'a'.repeat(146)}👍🏽👍🏽`); // a 4-code-unit emoji would cross the limit
        assert.equal(emoji, `${'a'.repeat(146)}...`);
        assert.ok(truncateTitle('é'.repeat(300)).length <= 150);
        assert.equal(truncateTitle(undefined), undefined);
    });
});

describe('ThreadTitleFix', () => {
    test('finds long titles in every forum and plans a shorter title plus the full title as the first comment', async () => {
        const firestore = await seeded();
        const fix = new ThreadTitleFix(firestore, { increment });
        assert.deepEqual((await fix.listForums()).sort(), ['series1', 'series2']);
        const plan = await fix.plan();
        assert.deepEqual(plan.map((p) => p.path).sort(), ['forums/series1/threads/longOne', 'forums/series2/threads/longTwo']);
        const one = plan.find((p) => p.threadId === 'longOne');
        assert.equal(one.newTitle.length, 150);
        assert.deepEqual(one.comment, {
            author_id: 'u1', author_image_url: 'https://img/u1', author_name: 'Jane Doe',
            body: long(400), created_at: created, updated_at: created,
            is_deleted: false, is_hidden: false, parent_id: null, report_count: 0, thread_id: 'longOne', liked_by: [],
        });
        const two = plan.find((p) => p.threadId === 'longTwo');
        assert.deepEqual(two.comment.liked_by, [], 'no comments of its own: uses the kind another long thread\'s comments use');
        assert.equal(two.comment.author_image_url, null);
        assert.deepEqual((await fix.plan(['series1'])).map((p) => p.threadId), ['longOne']);
    });

    test('liked_by matches a thread whose comments store it as a map', async () => {
        const firestore = applyIncrements(memoryFirestore());
        const threads = firestore.collection('forums').doc('s').collection('threads');
        await threads.doc('t').set({ author_id: 'u', title: long(200), created_at: created });
        await threads.doc('t').collection('comments').doc('c').set({ body: 'x', liked_by: { u2: true } });
        await threads.doc('lonely').set({ author_id: 'u', title: long(300), created_at: created });
        const plan = await new ThreadTitleFix(firestore, { increment }).plan();
        assert.deepEqual(plan.map((p) => p.comment.liked_by), [{}, {}]);
    });

    test('apply writes the comment, title and count together; restore undoes it unless the title changed since', async () => {
        const firestore = await seeded();
        const fix = new ThreadTitleFix(firestore, { increment });
        const plan = fix.assignCommentIds(await fix.plan());
        assert.equal(await fix.apply(plan), 2);
        const thread = firestore.store.get('forums/series1/threads/longOne');
        assert.equal(thread.title.length, 150);
        assert.equal(thread.comment_count, 3);
        assert.equal(thread.updated_at, created, 'updated_at is left alone');
        const { commentId } = plan.find((p) => p.threadId === 'longOne');
        assert.equal(firestore.store.get(`forums/series1/threads/longOne/comments/${commentId}`).body, long(400));
        assert.deepEqual(await fix.plan(), [], 'nothing left to fix');

        await firestore.collection('forums').doc('series2').collection('threads').doc('longTwo').update({ title: 'Edited since' });
        const { restored, skipped } = await fix.restore(plan);
        assert.equal(restored, 1);
        assert.deepEqual(skipped, ['forums/series2/threads/longTwo']);
        assert.equal(firestore.store.get('forums/series1/threads/longOne').title, long(400));
        assert.equal(firestore.store.get('forums/series1/threads/longOne').comment_count, 2);
        assert.equal(firestore.store.has(`forums/series1/threads/longOne/comments/${commentId}`), false);
    });
});

describe('thread title fix runner', () => {
    test('dry run writes nothing; apply saves a backup first, which restores', async () => {
        const firestore = await seeded();
        const fixer = new ThreadTitleFix(firestore, { increment });
        const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thread-titles-'));
        const log = console.log;
        console.log = () => {};
        try {
            const before = JSON.stringify([...firestore.store.entries()]);
            assert.deepEqual(await runThreadTitleFix({ firestore, env: 'dev', backupDir, fixer }), { applied: false, threads: 2, backupFile: null });
            assert.equal(JSON.stringify([...firestore.store.entries()]), before);

            assert.equal((await runThreadTitleFix({ firestore, env: 'dev', backupDir, fixer, apply: true, confirmWrite: async () => false })).applied, false);
            assert.equal(JSON.stringify([...firestore.store.entries()]), before, 'declining writes nothing');

            const result = await runThreadTitleFix({ firestore, env: 'dev', backupDir, fixer, apply: true });
            assert.equal(result.applied, true);
            const backup = JSON.parse(fs.readFileSync(result.backupFile, 'utf8'));
            assert.equal(backup.threads.length, 2);
            assert.ok(backup.threads.every((t) => t.commentId && t.title.length > 150 && t.newTitle.length <= 150));
            assert.deepEqual(listThreadTitleBackups('dev', backupDir).map((b) => b.threads), [2]);
            assert.deepEqual(listThreadTitleBackups('prod', backupDir), []);

            await assert.rejects(restoreThreadTitleBackup({ firestore, env: 'prod', file: result.backupFile, fixer }), /for dev, not prod/);
            const restored = await restoreThreadTitleBackup({ firestore, env: 'dev', file: result.backupFile, fixer });
            assert.equal(restored.restored, 2);
            assert.equal(firestore.store.get('forums/series1/threads/longOne').title, long(400));
        } finally {
            console.log = log;
        }
    });
});

describe('dry run output', () => {
    test('shows the whole new title and what is cut off, not two identical previews', async () => {
        const { removedPart } = await import('../src/cli/threadTitleTasks.js');
        const title = `${'a'.repeat(146)} bcdef ghij`;
        const newTitle = truncateTitle(title);
        assert.equal(removedPart(title, newTitle), 'bcdef ghij');
        assert.equal(removedPart('short', 'short'), '');

        const firestore = await seeded();
        const lines = [];
        const log = console.log;
        console.log = (...args) => lines.push(args.join(' '));
        try {
            await runThreadTitleFix({ firestore, env: 'dev', fixer: new ThreadTitleFix(firestore, { increment }) });
        } finally {
            console.log = log;
        }
        const newLine = lines.find((l) => l.includes('new title:') && l.includes('(150 chars)'));
        assert.ok(newLine.includes(truncateTitle(long(400))), 'the new title is printed in full');
        assert.ok(lines.some((l) => l.includes('cut off:') && l.includes('(253 chars;')));
    });
});

describe('only specific threads', () => {
    test('plans just the given thread IDs, looking in every forum unless forums are given, and reports the rest', async () => {
        const firestore = await seeded();
        const fix = new ThreadTitleFix(firestore, { increment });
        const skips = [];
        const onSkip = (where, reason) => skips.push(`${where}: ${reason}`);

        const plan = await fix.plan(null, { threadIds: ['longTwo', 'short', 'nope', 'longTwo'], onSkip });
        assert.deepEqual(plan.map((p) => p.path), ['forums/series2/threads/longTwo']);
        assert.deepEqual(skips, [
            'forums/series1/threads/short: its title is only 14 characters',
            'nope: no thread with this ID in any forum',
        ]);

        skips.length = 0;
        assert.deepEqual(await fix.plan(['series1'], { threadIds: ['longTwo'], onSkip }), []);
        assert.deepEqual(skips, ['longTwo: no thread with this ID in the forum of series1']);

        const applied = fix.assignCommentIds(await fix.plan(['series1'], { threadIds: ['longOne'] }));
        await fix.apply(applied);
        assert.equal(firestore.store.get('forums/series1/threads/longOne').title.length, 150);
        assert.equal(firestore.store.get('forums/series2/threads/longTwo').title.length, 200, 'other threads untouched');
    });
});
