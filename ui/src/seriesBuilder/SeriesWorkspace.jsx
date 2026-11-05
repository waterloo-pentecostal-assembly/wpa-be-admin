import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Undo2, Redo2, CalendarRange, CloudUpload, PanelRight, Loader2, AlertCircle, History } from 'lucide-react';
import { collectRefs, compileDraft } from '../series/compile';
import { useScriptureLookup } from '../series/passageStore';
import { useDraftDocument } from '../series/useDraftDocument';
import { usePublishes } from '../series/usePublishes';
import { isActive } from '../series/publishes';
import { getCurrentEnv } from '../api/seriesBuilderApi';
import CopyToDialog from './CopyToDialog';
import DayEditor from './DayEditor';
import DayRail from './DayRail';
import PastePlanDialog from './PastePlanDialog';
import PreviewPane from './PreviewPane';
import PublishDialog from './PublishDialog';
import SaveIndicator from './SaveIndicator';
import ScheduleDialog from './ScheduleDialog';
import SeriesSettings from './SeriesSettings';
import TemplatesEditor from './TemplatesEditor';
import { isTypingTarget } from './dom';
import { Toasts } from './ui';

const PREVIEW_KEY = 'seriesBuilder:showPreview';

export default function SeriesWorkspace({ draftId, selection, onSelect, onExit }) {
    const doc = useDraftDocument(draftId);
    const publishes = usePublishes(draftId);
    const activePublish = publishes.publishes.find((p) => isActive(p));
    const { draft, update, undo, redo } = doc;
    const [modal, setModal] = useState(null);
    const [toasts, setToasts] = useState([]);
    const [railFilter, setRailFilter] = useState('all');
    const [templateFocus, setTemplateFocus] = useState(null);
    const [env, setEnv] = useState(null);
    const [showPreview, setShowPreview] = useState(() => localStorage.getItem(PREVIEW_KEY) !== 'false');
    const readingInputRef = useRef(null);
    const [lastDayId, setLastDayId] = useState(null);
    if (selection?.startsWith('day:') && selection.slice(4) !== lastDayId) setLastDayId(selection.slice(4));
    const focusReadingRef = useRef(false);

    useEffect(() => {
        const load = () => getCurrentEnv().then((r) => setEnv(r.env)).catch(() => {});
        load();
        window.addEventListener('focus', load);
        return () => window.removeEventListener('focus', load);
    }, []);

    const refs = useMemo(() => (draft ? collectRefs(draft) : []), [draft]);
    const lookup = useScriptureLookup(refs);
    const issues = useMemo(
        () => (draft ? compileDraft(draft, lookup).issues.filter((i) => i.level !== 'pending') : []),
        [draft, lookup],
    );
    const issuesByDay = useMemo(() => {
        const map = new Map();
        for (const issue of issues) {
            if (!map.has(issue.dayId)) map.set(issue.dayId, []);
            map.get(issue.dayId).push(issue);
        }
        return map;
    }, [issues]);

    // Default selection: first day without scripture, else the first day.
    const dayIndex = draft && selection?.startsWith('day:') ? draft.days.findIndex((d) => `day:${d.id}` === selection) : -1;
    useEffect(() => {
        if (!draft) return;
        if (selection === 'series' || selection === 'templates' || dayIndex >= 0) return;
        const first = draft.days.find((d) => !d.reading?.ref) ?? draft.days[0];
        onSelect(first ? `day:${first.id}` : 'series', { replace: true });
    }, [draft, selection, dayIndex, onSelect]);

    const goDay = useCallback((delta, { focusReading = false } = {}) => {
        if (!draft?.days.length) return;
        const from = dayIndex < 0 ? (delta > 0 ? -1 : draft.days.length) : dayIndex;
        const next = draft.days[Math.min(draft.days.length - 1, Math.max(0, from + delta))];
        focusReadingRef.current = focusReading;
        onSelect(`day:${next.id}`);
    }, [draft, dayIndex, onSelect]);

    useEffect(() => {
        if (focusReadingRef.current) {
            focusReadingRef.current = false;
            readingInputRef.current?.focus();
        }
    }, [selection]);

    const toast = useCallback((message, { undo: withUndo = false, tone } = {}) => {
        const id = Math.random().toString(36).slice(2);
        setToasts((t) => [...t.slice(-2), { id, message, tone, action: withUndo ? { label: 'Undo', run: undo } : null }]);
        setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
    }, [undo]);

    // Keyboard shortcuts.
    useEffect(() => {
        const onKey = (e) => {
            const mod = e.ctrlKey || e.metaKey;
            if (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
                e.preventDefault();
                goDay(e.key === 'ArrowDown' ? 1 : -1);
            } else if (mod && e.key.toLowerCase() === 's') {
                e.preventDefault();
                doc.saveNow();
            } else if (mod && !isTypingTarget(e.target) && e.key.toLowerCase() === 'z') {
                e.preventDefault();
                if (e.shiftKey) redo();
                else undo();
            } else if (mod && !isTypingTarget(e.target) && e.key.toLowerCase() === 'y') {
                e.preventDefault();
                redo();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [goDay, undo, redo, doc]);

    if (doc.loadState.status === 'loading') {
        return <div className="flex flex-1 items-center justify-center text-sm text-gray-500"><Loader2 size={18} className="mr-2 animate-spin" /> Opening draft…</div>;
    }
    if (doc.loadState.status === 'error') {
        return (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-sm">
                <p className="flex items-center gap-2 text-red-600"><AlertCircle size={16} /> {doc.loadState.error}</p>
                <button className="btn btn-secondary" onClick={onExit}><ArrowLeft size={16} /> Back to drafts</button>
            </div>
        );
    }

    const day = dayIndex >= 0 ? draft.days[dayIndex] : null;
    // Templates and series details preview the day that was open last.
    const previewDay = day ?? draft.days.find((d) => d.id === lastDayId) ?? draft.days[0] ?? null;
    const errorCount = issues.filter((i) => i.level === 'error').length;

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            {/* Toolbar */}
            <div className="flex h-12 shrink-0 items-center gap-3 border-b border-gray-200 bg-white px-3">
                <button className="btn btn-ghost btn-sm" onClick={onExit} title="All drafts"><ArrowLeft size={16} /> Drafts</button>
                <span className="h-5 w-px bg-gray-200" />
                <button className="min-w-0 truncate text-sm font-bold text-ink hover:text-brand" onClick={() => onSelect('series')}>
                    {draft.meta.title || 'Untitled series'}
                </button>
                <SaveIndicator doc={doc} />
                {activePublish && (
                    <button className="flex items-center gap-1.5 text-xs text-brand" onClick={() => onSelect('series')} title="Publishing; see Series details">
                        <Loader2 size={13} className="animate-spin" />
                        Publishing to {activePublish.env} · {(activePublish.written ?? 0) + (activePublish.failedCount ?? 0)}/{activePublish.total}
                    </button>
                )}
                <div className="ml-auto flex items-center gap-1">
                    <button className="icon-btn" onClick={undo} disabled={!doc.canUndo} title="Undo (Ctrl+Z)"><Undo2 size={16} /></button>
                    <button className="icon-btn" onClick={redo} disabled={!doc.canRedo} title="Redo (Ctrl+Shift+Z)"><Redo2 size={16} /></button>
                    <span className="mx-1 h-5 w-px bg-gray-200" />
                    <button className="btn btn-ghost btn-sm" onClick={() => setModal({ type: 'schedule' })}><CalendarRange size={15} /> Schedule</button>
                    <button
                        className={`btn btn-ghost btn-sm hidden xl:inline-flex ${showPreview ? 'text-brand' : ''}`}
                        onClick={() => {
                            localStorage.setItem(PREVIEW_KEY, String(!showPreview));
                            setShowPreview(!showPreview);
                        }}
                        title="Toggle preview"
                    >
                        <PanelRight size={15} /> Preview
                    </button>
                    <button className={`btn btn-sm ${env === 'prod' ? 'btn-dark' : 'btn-primary'}`} onClick={() => setModal({ type: 'publish' })}>
                        <CloudUpload size={15} /> Publish{env ? ` to ${env}` : ''}
                        {errorCount > 0 && <span className="rounded-full bg-red-500 px-1.5 text-[10px]">{errorCount}</span>}
                    </button>
                </div>
            </div>

            {doc.recovery && (
                <div className="flex items-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
                    <History size={16} />
                    Unsaved changes from {new Date(doc.recovery.savedAt).toLocaleString()} were found in this browser.
                    <button className="btn btn-sm btn-secondary" onClick={doc.acceptRecovery}>Restore them</button>
                    <button className="btn btn-sm btn-ghost" onClick={doc.dismissRecovery}>Discard</button>
                </div>
            )}

            <div className="flex min-h-0 flex-1">
                <DayRail
                    draft={draft}
                    selection={selection}
                    onSelect={onSelect}
                    issuesByDay={issuesByDay}
                    filter={railFilter}
                    onFilterChange={setRailFilter}
                />
                <main key={selection?.startsWith('day:') ? 'day' : selection} className="min-w-0 flex-1 overflow-y-auto">
                    {selection === 'series' && (
                        <SeriesSettings draft={draft} update={update} env={env} publishes={publishes} onEditSchedule={() => setModal({ type: 'schedule' })} />
                    )}
                    {selection === 'templates' && (
                        <TemplatesEditor draft={draft} update={update} focusType={templateFocus} toast={toast} />
                    )}
                    {day && (
                        <DayEditor
                            key={day.id}
                            draft={draft}
                            day={day}
                            dayIndex={dayIndex}
                            lookup={lookup}
                            issues={issues}
                            update={update}
                            toast={toast}
                            readingInputRef={readingInputRef}
                            onPrev={() => goDay(-1)}
                            onNext={() => goDay(1, { focusReading: true })}
                            onCopy={(target) => setModal({ type: 'copy', dayId: day.id, target })}
                            onPastePlan={() => setModal({ type: 'paste', dayId: day.id })}
                            onEditTemplate={(type) => {
                                setTemplateFocus(type);
                                onSelect('templates');
                            }}
                        />
                    )}
                </main>
                {showPreview && <PreviewPane draft={draft} day={previewDay} lookup={lookup} />}
            </div>

            {modal?.type === 'schedule' && <ScheduleDialog draft={draft} update={update} toast={toast} onClose={() => setModal(null)} />}
            {modal?.type === 'copy' && (
                <CopyToDialog draft={draft} sourceDayId={modal.dayId} target={modal.target} update={update} toast={toast} onClose={() => setModal(null)} />
            )}
            {modal?.type === 'paste' && (
                <PastePlanDialog draft={draft} startDayId={modal.dayId} update={update} toast={toast} onClose={() => setModal(null)} />
            )}
            {modal?.type === 'publish' && (
                <PublishDialog
                    draft={draft}
                    draftId={draftId}
                    publishes={publishes}
                    onClose={() => setModal(null)}
                    onGoToDay={(dayId) => onSelect(dayId ? `day:${dayId}` : 'series')}
                />
            )}
            <Toasts toasts={toasts} onDismiss={(id) => setToasts((t) => t.filter((x) => x.id !== id))} />
        </div>
    );
}
