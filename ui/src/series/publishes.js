// Helpers for publish records (server-written, see src/services/publishService.js):
// { id, env, title, status: 'starting'|'publishing'|'done'|'failed', seriesId,
//   total, written, failedCount, failed: [{ index, date, content_type, error }],
//   error?, startedAt, updatedAt, finishedAt }

// The server updates an active record every few entries (~10 s); no update
// for this long means the server stopped (restart/redeploy) mid-publish.
export const STALE_AFTER_MS = 2 * 60 * 1000;

/** @returns {'active'|'done'|'partial'|'failed'|'interrupted'} */
export function publishState(publish, now = Date.now()) {
    if (publish.status === 'starting' || publish.status === 'publishing') {
        return now - (publish.updatedAt ?? publish.startedAt ?? now) > STALE_AFTER_MS ? 'interrupted' : 'active';
    }
    if (publish.status === 'failed') return 'failed';
    return publish.failedCount > 0 ? 'partial' : 'done';
}

export function isActive(publish, now) {
    return publishState(publish, now) === 'active';
}

/** Publishes that created a series in the app (whatever happened after). */
export function createdSeries(publishes, env) {
    return publishes.filter((p) => p.seriesId && (!env || p.env === env));
}
