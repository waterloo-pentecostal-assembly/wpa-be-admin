import React, { useState } from 'react';
import { CheckCircle2, Loader2, AlertCircle, AlertTriangle, Copy, Check } from 'lucide-react';
import { publishState } from '../series/publishes';
import { useAuth } from '../contexts/AuthContext';

export function CopyId({ id }) {
    const [copied, setCopied] = useState(false);
    return (
        <button
            className="inline-flex items-center gap-1 rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-700 hover:bg-gray-200"
            title="Copy series ID"
            onClick={() => {
                navigator.clipboard?.writeText(id);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
            }}
        >
            {id} {copied ? <Check size={11} className="text-emerald-600" /> : <Copy size={11} />}
        </button>
    );
}

/** One publish record: status/progress, who started it and any failed entries. */
export default function PublishStatus({ publish, large = false }) {
    const [showFailed, setShowFailed] = useState(false);
    const uid = useAuth()?.currentUser?.uid;
    // `updated_by` is a Firebase Auth user ID.
    const byYou = !!publish.updated_by && publish.updated_by === uid;
    const state = publishState(publish);
    const done = (publish.written ?? 0) + (publish.failed_count ?? 0);
    const pct = publish.total ? Math.round((done / publish.total) * 100) : 0;

    const icon = {
        active: <Loader2 size={large ? 20 : 15} className="animate-spin text-brand" />,
        done: <CheckCircle2 size={large ? 20 : 15} className="text-emerald-500" />,
        partial: <AlertTriangle size={large ? 20 : 15} className="text-amber-500" />,
        failed: <AlertCircle size={large ? 20 : 15} className="text-red-500" />,
        interrupted: <AlertCircle size={large ? 20 : 15} className="text-red-500" />,
    }[state];

    const changes = `${publish.updated ?? 0} changed, ${publish.added ?? 0} added, ${publish.removed ?? 0} removed`;
    const label = publish.kind === 'update' ? {
        active: `Updating… (${changes})`,
        done: `Updated: ${changes}`,
        partial: `Updated: ${changes}`,
        failed: `Update failed${publish.error ? `: ${publish.error}` : ''}`,
        interrupted: 'Update interrupted (the server stopped). Open Publish to review and finish it.',
    }[state] : publish.kind === 'import' ? `Opened from the app (${publish.total} entries)` : {
        active: publish.status === 'starting' ? 'Creating series…' : `Writing entries… ${done} of ${publish.total}`,
        done: `Published ${publish.written} entries`,
        partial: `Published ${publish.written} of ${publish.total} entries · ${publish.failed_count} failed`,
        failed: `Failed${publish.error ? `: ${publish.error}` : ''}`,
        interrupted: `Interrupted after ${done} of ${publish.total} entries (the server stopped). Check the series in Firebase before publishing again.`,
    }[state];

    return (
        <div className={large ? 'space-y-3' : 'space-y-1.5'}>
            <div className="flex items-start gap-2">
                <span className="mt-0.5 shrink-0">{icon}</span>
                <div className="min-w-0 flex-1">
                    <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 ${large ? 'text-base font-semibold text-ink' : 'text-sm text-gray-800'}`}>
                        <span>{label}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                        <span>{new Date(publish.started_at).toLocaleString()}</span>
                        {publish.updated_by && (byYou
                            ? <span>· by you</span>
                            : <span>· by <span className="font-mono">{publish.updated_by}</span></span>)}
                    </div>
                </div>
            </div>
            {state === 'active' && publish.status === 'publishing' && !publish.kind && (
                <div className="h-1.5 overflow-hidden rounded-full bg-gray-100">
                    <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${pct}%` }} />
                </div>
            )}
            {publish.failed?.length > 0 && (
                <div className="text-xs">
                    <button className="font-semibold text-red-600 hover:underline" onClick={() => setShowFailed((s) => !s)}>
                        {showFailed ? 'Hide' : 'Show'} failed entries
                    </button>
                    {showFailed && (
                        <ul className="mt-1 space-y-0.5 text-gray-600">
                            {publish.failed.map((f) => <li key={f.index}>{f.date} · {f.content_type}: {f.error}</li>)}
                        </ul>
                    )}
                </div>
            )}
        </div>
    );
}
