import React, { useEffect, useMemo, useState } from 'react';
import { CloudUpload, Loader2, AlertCircle, AlertTriangle, ChevronDown, Copy } from 'lucide-react';
import { compileDraft, collectRefs } from '../series/compile';
import { ensureRefs, getLookup } from '../series/passageStore';
import { getCurrentEnv, publishDraft, publishSeries } from '../api/seriesBuilderApi';
import { formatShort } from '../series/dates';
import { createdSeries } from '../series/publishes';
import PublishStatus from './PublishStatus';
import { Dialog } from './ui';

function IssueList({ items, tone, dayLabel, onPick }) {
    return (
        <ul className="max-h-40 overflow-y-auto rounded-lg border border-gray-200 divide-y divide-gray-100 text-sm">
            {items.slice(0, 100).map((issue, i) => (
                <li key={i}>
                    <button className="flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-gray-50" onClick={() => onPick(issue)}>
                        {tone === 'error' ? <AlertCircle size={14} className="mt-0.5 shrink-0 text-red-500" /> : <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-500" />}
                        <span className="w-20 shrink-0 text-gray-500">{dayLabel(issue.dayId)}</span>
                        <span className="text-gray-700">{issue.message}</span>
                    </button>
                </li>
            ))}
        </ul>
    );
}

/**
 * Checks and publishes a draft. Saved drafts publish on the server, which
 * records the series ID and progress on the draft document, so this dialog
 * can be closed while entries are still being written.
 */
export default function PublishDialog({ draft, draftId, publishes, onClose, onGoToDay }) {
    const [env, setEnv] = useState(null);
    const [resolving, setResolving] = useState(true);
    const [publishId, setPublishId] = useState(null);
    const [localResult, setLocalResult] = useState(null); // browser-only drafts
    const [sending, setSending] = useState(false);
    const [error, setError] = useState(null);
    const [showJson, setShowJson] = useState(false);
    const [confirmDuplicate, setConfirmDuplicate] = useState(false);

    useEffect(() => {
        getCurrentEnv().then((r) => setEnv(r.env)).catch(() => setEnv(null));
        ensureRefs(collectRefs(draft)).finally(() => setResolving(false));
    }, [draft]);

    const compiled = useMemo(() => (resolving ? null : compileDraft(draft, getLookup())), [draft, resolving]);
    const errors = compiled?.issues.filter((i) => i.level === 'error') ?? [];
    const warnings = compiled?.issues.filter((i) => i.level === 'warning') ?? [];
    const entries = compiled?.json.series_content.length ?? 0;
    const previous = createdSeries(publishes.publishes, env);
    const bucket = /^gs:\/\/([^/]+)\//.exec(draft.meta.image_gs_location ?? '')?.[1];
    const bucketMismatch = bucket && env && ((env === 'prod') === bucket.includes('-dev'));
    const current = publishId ? publishes.publishes.find((p) => p.id === publishId) : null;
    const started = !!publishId || !!localResult;

    const publish = async () => {
        setSending(true);
        setError(null);
        try {
            if (publishes.local) {
                setLocalResult(await publishSeries(compiled.json));
            } else {
                const record = await publishDraft(draftId, compiled.json);
                setPublishId(record.id);
                publishes.refresh();
            }
        } catch (err) {
            setError(err.message);
            publishes.refresh();
        } finally {
            setSending(false);
        }
    };

    const dayLabel = (dayId) => {
        const day = draft.days.find((d) => d.id === dayId);
        return day ? formatShort(day.date) : 'Series';
    };
    const pickIssue = (issue) => {
        onGoToDay(issue.dayId);
        onClose();
    };

    const canPublish = compiled && !errors.length && entries > 0 && env && !sending && (!previous.length || confirmDuplicate);

    return (
        <Dialog
            title="Publish to Firebase"
            eyebrow={draft.meta.title || 'Untitled series'}
            onClose={sending ? () => {} : onClose}
            width="max-w-2xl"
            footer={started ? (
                <button className="btn btn-primary" onClick={onClose}>{current && current.status !== 'done' && current.status !== 'failed' ? 'Close (keeps publishing)' : 'Done'}</button>
            ) : (
                <>
                    <button className="btn btn-ghost" onClick={onClose} disabled={sending}>Cancel</button>
                    <button className={`btn ${env === 'prod' ? 'btn-dark' : 'btn-primary'}`} disabled={!canPublish} onClick={publish}>
                        {sending ? <Loader2 size={16} className="animate-spin" /> : <CloudUpload size={16} />}
                        {sending ? 'Starting…' : `Publish to ${env ?? '…'}`}
                    </button>
                </>
            )}
        >
            {started ? (
                <div className="py-2">
                    {current && <PublishStatus publish={current} large />}
                    {publishId && !current && <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 size={16} className="animate-spin" /> Starting…</p>}
                    {current && current.status !== 'done' && current.status !== 'failed' && (
                        <p className="mt-4 text-xs text-gray-500">Publishing continues on the server if you close this window. Progress and the series ID are kept in Series details.</p>
                    )}
                    {localResult && (
                        <div className="space-y-2 text-sm">
                            <p className="font-semibold text-ink">Published to {localResult.env}: {localResult.written} of {localResult.total} entries</p>
                            <p>Series ID <code className="rounded bg-gray-100 px-1">{localResult.seriesId}</code></p>
                            {localResult.failed?.length > 0 && <p className="text-red-600">{localResult.failed.length} entries failed to write.</p>}
                            <p className="alert border-amber-200 bg-amber-50 text-amber-800">This draft is only in this browser, so the ID isn’t recorded anywhere. Copy it now.</p>
                        </div>
                    )}
                </div>
            ) : resolving ? (
                <p className="flex items-center gap-2 py-8 justify-center text-sm text-gray-500"><Loader2 size={16} className="animate-spin" /> Looking up scripture…</p>
            ) : (
                <div className="space-y-4">
                    <div className="grid grid-cols-3 gap-3 text-center">
                        {[['Environment', env ?? '?'], ['Days', draft.days.length], ['Entries', entries]].map(([label, value]) => (
                            <div key={label} className={`rounded-xl border p-3 ${label === 'Environment' && env === 'prod' ? 'border-amber-300 bg-amber-50' : 'border-gray-200'}`}>
                                <div className="text-xl font-bold text-ink">{value}</div>
                                <div className="text-xs text-gray-500">{label}</div>
                            </div>
                        ))}
                    </div>

                    {errors.length > 0 && (
                        <div>
                            <p className="mb-1.5 text-sm font-semibold text-red-600">Fix {errors.length} problem{errors.length === 1 ? '' : 's'} before publishing</p>
                            <IssueList items={errors} tone="error" dayLabel={dayLabel} onPick={pickIssue} />
                        </div>
                    )}
                    {warnings.length > 0 && (
                        <div>
                            <p className="mb-1.5 text-sm font-semibold text-amber-700">{warnings.length} warning{warnings.length === 1 ? '' : 's'} (empty parts are left out)</p>
                            <IssueList items={warnings} tone="warning" dayLabel={dayLabel} onPick={pickIssue} />
                        </div>
                    )}
                    {bucketMismatch && (
                        <p className="alert border-amber-200 bg-amber-50 text-amber-800"><AlertTriangle size={16} className="shrink-0" /> The cover image is in <code>{bucket}</code>, which doesn’t look like the {env} bucket. Re-upload it in Series details after switching environment.</p>
                    )}
                    {previous.length > 0 && (
                        <label className="alert border-amber-200 bg-amber-50 text-amber-800 cursor-pointer">
                            <input type="checkbox" className="checkbox mt-0.5" checked={confirmDuplicate} onChange={(e) => setConfirmDuplicate(e.target.checked)} />
                            <span>
                                Already published to {env} {previous.length}× (last {new Date(previous.at(-1).startedAt).toLocaleString()}, ID {previous.at(-1).seriesId}).
                                Publishing again creates a <strong>second copy</strong>. Tick to continue.
                            </span>
                        </label>
                    )}
                    {publishes.local && (
                        <p className="text-xs text-gray-500">This draft is only in this browser: publishing waits until every entry is written, and the series ID isn’t recorded.</p>
                    )}
                    {error && <p className="alert alert-error"><AlertCircle size={16} className="shrink-0" /> {error}</p>}

                    <div>
                        <button className="flex items-center gap-1 text-xs font-semibold text-gray-500 hover:text-gray-800" onClick={() => setShowJson((s) => !s)}>
                            <ChevronDown size={14} className={showJson ? 'rotate-180' : ''} /> View JSON
                        </button>
                        {showJson && (
                            <div className="relative mt-2">
                                <button
                                    className="btn btn-secondary btn-sm absolute right-2 top-2"
                                    onClick={() => navigator.clipboard?.writeText(JSON.stringify(compiled.json, null, 4))}
                                >
                                    <Copy size={12} /> Copy
                                </button>
                                <pre className="max-h-64 overflow-auto rounded-lg bg-gray-900 p-3 text-[11px] text-gray-100">{JSON.stringify(compiled.json, null, 2).slice(0, 200000)}</pre>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </Dialog>
    );
}
