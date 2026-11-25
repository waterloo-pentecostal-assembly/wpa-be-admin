import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, Upload, CalendarRange, Trash2, CloudOff, Loader2, CheckCircle2, HardDrive, BookOpen, ArrowRightLeft, Search, Radio } from 'lucide-react';
import ConfirmModal from '../components/ConfirmModal';
import { copyDraftToEnv, getDraftsStatus, getPublishedSeries, linkDraftToSeries, listDrafts, listPublishedSeries } from '../api/seriesBuilderApi';
import { createDraft } from '../series/draftModel';
import { importSeriesJson } from '../series/importSeries';
import { listLocalOnly } from '../series/localDrafts';
import { formatShort } from '../series/dates';
import { deleteDraft, storeNewDraft } from './draftActions';
import ImportDialog from './ImportDialog';
import NewSeriesWizard from './NewSeriesWizard';
import OpenPublishedDialog from './OpenPublishedDialog';
import { FlagBadges, SeriesFlagSwitches } from './SeriesFlags';
import useSeriesFlags from './useSeriesFlags';

function timeAgo(ms) {
    if (!ms) return '';
    const s = Math.round((Date.now() - ms) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return new Date(ms).toLocaleDateString();
}

// Server drafts (when draft storage is available) plus browser-only drafts.
async function loadLibrary() {
    let status = { available: false, projectId: null };
    let error = null;
    let remote = [];
    try {
        status = await getDraftsStatus();
        if (status.available) remote = await listDrafts();
    } catch (e) {
        error = e.message;
    }
    return { status, error, drafts: [...remote, ...listLocalOnly()] };
}

// The series in the app, with their Active / Visible flags: { env, series, error }.
async function loadPublished() {
    try {
        return { ...(await listPublishedSeries()), error: null };
    } catch (e) {
        return { env: null, series: [], error: e.message };
    }
}

// After a series is made active, Firebase makes the others inactive; reload to show it.
const RELOAD_AFTER_ACTIVATE_MS = [3000, 10000];

export default function DraftLibrary({ onOpen }) {
    const [status, setStatus] = useState(null); // { available, projectId }
    const [drafts, setDrafts] = useState(null);
    const [error, setError] = useState(null);
    const [modal, setModal] = useState(null); // 'new' | 'import' | 'published' | { delete: draft } | { confirmCopy: draft } | { replaceCopy }
    const [importNote, setImportNote] = useState(null);
    const [copyNote, setCopyNote] = useState(null);
    const [fetchNote, setFetchNote] = useState(null); // { added, failed: string[] }
    const [query, setQuery] = useState('');

    const [published, setPublished] = useState(null); // { env, series, error }
    const [flagNote, setFlagNote] = useState(null);

    const [reloadKey, setReloadKey] = useState(0);
    const refresh = () => setReloadKey((k) => k + 1);

    useEffect(() => {
        let ignore = false;
        loadLibrary().then((result) => {
            if (ignore) return;
            setStatus(result.status);
            setError(result.error);
            setDrafts(result.drafts);
            if (result.status.available) loadPublished().then((p) => !ignore && setPublished(p));
        });
        return () => { ignore = true; };
    }, [reloadKey]);

    const timers = useRef([]);
    useEffect(() => () => timers.current.forEach(clearTimeout), []);
    const reloadPublished = useCallback(() => loadPublished().then(setPublished), []);

    const activeSeries = published?.series.filter((s) => s.is_active) ?? [];
    const onFlagsChanged = useCallback((seriesId, flags, { flag, value }) => {
        setPublished((p) => p && { ...p, series: p.series.map((s) => (s.id === seriesId ? { ...s, ...flags } : s)) });
        if (flag === 'is_active' && value) {
            setFlagNote('The series is now active. Firebase is making the other series inactive and sending the notifications.');
            timers.current.forEach(clearTimeout);
            timers.current = RELOAD_AFTER_ACTIVATE_MS.map((ms) => setTimeout(reloadPublished, ms));
        } else {
            setFlagNote(null);
        }
    }, [reloadPublished]);
    const flags = useSeriesFlags({ activeSeries, onChanged: onFlagsChanged });
    const publishedById = new Map((published?.series ?? []).map((s) => [s.id, s]));

    const create = async (draft) => {
        const id = await storeNewDraft(draft, status?.available);
        onOpen(id);
    };

    const importJson = async (json) => {
        const { draft, report } = importSeriesJson(json);
        if (!draft.days.length) throw new Error('The file has no dated content to import.');
        setImportNote(report);
        await create(draft);
    };

    // Drafts belong to one environment. From prod, a draft can be copied to
    // dev for testing (after a confirmation); nothing is copied into prod.
    const otherEnv = status?.env === 'prod' ? 'dev' : null;
    const copyToOther = async (d, replace = false) => {
        setError(null);
        setCopyNote(null);
        try {
            const result = await copyDraftToEnv(d.id, otherEnv, replace);
            const imageNote = result.image?.warning ? ` ${result.image.warning}.` : result.image?.copied ? ' Its cover image was copied to the dev bucket.' : '';
            setCopyNote(`“${d.title || 'Untitled series'}” ${result.replaced ? 'replaced the earlier copy' : 'was copied'} in ${otherEnv}.${imageNote} Switch to ${otherEnv} to open it.`);
        } catch (e) {
            if (e.status === 409 && e.body?.draftId) setModal({ replaceCopy: d, existingTitle: e.body.title });
            else setError(`Could not copy to ${otherEnv}: ${e.message}`);
        }
    };

    const q = query.trim().toLowerCase();
    const shown = (drafts ?? []).filter((d) => !q || (d.title || 'Untitled series').toLowerCase().includes(q));

    // Series ID -> the draft linked to that series (there is at most one).
    const linkedDrafts = new Map((drafts ?? []).filter((d) => d.seriesId).map((d) => [d.seriesId, d.id]));

    // A published series becomes a draft linked to it, so the draft can update it.
    // `existing` when another draft was linked to it since the library loaded (e.g. in another tab).
    const draftFromPublished = async (json) => {
        const { draft, report } = importSeriesJson(json);
        if (!draft.days.length) throw new Error('The series has no dated content to edit.');
        const id = await storeNewDraft(draft, true);
        try {
            await linkDraftToSeries(id, json.seriesId);
        } catch (e) {
            await deleteDraft(id).catch(() => {});
            if (e.status === 409 && e.body?.draftId) return { id: e.body.draftId, existing: true };
            throw new Error(`Could not link the draft to the series: ${e.message}`);
        }
        return { id, report };
    };

    const openPublished = async (json) => {
        const { id, report } = await draftFromPublished(json);
        if (report) setImportNote(report);
        onOpen(id);
    };

    // Adds a linked draft for each series, one at a time; a failure doesn't stop the rest.
    const fetchPublished = async (seriesList, onProgress) => {
        setFetchNote(null);
        const failed = [];
        let added = 0;
        for (const [index, series] of seriesList.entries()) {
            onProgress(index);
            try {
                const { existing } = await draftFromPublished(await getPublishedSeries(series.id));
                if (!existing) added++;
            } catch (e) {
                failed.push(`${series.title || series.id}: ${e.message}`);
            }
        }
        setModal(null);
        setFetchNote({ added, failed });
        refresh();
    };

    return (
        <div className="flex-1 overflow-y-auto">
            <div className="mx-auto max-w-5xl px-6 py-8">
                <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
                    <div>
                        <p className="eyebrow">Bible series</p>
                        <h1 className="page-title">Series builder</h1>
                        <p className="mt-1 text-sm text-gray-500">
                            Start a new series or open a published one to edit it. Changes save automatically as you work.
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <button className="btn btn-secondary" onClick={() => setModal('import')}><Upload size={16} /> Import JSON</button>
                        <button
                            className="btn btn-secondary"
                            onClick={() => setModal('published')}
                            disabled={!status?.available}
                            title={status?.available ? 'Edit a series that is already in the app' : 'Needs server draft storage'}
                        >
                            <BookOpen size={16} /> Open published
                        </button>
                        <button className="btn btn-primary" onClick={() => setModal('new')}><Plus size={16} /> New series</button>
                    </div>
                </div>

                {status && !status.available && (
                    <div className="alert mb-4 border-amber-200 bg-amber-50 text-amber-800">
                        <CloudOff size={16} className="shrink-0 mt-0.5" />
                        <span>Server draft storage isn’t available (no Firebase credentials). New drafts are kept in <strong>this browser only</strong>.</span>
                    </div>
                )}
                {error && <div className="alert alert-error mb-4">{error}</div>}
                {published && (
                    <div className="card mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                        <Radio size={16} className={activeSeries.length ? 'text-emerald-600' : 'text-gray-400'} />
                        {published.error ? (
                            <span className="text-sm text-red-600">Couldn’t load the published series: {published.error}</span>
                        ) : activeSeries.length ? (
                            activeSeries.map((s) => (
                                <span key={s.id} className="flex min-w-0 items-center gap-2 text-sm">
                                    <span className="text-gray-500">Active in the app:</span>
                                    <button
                                        className="truncate font-semibold text-ink hover:underline disabled:no-underline"
                                        disabled={!linkedDrafts.has(s.id)}
                                        title={linkedDrafts.has(s.id) ? 'Open its draft' : 'Not imported yet (Open published)'}
                                        onClick={() => onOpen(linkedDrafts.get(s.id))}
                                    >
                                        {s.title || 'Untitled series'}
                                    </button>
                                    {s.startDate && <span className="text-xs text-gray-400">{formatShort(s.startDate)} – {formatShort(s.endDate)}</span>}
                                    <FlagBadges series={{ ...s, is_active: false }} />
                                </span>
                            ))
                        ) : (
                            <span className="text-sm text-gray-500">No series is active in the app.</span>
                        )}
                        {activeSeries.length > 1 && <span className="text-xs text-amber-700">More than one series is active.</span>}
                        <span className="ml-auto text-xs text-gray-400">
                            {published.series.filter((s) => s.is_visible).length} of {published.series.length} series visible
                        </span>
                    </div>
                )}
                {flags.error && <div className="alert alert-error mb-4">{flags.error}</div>}
                {flagNote && (
                    <div className="alert alert-success mb-4">
                        <CheckCircle2 size={16} className="shrink-0 mt-0.5" />
                        <span>{flagNote}</span>
                    </div>
                )}
                {copyNote && (
                    <div className="alert alert-success mb-4">
                        <CheckCircle2 size={16} className="shrink-0 mt-0.5" />
                        <span>{copyNote}</span>
                    </div>
                )}
                {fetchNote?.added > 0 && (
                    <div className="alert alert-success mb-4">
                        <CheckCircle2 size={16} className="shrink-0 mt-0.5" />
                        <span>Fetched {fetchNote.added} published series.</span>
                    </div>
                )}
                {fetchNote?.failed.length > 0 && (
                    <div className="alert alert-error mb-4">
                        <div>
                            <p>Could not fetch {fetchNote.failed.length} series:</p>
                            <ul className="mt-1 list-disc pl-5">{fetchNote.failed.map((f) => <li key={f}>{f}</li>)}</ul>
                        </div>
                    </div>
                )}
                {importNote && (
                    <div className="alert alert-success mb-4">
                        <CheckCircle2 size={16} className="shrink-0 mt-0.5" />
                        <span>Imported {importNote.days} days ({importNote.entries} entries): {importNote.linked} use templates, {importNote.custom} kept as custom.</span>
                    </div>
                )}

                {drafts === null ? (
                    <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 size={16} className="animate-spin" /> Loading drafts…</p>
                ) : drafts.length === 0 ? (
                    <div className="rounded-2xl border-2 border-dashed border-gray-200 bg-white p-12 text-center">
                        <CalendarRange size={36} className="mx-auto mb-3 text-brand-300" />
                        <h3 className="text-lg font-bold text-ink">No drafts yet</h3>
                        <p className="mt-1 mb-4 text-sm text-gray-500">Start a new series, or import an existing JSON file to edit it.</p>
                        <button className="btn btn-primary" onClick={() => setModal('new')}><Plus size={16} /> New series</button>
                    </div>
                ) : (
                    <>
                        <div className="relative mb-4 max-w-sm">
                            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                            <input className="input pl-9" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name" />
                        </div>
                        {!shown.length && <p className="text-sm text-gray-500">No series match “{query.trim()}”.</p>}
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                            {shown.map((d) => (
                                <div key={d.id} className="card group relative cursor-pointer p-4 transition-shadow hover:shadow-md hover:border-brand-200" onClick={() => onOpen(d.id)}>
                                    <div className="flex items-start justify-between gap-2">
                                        <h3 className="font-bold text-ink truncate">{d.title || 'Untitled series'}</h3>
                                        <span className="flex shrink-0">
                                            {!d.local && otherEnv && (
                                                <button
                                                    className="icon-btn p-1 opacity-0 group-hover:opacity-100"
                                                    title={`Copy to ${otherEnv}`}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setModal({ confirmCopy: d });
                                                    }}
                                                >
                                                    <ArrowRightLeft size={15} />
                                                </button>
                                            )}
                                            <button
                                                className="icon-btn p-1 opacity-0 group-hover:opacity-100 hover:bg-red-50 hover:text-red-600"
                                                title="Delete draft"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setModal({ delete: d });
                                                }}
                                            >
                                                <Trash2 size={15} />
                                            </button>
                                        </span>
                                    </div>
                                    <p className="mt-1 text-sm text-gray-500">
                                        {d.dayCount} days{d.startDate ? ` · ${formatShort(d.startDate)} – ${formatShort(d.endDate)}` : ''}
                                    </p>
                                    <div className="mt-3 flex items-center gap-2 text-xs text-gray-400">
                                        <span>Edited {timeAgo(d.updatedAt)}</span>
                                        {d.local && <span className="inline-flex items-center gap-1 text-amber-600"><HardDrive size={11} /> This browser</span>}
                                        {!d.local && (d.seriesId
                                            ? <span className="ml-auto rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">Published</span>
                                            : <span className="ml-auto rounded-full bg-gray-100 px-2 py-0.5 font-semibold text-gray-600">Draft</span>)}
                                    </div>
                                    {publishedById.has(d.seriesId) && (
                                        <div className="mt-3 flex items-center gap-2 border-t border-gray-100 pt-2.5">
                                            <SeriesFlagSwitches series={publishedById.get(d.seriesId)} flags={flags} />
                                            <span className="ml-auto flex gap-1"><FlagBadges series={publishedById.get(d.seriesId)} /></span>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </>
                )}
                {status?.available && (
                    <p className="mt-6 text-xs text-gray-400">
                        {status.env ? `${status.env[0].toUpperCase()}${status.env.slice(1)} drafts` : 'Drafts'} are stored in Firestore ({status.projectId}), separately from published series.
                        {(status.env === 'prod' || status.env === 'dev') && ` Switch environment to see ${status.env === 'prod' ? 'dev' : 'prod'} drafts.`}
                    </p>
                )}
            </div>

            {modal === 'new' && (
                <NewSeriesWizard onClose={() => setModal(null)} onCreate={(opts) => create(createDraft(opts))} />
            )}
            {modal === 'import' && <ImportDialog onClose={() => setModal(null)} onImport={importJson} />}
            {modal === 'published' && (
                <OpenPublishedDialog
                    linkedDrafts={linkedDrafts}
                    published={published}
                    flags={flags}
                    onClose={() => setModal(null)}
                    onOpen={openPublished}
                    onOpenDraft={onOpen}
                    onFetchAll={fetchPublished}
                />
            )}
            {flags.dialog}
            {modal?.confirmCopy && (
                <ConfirmModal
                    title={`Copy “${modal.confirmCopy.title || 'Untitled series'}” to dev?`}
                    message="A copy of this prod draft is added to the dev drafts for testing, with its cover image copied into the dev bucket. The copy is inactive and isn’t linked to any series; the prod draft and the series in the app aren’t changed."
                    confirmText="Copy to dev"
                    onCancel={() => setModal(null)}
                    onConfirm={() => {
                        const target = modal.confirmCopy;
                        setModal(null);
                        copyToOther(target);
                    }}
                />
            )}
            {modal?.replaceCopy && (
                <ConfirmModal
                    title={`Replace the copy in ${otherEnv}?`}
                    message={`This draft was already copied to ${otherEnv}${modal.existingTitle ? ` (“${modal.existingTitle}”)` : ''}. Replacing it overwrites that copy with this draft, including any edits made to it in ${otherEnv}.`}
                    confirmText="Replace"
                    isDangerous
                    onCancel={() => setModal(null)}
                    onConfirm={() => {
                        const target = modal.replaceCopy;
                        setModal(null);
                        copyToOther(target, true);
                    }}
                />
            )}
            {modal?.delete && (
                <ConfirmModal
                    title="Delete draft?"
                    message={`“${modal.delete.title || 'Untitled series'}” will be permanently deleted from the ${status?.env ?? ''} drafts. ${modal.delete.seriesId ? 'The published series in the app isn’t affected; Open published can make a new draft of it.' : 'Published series aren’t affected.'}`}
                    confirmText="Delete"
                    isDangerous
                    onCancel={() => setModal(null)}
                    onConfirm={async () => {
                        const target = modal.delete;
                        setModal(null);
                        try {
                            await deleteDraft(target.id);
                        } catch (e) {
                            setError(e.message);
                        }
                        refresh();
                    }}
                />
            )}
        </div>
    );
}
