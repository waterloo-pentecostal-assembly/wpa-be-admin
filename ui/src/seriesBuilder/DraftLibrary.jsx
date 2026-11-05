import React, { useEffect, useState } from 'react';
import { Plus, Upload, Sparkles, CalendarRange, Trash2, CloudOff, Loader2, CheckCircle2, HardDrive } from 'lucide-react';
import AiGeneratorModal from '../components/AiGeneratorModal';
import ConfirmModal from '../components/ConfirmModal';
import { getDraftsStatus, listDrafts } from '../api/seriesBuilderApi';
import { createDraft } from '../series/draftModel';
import { importSeriesJson } from '../series/importSeries';
import { listLocalOnly } from '../series/localDrafts';
import { formatShort } from '../series/dates';
import { deleteDraft, storeNewDraft } from './draftActions';
import ImportDialog from './ImportDialog';
import NewSeriesWizard from './NewSeriesWizard';

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
    const [modal, setModal] = useState(null); // 'new' | 'import' | 'ai' | { delete: draft }
    const [importNote, setImportNote] = useState(null);

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

    return (
        <div className="flex-1 overflow-y-auto">
            <div className="mx-auto max-w-5xl px-6 py-8">
                <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
                    <div>
                        <p className="eyebrow">Bible series</p>
                        <h1 className="page-title">Series builder</h1>
                        <p className="mt-1 text-sm text-gray-500">Drafts save automatically as you work.</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <button className="btn btn-secondary" onClick={() => setModal('ai')}><Sparkles size={16} className="text-brand" /> Generate from outline</button>
                        <button className="btn btn-secondary" onClick={() => setModal('import')}><Upload size={16} /> Import JSON</button>
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
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {drafts.map((d) => (
                            <div key={d.id} className="card group relative cursor-pointer p-4 transition-shadow hover:shadow-md hover:border-brand-200" onClick={() => onOpen(d.id)}>
                                <div className="flex items-start justify-between gap-2">
                                    <h3 className="font-bold text-ink truncate">{d.title || 'Untitled series'}</h3>
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
                                </div>
                                <p className="mt-1 text-sm text-gray-500">
                                    {d.dayCount} days{d.startDate ? ` · ${formatShort(d.startDate)} – ${formatShort(d.endDate)}` : ''}
                                </p>
                                <div className="mt-3 flex items-center gap-2 text-xs text-gray-400">
                                    <span>Edited {timeAgo(d.updatedAt)}</span>
                                    {d.local && <span className="inline-flex items-center gap-1 text-amber-600"><HardDrive size={11} /> This browser</span>}
                                    {d.publishedCount > 0 && <span className="ml-auto rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">Published {d.publishedCount}×</span>}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
                {status?.available && <p className="mt-6 text-xs text-gray-400">Drafts are stored in Firestore ({status.projectId}), separately from published series.</p>}
            </div>

            {modal === 'new' && (
                <NewSeriesWizard onClose={() => setModal(null)} onCreate={(opts) => create(createDraft(opts))} />
            )}
            {modal === 'import' && <ImportDialog onClose={() => setModal(null)} onImport={importJson} />}
            {modal === 'ai' && (
                <AiGeneratorModal
                    onCancel={() => setModal(null)}
                    onGenerate={async (data) => {
                        try {
                            await importJson(data);
                        } catch (e) {
                            setModal(null);
                            setError(`Could not use the generated series: ${e.message}`);
                        }
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
