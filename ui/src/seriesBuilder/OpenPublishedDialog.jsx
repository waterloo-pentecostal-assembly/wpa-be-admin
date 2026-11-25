import React, { useEffect, useState } from 'react';
import { BookOpen, Loader2, AlertCircle, Search, Download, Copy, CheckCircle2 } from 'lucide-react';
import { copySeriesToEnv, getPublishedSeries, listPublishedSeries } from '../api/seriesBuilderApi';
import ConfirmModal from '../components/ConfirmModal';
import { formatShort } from '../series/dates';
import { Dialog } from './ui';
import { FlagBadges, SeriesFlagSwitches } from './SeriesFlags';

/**
 * Lists the series in the app (selected environment) and opens one as a new
 * draft linked to it, so it can be corrected and updated from the builder.
 * A series that already has a draft opens that draft instead. "Fetch all"
 * adds a draft for every series that doesn't have one yet.
 *
 * Each series also has its Active / Visible switches (see SeriesFlags.jsx),
 * and in prod a "Copy to dev" button that copies it to dev for testing.
 *
 * @param {Map<string, string>} linkedDrafts  series ID -> draft ID (drafts and series of the selected environment)
 * @param {(series: object[], onProgress: (index: number) => void) => Promise<void>} onFetchAll
 * @param {{ env, series, error }|null} [published]  the series list, when the caller has loaded it (kept up to date as flags change)
 * @param {ReturnType<typeof import('./useSeriesFlags').default>} [flags]  shows the switches when given
 */
