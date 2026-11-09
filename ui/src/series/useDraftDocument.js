// Loads one draft and keeps it saved while the user edits:
//  - every change is mirrored to localStorage immediately (crash safety)
//  - changes are saved to the server after a short pause (debounced), with
//    optimistic concurrency so two windows cannot overwrite each other
//  - failed saves retry with backoff and the UI shows the current state
//  - undo/redo history, with rapid edits to one field coalesced

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, getDraft, saveDraftRemote } from '../api/seriesBuilderApi';
import { isLocalId, readLocal, writeLocal } from './localDrafts';
import { migrateDraft } from './draftModel';

const SAVE_DELAY_MS = 1000;
const MAX_SAVE_DELAY_MS = 5000;
const RETRY_DELAYS_MS = [3000, 10000, 30000];
const HISTORY_LIMIT = 100;
const COALESCE_MS = 1500;

/**
 * saveState: 'saved' | 'pending' | 'saving' | 'offline' | 'conflict' | 'error' | 'local'
 */
export function useDraftDocument(draftId) {
    const [loadState, setLoadState] = useState({ status: 'loading', error: null });
    const [draft, setDraft] = useState(null);
    const [saveState, setSaveState] = useState('saved');
    const [saveError, setSaveError] = useState(null);
    const [lastSavedAt, setLastSavedAt] = useState(null);
    const [recovery, setRecovery] = useState(null); // { draft, savedAt } offered after load
    const [historySizes, setHistorySizes] = useState({ past: 0, future: 0 });

    const draftRef = useRef(null);
    const revRef = useRef(0);
    const dirtyRef = useRef(false);
    const savingRef = useRef(false);
    const timerRef = useRef(null);
    const firstPendingAtRef = useRef(null);
    const retryRef = useRef(0);
    const coalesceRef = useRef({ key: null, at: 0 });
    const conflictRef = useRef(false);
    const historyRef = useRef({ past: [], future: [] });

    const setHistory = (next) => {
        historyRef.current = next;
        setHistorySizes({ past: next.past.length, future: next.future.length });
    };
    const local = isLocalId(draftId);

    // ---------- Load ----------
    useEffect(() => {
        let ignore = false;
        setLoadState({ status: 'loading', error: null });
        setRecovery(null);
        setHistory({ past: [], future: [] });

        (async () => {
            const backup = readLocal(draftId);
            if (local) {
                if (!backup?.draft) throw new Error('This browser-only draft no longer exists.');
                return { draft: backup.draft, rev: 0, updatedAt: backup.savedAt };
            }
            try {
                const remote = await getDraft(draftId);
                if (backup?.dirty && backup.draft) {
                    if (backup.baseRev === remote.rev) {
                        // Unsaved edits made on top of the latest server copy: keep them.
                        return { ...remote, draft: backup.draft, resumeDirty: true };
                    }
                    if ((backup.savedAt ?? 0) > (remote.updatedAt ?? 0)) {
                        return { ...remote, offerRecovery: backup };
                    }
                }
                return remote;
            } catch (error) {
                // Server unreachable but we have a copy: work from it and sync later.
                if (error instanceof ApiError && error.status === 0 && backup?.draft) {
                    return { draft: backup.draft, rev: backup.baseRev, updatedAt: backup.savedAt, resumeDirty: true };
                }
                throw error;
            }
        })()
            .then((loaded) => {
                if (ignore) return;
                const result = {
                    ...loaded,
                    draft: migrateDraft(loaded.draft),
                    offerRecovery: loaded.offerRecovery && { ...loaded.offerRecovery, draft: migrateDraft(loaded.offerRecovery.draft) },
                };
                draftRef.current = result.draft;
                revRef.current = result.rev;
                setDraft(result.draft);
                setLastSavedAt(result.updatedAt ?? null);
                if (result.offerRecovery) setRecovery({ draft: result.offerRecovery.draft, savedAt: result.offerRecovery.savedAt });
                setLoadState({ status: 'ready', error: null });
                if (local) {
                    setSaveState('local');
                } else if (result.resumeDirty) {
                    dirtyRef.current = true;
                    setSaveState('pending');
                    scheduleSave(0);
                } else {
                    setSaveState('saved');
                    writeLocal(draftId, { draft: result.draft, baseRev: result.rev, dirty: false, savedAt: result.updatedAt });
                }
            })
            .catch((error) => {
                if (!ignore) setLoadState({ status: 'error', error: error.message });
            });

        return () => {
            ignore = true;
            clearTimeout(timerRef.current);
        };
        // scheduleSave is stable (refs only)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [draftId]);

    // ---------- Save ----------
    const saveNow = useCallback(async ({ force = false } = {}) => {
        clearTimeout(timerRef.current);
        timerRef.current = null;
        if (local || savingRef.current || (!dirtyRef.current && !force)) return;
        // After a conflict only an explicit choice (overwrite / reload) saves again.
        if (conflictRef.current && !force) return;
        savingRef.current = true;
        dirtyRef.current = false;
        firstPendingAtRef.current = null;
        const snapshot = draftRef.current;
        setSaveState('saving');
        try {
            const result = await saveDraftRemote(draftId, snapshot, revRef.current, force);
            revRef.current = result.rev;
            retryRef.current = 0;
            conflictRef.current = false;
            setLastSavedAt(result.updatedAt);
            setSaveError(null);
            writeLocal(draftId, { draft: draftRef.current, baseRev: result.rev, dirty: dirtyRef.current, savedAt: Date.now() });
            setSaveState(dirtyRef.current ? 'pending' : 'saved');
        } catch (error) {
            dirtyRef.current = true;
            setSaveError(error.message);
            if (error instanceof ApiError && error.status === 409) {
                conflictRef.current = true;
                setSaveState('conflict');
            } else if (error instanceof ApiError && (error.status === 0 || error.status >= 500)) {
                setSaveState('offline');
                const delay = RETRY_DELAYS_MS[Math.min(retryRef.current, RETRY_DELAYS_MS.length - 1)];
                retryRef.current++;
                timerRef.current = setTimeout(() => saveNowRef.current(), delay);
            } else {
                setSaveState('error');
            }
        } finally {
            savingRef.current = false;
        }
        if (dirtyRef.current && !timerRef.current) scheduleSave();
        // scheduleSave is stable
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [draftId, local]);

    const saveNowRef = useRef(saveNow);
    useEffect(() => {
        saveNowRef.current = saveNow;
    }, [saveNow]);

    function scheduleSave(delay = SAVE_DELAY_MS) {
        clearTimeout(timerRef.current);
        const now = Date.now();
        firstPendingAtRef.current ??= now;
        // Keep typing from postponing the save forever.
        const wait = Math.min(delay, Math.max(0, firstPendingAtRef.current + MAX_SAVE_DELAY_MS - now));
        timerRef.current = setTimeout(() => {
            timerRef.current = null;
            if (savingRef.current) {
                scheduleSave();
            } else {
                saveNowRef.current();
            }
        }, wait);
    }

    // ---------- Editing ----------
    const commit = useCallback((next) => {
        draftRef.current = next;
        setDraft(next);
        if (local) {
            writeLocal(draftId, { draft: next, baseRev: 0, dirty: false, savedAt: Date.now() });
            setLastSavedAt(Date.now());
            return;
        }
        dirtyRef.current = true;
        writeLocal(draftId, { draft: next, baseRev: revRef.current, dirty: true, savedAt: Date.now() });
        setSaveState((s) => (s === 'conflict' || s === 'error' ? s : s === 'offline' ? 'offline' : 'pending'));
        scheduleSave();
        // scheduleSave is stable
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [draftId, local]);

    /**
     * Applies `fn(draft) => draft`. Pass `coalesce` (e.g. a field id) so a
     * burst of keystrokes in one field becomes a single undo step.
     */
    const update = useCallback((fn, { coalesce = null } = {}) => {
        const prev = draftRef.current;
        if (!prev) return;
        const next = fn(prev);
        if (next === prev) return;
        const now = Date.now();
        const sameBurst = coalesce && coalesceRef.current.key === coalesce && now - coalesceRef.current.at < COALESCE_MS;
        coalesceRef.current = { key: coalesce, at: now };
        if (!sameBurst) {
            const h = historyRef.current;
            setHistory({ past: [...h.past, prev].slice(-HISTORY_LIMIT), future: [] });
        }
        commit(next);
    }, [commit]);

    const undo = useCallback(() => {
        const h = historyRef.current;
        if (!h.past.length) return;
        setHistory({ past: h.past.slice(0, -1), future: [draftRef.current, ...h.future] });
        coalesceRef.current = { key: null, at: 0 };
        commit(h.past.at(-1));
    }, [commit]);

    const redo = useCallback(() => {
        const h = historyRef.current;
        if (!h.future.length) return;
        const [next, ...rest] = h.future;
        setHistory({ past: [...h.past, draftRef.current], future: rest });
        commit(next);
    }, [commit]);

    // ---------- Conflict / recovery resolution ----------
    const overwriteRemote = useCallback(() => saveNow({ force: true }), [saveNow]);

    const reloadRemote = useCallback(async () => {
        const loaded = await getDraft(draftId);
        const remote = { ...loaded, draft: migrateDraft(loaded.draft) };
        draftRef.current = remote.draft;
        revRef.current = remote.rev;
        dirtyRef.current = false;
        conflictRef.current = false;
        setDraft(remote.draft);
        setHistory({ past: [], future: [] });
        setLastSavedAt(remote.updatedAt);
        setSaveState('saved');
        setSaveError(null);
        writeLocal(draftId, { draft: remote.draft, baseRev: remote.rev, dirty: false, savedAt: remote.updatedAt });
    }, [draftId]);

    const acceptRecovery = useCallback(() => {
        if (!recovery) return;
        update(() => recovery.draft);
        setRecovery(null);
    }, [recovery, update]);

    const dismissRecovery = useCallback(() => {
        setRecovery(null);
        writeLocal(draftId, { draft: draftRef.current, baseRev: revRef.current, dirty: false, savedAt: Date.now() });
    }, [draftId]);

    // Warn before closing the tab while a save is outstanding.
    useEffect(() => {
        const onBeforeUnload = (e) => {
            if (dirtyRef.current || savingRef.current) {
                e.preventDefault();
                e.returnValue = '';
            }
        };
        window.addEventListener('beforeunload', onBeforeUnload);
        return () => window.removeEventListener('beforeunload', onBeforeUnload);
    }, []);

    // Flush on unmount (e.g. navigating back to the library).
    useEffect(() => () => {
        if (dirtyRef.current && !local) saveNowRef.current();
    }, [local]);

    return {
        loadState,
        draft,
        update,
        undo,
        redo,
        canUndo: historySizes.past > 0,
        canRedo: historySizes.future > 0,
        saveState,
        saveError,
        lastSavedAt,
        saveNow,
        overwriteRemote,
        reloadRemote,
        recovery,
        acceptRecovery,
        dismissRecovery,
    };
}
