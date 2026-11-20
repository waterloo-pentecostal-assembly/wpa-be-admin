// Shortens forum thread titles that are too long for the app to lay out.
//
// Threads live at forums/{forumId}/threads/{threadId}, where the forum ID is
// the bible series ID; replies are in the thread's `comments` subcollection.
// For each thread whose title is longer than the limit (150 by default), the
// title is cut to fit with "..." at the end, and the full original title is
// added as the thread's first comment: by the thread's author, dated when the
// thread was created (so it sorts before every reply). The comment and the
// title change are written together, and the thread's comment_count goes up by one.
//
// Lengths are counted in UTF-16 code units, like Dart's String.length in the
// app, and the cut never splits a character (emoji, accented letters).

import admin from 'firebase-admin';

export const MAX_TITLE_LENGTH = 150;
const ELLIPSIS = '...';
// Firestore allows 500 writes per batch; each thread is 2.
const THREADS_PER_BATCH = 200;

/**
 * `title` cut to at most `max` characters, ending with "..." (unchanged if it fits).
 */
export function truncateTitle(title, max = MAX_TITLE_LENGTH) {
    if (typeof title !== 'string' || title.length <= max) return title;
    const room = max - ELLIPSIS.length;
    let out = '';
    for (const { segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(title)) {
        if (out.length + segment.length > room) break;
        out += segment;
    }
    return `${out.trimEnd()}${ELLIPSIS}`;
}

/** An empty `liked_by` of the same kind (list or map) as an existing comment's, else an empty list. */
const emptyLike = (sample) => (sample && typeof sample === 'object' && !Array.isArray(sample) ? {} : []);

export class ThreadTitleFix {
    /**
     * @param {import('firebase-admin').firestore.Firestore} firestore
     * @param {{ maxLength?: number, increment?: (n: number) => unknown }} [options]
     */
    constructor(firestore, { maxLength = MAX_TITLE_LENGTH, increment = (n) => admin.firestore.FieldValue.increment(n) } = {}) {
        if (!Number.isInteger(maxLength) || maxLength <= ELLIPSIS.length) throw new Error(`The title limit must be a whole number above ${ELLIPSIS.length}`);
        this.firestore = firestore;
        this.maxLength = maxLength;
        this.increment = increment;
    }

    threads(forumId) {
        return this.firestore.collection('forums').doc(forumId).collection('threads');
    }

    /** Every forum's ID (forum documents may exist only as parents of `threads`). */
    async listForums() {
        const refs = await this.firestore.collection('forums').listDocuments();
        return refs.map((ref) => ref.id);
    }

    /**
     * The threads whose titles are too long.
     *
     * @param {string[]|null} [forumIds] - only these forums (default: all)
     * @param {{ threadIds?: string[]|null, onSkip?: (where: string, reason: string) => void }} [options]
     *   `threadIds`: only these threads (looked for in each of the forums);
     *   `onSkip` hears about requested threads that aren't found or aren't too long.
     * @returns {Promise<Array<{ forumId, threadId, path, title, newTitle, comment }>>}
     *   `comment` is the first comment to add (without its ID).
     */
    async plan(forumIds = null, { threadIds = null, onSkip } = {}) {
        const forums = forumIds?.length ? forumIds : await this.listForums();
        const wanted = threadIds?.length ? [...new Set(threadIds)] : null;
        const seen = new Set();
        const found = [];
        let likedBySample;
        for (const forumId of forums) {
            const docs = wanted
                ? (await Promise.all(wanted.map((id) => this.threads(forumId).doc(id).get()))).filter((doc) => doc.exists)
                : (await this.threads(forumId).get()).docs;
            for (const doc of docs) {
                seen.add(doc.id);
                const thread = doc.data();
                if (typeof thread.title !== 'string' || thread.title.length <= this.maxLength) {
                    if (wanted) onSkip?.(`forums/${forumId}/threads/${doc.id}`, `its title is ${typeof thread.title === 'string' ? `only ${thread.title.length} characters` : 'missing'}`);
                    continue;
                }
                // Match the type an existing comment uses for liked_by (list or map).
                const existing = await this.threads(forumId).doc(doc.id).collection('comments').limit(1).get();
                const sample = existing.docs[0]?.data().liked_by;
                if (sample !== undefined) likedBySample ??= sample;
                found.push({
                    forumId,
                    threadId: doc.id,
                    path: `forums/${forumId}/threads/${doc.id}`,
                    title: thread.title,
                    newTitle: truncateTitle(thread.title, this.maxLength),
                    likedBy: sample,
                    comment: {
                        author_id: thread.author_id ?? null,
                        author_image_url: thread.author_image_url ?? null,
                        author_name: thread.author_name ?? null,
                        body: thread.title,
                        created_at: thread.created_at ?? null,
                        updated_at: thread.created_at ?? null,
                        is_deleted: false,
                        is_hidden: false,
                        parent_id: null,
                        report_count: 0,
                        thread_id: doc.id,
                    },
                });
            }
        }
        for (const id of wanted ?? []) {
            if (!seen.has(id)) onSkip?.(id, `no thread with this ID in ${forumIds?.length ? `the forum${forums.length > 1 ? 's' : ''} of ${forums.join(', ')}` : 'any forum'}`);
        }
        // liked_by: the thread's own comments' kind, else any comment seen, else a list.
        return found.map(({ likedBy, comment, ...rest }) => ({ ...rest, comment: { ...comment, liked_by: emptyLike(likedBy ?? likedBySample) } }));
    }

    /** Gives each planned thread the ID its new comment will get (call before backing up). */
    assignCommentIds(plan) {
        return plan.map((item) => ({ ...item, commentId: item.commentId ?? this.threads(item.forumId).doc(item.threadId).collection('comments').doc().id }));
    }

    /**
     * Writes the planned changes (after assignCommentIds): per thread, the new
     * first comment, the shortened title and comment_count + 1, in one batch.
     * @returns {Promise<number>} threads fixed
     */
    async apply(plan) {
        let fixed = 0;
        for (let i = 0; i < plan.length; i += THREADS_PER_BATCH) {
            const batch = this.firestore.batch();
            for (const item of plan.slice(i, i + THREADS_PER_BATCH)) {
                if (!item.commentId) throw new Error(`No comment ID for ${item.path}; call assignCommentIds first`);
                const thread = this.threads(item.forumId).doc(item.threadId);
                batch.set(thread.collection('comments').doc(item.commentId), item.comment);
                batch.update(thread, { title: item.newTitle, comment_count: this.increment(1) });
            }
            await batch.commit();
            fixed += Math.min(THREADS_PER_BATCH, plan.length - i);
        }
        return fixed;
    }

    /**
     * Undoes `apply` from its backup: puts the original titles back, deletes
     * the added comments and takes comment_count back down. Threads whose
     * title was changed since are left alone and returned in `skipped`.
     * @returns {Promise<{ restored: number, skipped: string[] }>}
     */
    async restore(items) {
        const skipped = [];
        const todo = [];
        for (const item of items) {
            const doc = await this.threads(item.forumId).doc(item.threadId).get();
            if (!doc.exists || doc.data().title !== item.newTitle) skipped.push(item.path);
            else todo.push(item);
        }
        for (let i = 0; i < todo.length; i += THREADS_PER_BATCH) {
            const batch = this.firestore.batch();
            for (const item of todo.slice(i, i + THREADS_PER_BATCH)) {
                const thread = this.threads(item.forumId).doc(item.threadId);
                batch.delete(thread.collection('comments').doc(item.commentId));
                batch.update(thread, { title: item.title, comment_count: this.increment(-1) });
            }
            await batch.commit();
        }
        return { restored: todo.length, skipped };
    }
}
