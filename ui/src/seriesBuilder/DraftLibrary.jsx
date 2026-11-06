import React, { useEffect, useState } from 'react';
import { Plus, Upload, CalendarRange, Trash2, CloudOff, Loader2, CheckCircle2, HardDrive, BookOpen, ArrowRightLeft, Search } from 'lucide-react';
import ConfirmModal from '../components/ConfirmModal';
import { copyDraftToEnv, getDraftsStatus, getPublishedSeries, linkDraftToSeries, listDrafts } from '../api/seriesBuilderApi';
import { createDraft } from '../series/draftModel';
import { importSeriesJson } from '../series/importSeries';
import { listLocalOnly } from '../series/localDrafts';
import { formatShort } from '../series/dates';
import { useAuth } from '../contexts/AuthContext';
import { deleteDraft, storeNewDraft } from './draftActions';
import ImportDialog from './ImportDialog';
import NewSeriesWizard from './NewSeriesWizard';
import OpenPublishedDialog from './OpenPublishedDialog';

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

export default function DraftLibrary({ onOpen }) {
    const [status, setStatus] = useState(null); // { available, projectId }
    const [drafts, setDrafts] = useState(null);
    const [error, setError] = useState(null);
    const [modal, setModal] = useState(null); // 'new' | 'import' | 'published' | { delete: draft } | { replaceCopy }
    const [importNote, setImportNote] = useState(null);
    const [copyNote, setCopyNote] = useState(null);
    const [fetchNote, setFetchNote] = useState(null); // { added, failed: string[] }
    const [query, setQuery] = useState('');
    const updatedBy = useAuth()?.currentUser?.uid ?? null;

    const [reloadKey, setReloadKey] = useState(0);
    const refresh = () => setReloadKey((k) => k + 1);

    useEffect(() => {
        let ignore = false;
        loadLibrary().then((result) => {
            if (ignore) return;
            setStatus(result.status);
            setError(result.error);
            setDrafts(result.drafts);
        });
        return () => { ignore = true; };
    }, [reloadKey]);

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

    const otherEnv = status?.env === 'prod' ? 'dev' : status?.env === 'dev' ? 'prod' : null;

    // Drafts belong to one environment; this puts a copy in the other one.
    const copyToOther = async (d, replace = false) => {
        setError(null);
        setCopyNote(null);
        try {
            const result = await copyDraftToEnv(d.id, otherEnv, replace);
            setCopyNote(`“${d.title || 'Untitled series'}” ${result.replaced ? 'replaced the earlier copy' : 'was copied'} in ${otherEnv}. Switch to ${otherEnv} to open it.`);
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
            await linkDraftToSeries(id, json.seriesId, updatedBy);
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
                                                        copyToOther(d);
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
                                </div>
                            ))}
                        </div>
                    </>
                )}
                {status?.available && (
                    <p className="mt-6 text-xs text-gray-400">
                        {status.env ? `${status.env[0].toUpperCase()}${status.env.slice(1)} drafts` : 'Drafts'} are stored in Firestore ({status.projectId}), separately from published series.
                        {otherEnv && ` Switch environment to see ${otherEnv} drafts.`}
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
                    onClose={() => setModal(null)}
                    onOpen={openPublished}
                    onOpenDraft={onOpen}
                    onFetchAll={fetchPublished}
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
                    message={`“${modal.delete.title || 'Untitled series'}” will be removed from the builder. Published series are not affected.`}
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
