import React, { useEffect, useState } from 'react';
import { BookOpen, Loader2, AlertCircle, Search, Download } from 'lucide-react';
import { getPublishedSeries, listPublishedSeries } from '../api/seriesBuilderApi';
import { formatShort } from '../series/dates';
import { Dialog } from './ui';

/**
 * Lists the series in the app (selected environment) and opens one as a new
 * draft linked to it, so it can be corrected and updated from the builder.
 * A series that already has a draft opens that draft instead. "Fetch all"
 * adds a draft for every series that doesn't have one yet.
 *
 * @param {Map<string, string>} linkedDrafts  series ID -> draft ID (drafts and series of the selected environment)
 * @param {(series: object[], onProgress: (index: number) => void) => Promise<void>} onFetchAll
 */
export default function OpenPublishedDialog({ linkedDrafts, onOpen, onOpenDraft, onFetchAll, onClose }) {
    const [list, setList] = useState(null); // { env, series }
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(null);
    const [query, setQuery] = useState('');
    const [fetching, setFetching] = useState(null); // { index, total } while fetching all

    useEffect(() => {
        listPublishedSeries().then(setList).catch((e) => {
            setList({ env: null, series: [] });
            setError(e.message);
        });
    }, []);

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
    const working = !!busy || !!fetching;

    const q = query.trim().toLowerCase();
    const shown = list?.series.filter((s) => !q || s.title.toLowerCase().includes(q) || s.id.toLowerCase().includes(q)) ?? [];

    return (
            <Dialog title="Open a published series" eyebrow={list?.env ? `Series in ${list.env}` : 'Published series'} onClose={working ? () => {} : onClose} width="max-w-xl">
                <p className="mb-4 text-sm text-gray-500">
                    The series is copied into a new draft that stays linked to it. Edit the draft, then use <strong>Update</strong> to review and apply the changes to the app.
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
                {error && <p className="alert alert-error mb-3"><AlertCircle size={16} className="shrink-0" /> {error}</p>}
                <div className="max-h-96 overflow-y-auto rounded-lg border border-gray-200 divide-y divide-gray-100">
                    {list === null && <p className="flex items-center gap-2 p-4 text-sm text-gray-400"><Loader2 size={15} className="animate-spin" /> Loading…</p>}
                    {shown.map((s) => {
                        const draftId = linkedDrafts.get(s.id);
                        return (
                        <button
                            key={s.id}
                            disabled={working}
                            onClick={() => (draftId ? onOpenDraft(draftId) : open(s))}
                            title={draftId ? 'Already imported: opens it in the builder' : undefined}
                            className="flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-gray-50 disabled:opacity-50"
                        >
                            {busy === s.id ? <Loader2 size={16} className="mt-0.5 animate-spin text-brand" /> : <BookOpen size={16} className="mt-0.5 text-gray-400" />}
                            <span className="min-w-0 flex-1">
                                <span className="flex items-center gap-2">
                                    <span className="truncate text-sm font-semibold text-ink">{s.title || 'Untitled series'}</span>
                                    {s.is_active && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-700">Active</span>}
                                    {!s.is_visible && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold uppercase text-gray-500">Hidden</span>}
                                    {draftId && <span className="ml-auto shrink-0 rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-bold uppercase text-brand">Imported</span>}
                                </span>
                                <span className="block text-xs text-gray-500">
                                    {s.startDate ? `${formatShort(s.startDate)} – ${formatShort(s.endDate)}` : 'No dates'} · <span className="font-mono">{s.id}</span>
                                </span>
                            </span>
                        </button>
                    );
                })}
                {list && !shown.length && !error && <p className="p-4 text-sm text-gray-400">No series found.</p>}
            </div>
        </Dialog>
    );
}
