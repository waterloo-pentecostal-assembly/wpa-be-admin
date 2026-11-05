// Creating and deleting drafts, remotely when draft storage is available
// and in the browser otherwise.
import { createDraftRemote, deleteDraftRemote } from '../api/seriesBuilderApi';
import { newId } from '../series/draftModel';
import { LOCAL_ID_PREFIX, isLocalId, removeLocal, writeLocal } from '../series/localDrafts';

export async function storeNewDraft(draft, remoteAvailable) {
    if (remoteAvailable) {
        const { id, rev, updatedAt } = await createDraftRemote(draft);
        writeLocal(id, { draft, baseRev: rev, dirty: false, savedAt: updatedAt });
        return id;
    }
    const id = `${LOCAL_ID_PREFIX}${newId('d').slice(2)}`;
    if (!writeLocal(id, { draft, baseRev: 0, dirty: false, savedAt: Date.now() })) {
        throw new Error('Could not save the draft in this browser (storage full or disabled).');
    }
    return id;
}

export async function deleteDraft(id) {
    if (!isLocalId(id)) await deleteDraftRemote(id);
    removeLocal(id);
}
