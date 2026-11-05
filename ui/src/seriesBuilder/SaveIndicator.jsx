import React from 'react';
import { Check, Loader2, CloudOff, AlertCircle, HardDrive } from 'lucide-react';

export default function SaveIndicator({ doc }) {
    const { saveState, saveError, lastSavedAt, saveNow, overwriteRemote, reloadRemote } = doc;
    const when = lastSavedAt ? new Date(lastSavedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
    switch (saveState) {
        case 'saved':
            return <span className="flex items-center gap-1 text-xs text-gray-500" title={when && `Last saved ${when}`}><Check size={14} className="text-emerald-500" /> Saved</span>;
        case 'pending':
        case 'saving':
            return <span className="flex items-center gap-1 text-xs text-gray-500"><Loader2 size={14} className="animate-spin" /> Saving…</span>;
        case 'local':
            return <span className="flex items-center gap-1 text-xs text-amber-700" title="Server draft storage is unavailable"><HardDrive size={14} /> Saved in this browser</span>;
        case 'offline':
            return (
                <span className="flex items-center gap-1 text-xs text-amber-700" title={saveError ?? ''}>
                    <CloudOff size={14} /> Offline. Kept in this browser, retrying…
                    <button className="font-semibold underline" onClick={() => saveNow()}>Retry</button>
                </span>
            );
        case 'conflict':
            return (
                <span className="flex items-center gap-2 rounded-full bg-red-50 px-3 py-1 text-xs text-red-700">
                    <AlertCircle size={14} /> Changed in another window
                    <button className="font-semibold underline" onClick={reloadRemote}>Load theirs</button>
                    <button className="font-semibold underline" onClick={overwriteRemote}>Keep mine</button>
                </span>
            );
        case 'error':
            return (
                <span className="flex items-center gap-1 text-xs text-red-600" title={saveError ?? ''}>
                    <AlertCircle size={14} /> Save failed: {saveError}
                    <button className="font-semibold underline" onClick={() => saveNow({ force: false })}>Retry</button>
                </span>
            );
        default:
            return null;
    }
}
