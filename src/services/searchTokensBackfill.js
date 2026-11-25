// Fills `search_tokens` on existing users and challenge_groups documents
// (see src/services/searchTokens.js). Writes only that field, with `update`
// (never recreating a deleted document), and only where the tokens differ,
// so running it twice writes nothing the second time. Each write has a
// lastUpdateTime precondition: a document changed since it was read is left
// for the backend trigger, which recomputes from the latest data.

import { SEARCHABLE_COLLECTIONS, SEARCH_TOKENS_FIELD, tokensUpdate } from './searchTokens.js';

const NOT_FOUND = 5;
const FAILED_PRECONDITION = 9;

/**
 * @param {import('firebase-admin').firestore.Firestore} firestore
 * @param {object} [options]
 * @param {string[]} [options.collections] - default: users and challenge_groups
 * @param {boolean} [options.dryRun] - report what would change; write nothing
 * @param {(line: string) => void} [options.log] - per-document lines when `verbose`
 * @param {boolean} [options.verbose]
 * @returns {Promise<Record<string, { scanned: number, updated: number, unchanged: number,
 *   changedSince: number, failed: number, errors: string[] }>>}
 *   `updated` counts writes made (in a dry run: writes that would be made);
 *   `changedSince`: documents edited or deleted between the read and the write (skipped).
 */
export async function backfillSearchTokens(firestore, {
    collections = Object.keys(SEARCHABLE_COLLECTIONS), dryRun = false, log = () => {}, verbose = false,
} = {}) {
    const summary = {};
    for (const name of collections) {
        const config = SEARCHABLE_COLLECTIONS[name];
        if (!config) throw new Error(`Not a collection with search tokens: ${name} (use ${Object.keys(SEARCHABLE_COLLECTIONS).join(' or ')})`);
        const collection = firestore.collection(name);
        const snapshot = await collection.select(...config.fields, SEARCH_TOKENS_FIELD).get();
        const result = { scanned: snapshot.docs.length, updated: 0, unchanged: 0, changedSince: 0, failed: 0, errors: [] };
        const writer = dryRun ? null : firestore.bulkWriter();
        const writes = [];
        for (const doc of snapshot.docs) {
            const data = doc.data();
            const tokens = tokensUpdate(data, config.toText);
            if (!tokens) {
                result.unchanged++;
                continue;
            }
            if (verbose) log(`  ${name}/${doc.id}: "${config.toText(data).trim()}" -> ${tokens.length} tokens${Array.isArray(data[SEARCH_TOKENS_FIELD]) ? ' (replacing stale tokens)' : ''}`);
            if (dryRun) {
                result.updated++;
                continue;
            }
            const precondition = doc.updateTime ? [{ lastUpdateTime: doc.updateTime }] : [];
            writes.push(writer.update(collection.doc(doc.id), { [SEARCH_TOKENS_FIELD]: tokens }, ...precondition)
                .then(() => { result.updated++; })
                .catch((error) => {
                    if (error.code === NOT_FOUND || error.code === FAILED_PRECONDITION) {
                        result.changedSince++;
                        return;
                    }
                    result.failed++;
                    result.errors.push(`${name}/${doc.id}: ${error.message}`);
                }));
        }
        if (writer) await writer.close();
        await Promise.all(writes);
        summary[name] = result;
    }
    return summary;
}
