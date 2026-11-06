// Browser-side draft storage: a crash/offline backup for every draft and
// the only storage for "local" drafts when the server has no Firebase
// credentials. Entries: { draft, baseRev, dirty, savedAt, title }.

const PREFIX = 'seriesBuilder:draft:';
export const LOCAL_ID_PREFIX = 'local_';

export const isLocalId = (id) => id?.startsWith(LOCAL_ID_PREFIX);

export function readLocal(id) {
    try {
        const raw = localStorage.getItem(PREFIX + id);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

export function writeLocal(id, entry) {
    try {
        localStorage.setItem(PREFIX + id, JSON.stringify({ ...entry, title: entry.draft?.meta?.title ?? '' }));
        return true;
    } catch {
        // Quota exceeded or storage disabled; the server copy still exists.
        return false;
    }
}

export function removeLocal(id) {
    try {
        localStorage.removeItem(PREFIX + id);
    } catch {
        // ignore
    }
}

/** Local-only drafts, newest first, shaped like the server draft list. */
export function listLocalOnly() {
    const items = [];
    try {
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!key?.startsWith(PREFIX + LOCAL_ID_PREFIX)) continue;
            const id = key.slice(PREFIX.length);
            const entry = readLocal(id);
            if (!entry?.draft) continue;
            const days = entry.draft.days ?? [];
            items.push({
                id,
                title: entry.draft.meta?.title ?? '',
                dayCount: days.length,
                startDate: days[0]?.date ?? '',
                endDate: days.at(-1)?.date ?? '',
                seriesId: null,
                updatedAt: entry.savedAt,
                local: true,
            });
        }
    } catch {
        // ignore
    }
    return items.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}
