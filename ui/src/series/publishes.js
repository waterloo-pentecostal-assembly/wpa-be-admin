// Helpers for publish records (server-written, see src/services/publishService.js):
// { id, kind?: 'import'|'update', title, status: 'starting'|'publishing'|'done'|'failed',
//   total, written, failed_count, failed: [{ index, date, content_type, error }],
//   updated?, added?, removed?, updated_by, error?, started_at, updated_at, finished_at }
// Records without a kind are publishes; 'import' links a draft opened from a
// published series; 'update' edits the linked series. The linked series ID is
// on the draft, not the records (older records also carry env and series_id).

// The server updates an active record every few entries (~10 s); no update
// for this long means the server stopped (restart/redeploy) mid-publish.
export const STALE_AFTER_MS = 2 * 60 * 1000;

/** @returns {'active'|'done'|'partial'|'failed'|'interrupted'} */
export function publishState(publish, now = Date.now()) {
    if (publish.status === 'starting' || publish.status === 'publishing') {
        return now - (publish.updated_at ?? publish.started_at ?? now) > STALE_AFTER_MS ? 'interrupted' : 'active';
    }
    if (publish.status === 'failed') return 'failed';
    return publish.failed_count > 0 ? 'partial' : 'done';
}

export function isActive(publish, now) {
    return publishState(publish, now) === 'active';
}