export default function OpenPublishedDialog({ linkedDrafts, onOpen, onOpenDraft, onFetchAll, onClose, published = null, flags = null }) {
    const [loaded, setLoaded] = useState(null); // { env, series }
    const list = published ?? loaded;
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(null);
    const [query, setQuery] = useState('');
    const [fetching, setFetching] = useState(null); // { index, total } while fetching all
    const [copying, setCopying] = useState(null); // series ID
    const [copyNote, setCopyNote] = useState(null);
    const [replaceCopy, setReplaceCopy] = useState(null); // { series, title, is_active }
    const [confirmCopy, setConfirmCopy] = useState(null); // series

    useEffect(() => {
        if (published) return;
        listPublishedSeries().then(setLoaded).catch((e) => {
            setLoaded({ env: null, series: [] });
            setError(e.message);
        });
    }, [published]);
    const listError = error ?? published?.error ?? flags?.error ?? null;

    const open = async (series) => {
        setBusy(series.id);
        setError(null);
        try {
            const json = await getPublishedSeries(series.id);
            await onOpen(json);
        } catch (e) {
            setError(e.message);
            setBusy(null);
        }
    };

    // A copy in dev for testing: same ID, same content, inactive.
    const copyToDev = async (series, replace = false) => {
        setCopying(series.id);
        setError(null);
        setCopyNote(null);
        try {
            const r = await copySeriesToEnv(series.id, 'dev', replace);
            const parts = [`${r.entries} entries`];
            if (r.removed) parts.push(`${r.removed} old dev entries removed`);
            if (r.image.copied) parts.push('cover image copied');
            setCopyNote({
                text: `“${r.title || 'Untitled series'}” ${r.replaced ? 'replaced the copy in dev' : 'was copied to dev'} (${parts.join(', ')}). It’s inactive there; switch to dev to see it.`,
                warning: r.image.warning,
            });
        } catch (e) {
            if (e.status === 409 && e.body) setReplaceCopy({ series, title: e.body.title, is_active: e.body.is_active });
            else setError(`Could not copy to dev: ${e.message}`);
        } finally {
            setCopying(null);
        }
    };

    const missing = list?.series.filter((s) => !linkedDrafts.has(s.id)) ?? [];
    const fetchAll = async () => {
        setError(null);
        setFetching({ index: 0, total: missing.length });
        try {
            await onFetchAll(missing, (index) => setFetching({ index, total: missing.length }));
        } catch (e) {
            setError(e.message);
            setFetching(null);
        }
    };
    const working = !!busy || !!fetching || !!copying;
    const canCopy = list?.env === 'prod';

    const q = query.trim().toLowerCase();
    const shown = list?.series.filter((s) => !q || s.title.toLowerCase().includes(q) || s.id.toLowerCase().includes(q)) ?? [];

    return (
            <Dialog title="Open a published series" eyebrow={list?.env ? `Series in ${list.env}` : 'Published series'} onClose={working ? () => {} : onClose} width="max-w-xl">
                <p className="mb-4 text-sm text-gray-500">
                    The series is copied into a new draft that stays linked to it. Edit the draft, then use <strong>Update</strong> to review and apply the changes to the app.
                    {canCopy && <> <strong>Copy to dev</strong> puts a copy of a series in dev for testing.</>}
                </p>
                <div className="mb-3 flex items-center gap-2">
                    <div className="relative flex-1">
                        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input className="input pl-9" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by title or ID" autoFocus />
                    </div>
                    {missing.length > 0 && (
                        <button
                            className="btn btn-secondary shrink-0"
                            onClick={fetchAll}
                            disabled={working}
                            title="Import every series that hasn’t been imported yet"
                        >
                            {fetching
                                ? <><Loader2 size={16} className="animate-spin" /> Fetching {fetching.index + 1} of {fetching.total}…</>
                                : <><Download size={16} /> Fetch all new ({missing.length})</>}
                        </button>
                    )}
                </div>
                {copyNote && (
                    <div className="alert alert-success mb-3">
                        <CheckCircle2 size={16} className="shrink-0 mt-0.5" />
                        <span>{copyNote.text}{copyNote.warning && <span className="block text-amber-700">{copyNote.warning}.</span>}</span>
                    </div>
                )}
                {listError && <p className="alert alert-error mb-3"><AlertCircle size={16} className="shrink-0" /> {listError}</p>}
                <div className="max-h-96 overflow-y-auto rounded-lg border border-gray-200 divide-y divide-gray-100">
                    {list === null && <p className="flex items-center gap-2 p-4 text-sm text-gray-400"><Loader2 size={15} className="animate-spin" /> Loading…</p>}
                    {shown.map((s) => {
                        const draftId = linkedDrafts.get(s.id);
                        return (
                        <div
                            key={s.id}
                            role="button"
                            tabIndex={working ? -1 : 0}
                            aria-disabled={working}
                            onClick={() => !working && (draftId ? onOpenDraft(draftId) : open(s))}
                            onKeyDown={(e) => e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ') && !working && (e.preventDefault(), draftId ? onOpenDraft(draftId) : open(s))}
                            title={draftId ? 'Already imported: opens it in the builder' : undefined}
                            className={`flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-gray-50 ${working ? 'cursor-default opacity-50' : 'cursor-pointer'}`}
                        >
                            {busy === s.id ? <Loader2 size={16} className="mt-0.5 animate-spin text-brand" /> : <BookOpen size={16} className="mt-0.5 text-gray-400" />}
                            <span className="min-w-0 flex-1">
                                <span className="flex items-center gap-2">
                                    <span className="truncate text-sm font-semibold text-ink">{s.title || 'Untitled series'}</span>
                                    <FlagBadges series={s} />
                                    {draftId && <span className="ml-auto shrink-0 rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-bold uppercase text-brand">Imported</span>}
                                </span>
                                <span className="block text-xs text-gray-500">
                                    {s.startDate ? `${formatShort(s.startDate)} – ${formatShort(s.endDate)}` : 'No dates'} · <span className="font-mono">{s.id}</span>
                                </span>
                                {(flags || canCopy) && (
                                    <span className="mt-1.5 flex items-center gap-3">
                                        {flags && <SeriesFlagSwitches series={s} flags={flags} disabled={working} />}
                                        {canCopy && (
                                            <button
                                                type="button"
                                                className="ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold text-gray-500 hover:bg-gray-100 hover:text-ink disabled:opacity-50"
                                                disabled={working}
                                                title="Copy this series to dev for testing (copied inactive; prod isn’t changed)"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setConfirmCopy(s);
                                                }}
                                            >
                                                {copying === s.id ? <Loader2 size={12} className="animate-spin" /> : <Copy size={12} />} Copy to dev
                                            </button>
                                        )}
                                    </span>
                                )}
                            </span>
                        </div>
                    );
                })}
                {list && !shown.length && !listError && <p className="p-4 text-sm text-gray-400">No series found.</p>}
            </div>
            {confirmCopy && (
                <ConfirmModal
                    title={`Copy “${confirmCopy.title || 'Untitled series'}” to dev?`}
                    message="The series, its entries and its cover image are copied from prod to dev for testing, inactive. Prod isn’t changed, and no user data is copied."
                    confirmText="Copy to dev"
                    onCancel={() => setConfirmCopy(null)}
                    onConfirm={() => {
                        const series = confirmCopy;
                        setConfirmCopy(null);
                        copyToDev(series);
                    }}
                />
            )}
            {replaceCopy && (
                <ConfirmModal
                    title="Replace the copy in dev?"
                    message={`This series is already in dev${replaceCopy.title ? ` (“${replaceCopy.title}”)` : ''}. Replacing it overwrites the dev copy with prod’s, including any changes made to it in dev${replaceCopy.is_active ? ', and makes it inactive (it’s the active series in dev now)' : ''}. A dev draft linked to it won’t match it any more.`}
                    confirmText="Replace dev copy"
                    isDangerous
                    onCancel={() => setReplaceCopy(null)}
                    onConfirm={() => {
                        const { series } = replaceCopy;
                        setReplaceCopy(null);
                        copyToDev(series, true);
                    }}
                />
            )}
        </Dialog>
    );
}
