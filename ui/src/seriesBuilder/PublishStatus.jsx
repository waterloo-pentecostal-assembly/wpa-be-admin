import React, { useState } from 'react';
import { CheckCircle2, Loader2, AlertCircle, AlertTriangle, Copy, Check } from 'lucide-react';
import { publishState } from '../series/publishes';

function CopyId({ id }) {
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

/** One publish record: environment, status/progress, series ID and any failed entries. */
export default function PublishStatus({ publish, large = false }) {
    const [showFailed, setShowFailed] = useState(false);
    const state = publishState(publish);
    const done = (publish.written ?? 0) + (publish.failedCount ?? 0);
    const pct = publish.total ? Math.round((done / publish.total) * 100) : 0;

    const icon = {
        active: <Loader2 size={large ? 20 : 15} className="animate-spin text-brand" />,
        done: <CheckCircle2 size={large ? 20 : 15} className="text-emerald-500" />,
        partial: <AlertTriangle size={large ? 20 : 15} className="text-amber-500" />,
        failed: <AlertCircle size={large ? 20 : 15} className="text-red-500" />,
        interrupted: <AlertCircle size={large ? 20 : 15} className="text-red-500" />,
    }[state];

    const label = {
        active: publish.status === 'starting' ? 'Creating series…' : `Writing entries… ${done} of ${publish.total}`,
        done: `Published ${publish.written} entries`,
        partial: `Published ${publish.written} of ${publish.total} entries · ${publish.failedCount} failed`,
        failed: `Failed${publish.error ? `: ${publish.error}` : ''}`,
        interrupted: `Interrupted after ${done} of ${publish.total} entries (the server stopped). Check the series in Firebase before publishing again.`,
    }[state];

    return (
        <div className={large ? 'space-y-3' : 'space-y-1.5'}>
            <div className="flex items-start gap-2">
                <span className="mt-0.5 shrink-0">{icon}</span>
                <div className="min-w-0 flex-1">
                    <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 ${large ? 'text-base font-semibold text-ink' : 'text-sm text-gray-800'}`}>
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${publish.env === 'prod' ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-600'}`}>{publish.env}</span>
                        <span>{label}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                        <span>{new Date(publish.startedAt).toLocaleString()}</span>
                        {publish.seriesId && <>· Series ID <CopyId id={publish.seriesId} /></>}
                    </div>
                </div>
            </div>
            {state === 'active' && publish.status === 'publishing' && (
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
