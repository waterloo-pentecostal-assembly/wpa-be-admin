// Shared cache of resolved scripture references, per translation. References
// are split into single-book parts (see splitReference) and resolved in
// batches through POST /api/bible/:bibleId/passages; components subscribe and
// re-render when new results arrive.

//
// `bibleId` is the series' API.Bible translation, or 'default' for the
// server's default (see useBibleId).

import { createContext, createElement, useContext, useEffect, useMemo, useSyncExternalStore } from 'react';
import { resolvePassages } from '../api/seriesBuilderApi';
import { createLookup } from './compile';
import { splitReference } from './scriptureRefs';

export const DEFAULT_BIBLE = 'default';

const stores = new Map(); // bibleId -> { results: Map<ref, result>, inFlight: Map<ref, Promise> }
const listeners = new Set();
let version = 0;

function storeFor(bibleId) {
    const key = bibleId || DEFAULT_BIBLE;
    if (!stores.has(key)) stores.set(key, { results: new Map(), inFlight: new Map() });
    return stores.get(key);
}

function emit() {
    version++;
    for (const l of listeners) l();
}

function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

const getVersion = () => version;

const BATCH_SIZE = 200;
// After a failed request (rate limit, scripture unavailable, network), wait
// this long (or the server's Retry-After) before asking again, and retry on
// our own at most this many times; asking on every render would only keep the
// rate limit tripped.
const DEFAULT_RETRY_AFTER_S = 15;
const MAX_AUTO_RETRIES = 3;

const retryable = (result, now) => result.transient && now >= (result.retryAt ?? 0);

/**
 * Resolves any references not yet cached for the translation. Failed
 * requests are recorded as errors and asked again once their retry time
 * (the server's Retry-After) has passed.
 */
export async function ensureRefs(refs, bibleId = DEFAULT_BIBLE, { autoRetry = 0 } = {}) {
    const { results, inFlight } = storeFor(bibleId);
    const singles = [...new Set(refs.flatMap(splitReference))];
    const now = Date.now();
    const missing = singles.filter((r) => (!results.has(r) || retryable(results.get(r), now)) && !inFlight.has(r));
    for (let i = 0; i < missing.length; i += BATCH_SIZE) {
        const batch = missing.slice(i, i + BATCH_SIZE);
        const promise = resolvePassages(batch, bibleId || DEFAULT_BIBLE)
            .then(({ results: batchResults }) => {
                for (const ref of batch) {
                    results.set(ref, batchResults[ref] ?? { ok: false, error: `Could not resolve "${ref}"` });
                }
            })
            .catch((error) => {
                const wait = error.retryAfter ?? DEFAULT_RETRY_AFTER_S;
                const retryAt = Date.now() + wait * 1000;
                for (const ref of batch) results.set(ref, { ok: false, error: `Scripture lookup failed: ${error.message}`, transient: true, retryAt });
                if (autoRetry < MAX_AUTO_RETRIES) {
                    setTimeout(() => ensureRefs(batch, bibleId, { autoRetry: autoRetry + 1 }).catch(() => {}), wait * 1000);
                }
            })
            .finally(() => {
                for (const ref of batch) inFlight.delete(ref);
                emit();
            });
        for (const ref of batch) inFlight.set(ref, promise);
    }
    await Promise.allSettled(singles.map((r) => inFlight.get(r)).filter(Boolean));
}

export function getLookup(bibleId = DEFAULT_BIBLE) {
    return createLookup(storeFor(bibleId).results);
}

/** Resolves a single reference, e.g. to validate typed input. */
export async function resolveOne(ref, bibleId = DEFAULT_BIBLE) {
    await ensureRefs([ref], bibleId);
    return getLookup(bibleId)(ref);
}

/**
 * Returns a lookup(ref) for the given references, resolving them in the
 * background. The lookup returns null for references still loading.
 */
export function useScriptureLookup(refs, bibleId = DEFAULT_BIBLE) {
    const v = useSyncExternalStore(subscribe, getVersion);
    const key = refs.join('\n');
    useEffect(() => {
        if (key) ensureRefs(key.split('\n'), bibleId).catch(() => {});
    }, [key, bibleId]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return useMemo(() => getLookup(bibleId), [v, bibleId]);
}

// The translation of the series being edited, for scripture inputs deep in
// the workspace (provided by SeriesWorkspace from draft.meta.bible_id).
const BibleContext = createContext(DEFAULT_BIBLE);

export function BibleProvider({ bibleId, children }) {
    return createElement(BibleContext.Provider, { value: bibleId || DEFAULT_BIBLE }, children);
}

/** The current series' translation ID, or 'default'. */
export function useBibleId() {
    return useContext(BibleContext);
}

/** The translation ID for a draft ('default' when it hasn't picked one). */
export function bibleIdOf(draft) {
    return draft?.meta?.bible_id || DEFAULT_BIBLE;
}
