// Shared cache of resolved scripture references. References are split into
// single-book parts (see splitReference) and resolved in batches through
// POST /api/bible/niv/passages; components subscribe and re-render when
// new results arrive.

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { resolvePassages } from '../api/seriesBuilderApi';
import { createLookup } from './compile';
import { splitReference } from './scriptureRefs';

const results = new Map(); // single ref -> { ok, passage } | { ok: false, error }
const inFlight = new Map(); // single ref -> Promise
const listeners = new Set();
let version = 0;

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

/** Resolves any references not yet cached. Network failures are retried on the next call. */
export async function ensureRefs(refs) {
    const singles = [...new Set(refs.flatMap(splitReference))];
    const missing = singles.filter((r) => !results.has(r) && !inFlight.has(r));
    for (let i = 0; i < missing.length; i += BATCH_SIZE) {
        const batch = missing.slice(i, i + BATCH_SIZE);
        const promise = resolvePassages(batch)
            .then(({ results: batchResults }) => {
                for (const ref of batch) {
                    results.set(ref, batchResults[ref] ?? { ok: false, error: `Could not resolve "${ref}"` });
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

export function getLookup() {
    return createLookup(results);
}

/** Resolves a single reference, e.g. to validate typed input. */
export async function resolveOne(ref) {
    await ensureRefs([ref]);
    return getLookup()(ref);
}

/**
 * Returns a lookup(ref) for the given references, resolving them in the
 * background. The lookup returns null for references still loading.
 */
export function useScriptureLookup(refs) {
    const v = useSyncExternalStore(subscribe, getVersion);
    const key = refs.join('\n');
    useEffect(() => {
        if (key) ensureRefs(key.split('\n')).catch(() => {});
    }, [key]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return useMemo(() => getLookup(), [v]);
}
