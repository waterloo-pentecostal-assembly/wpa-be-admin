import React, { useMemo, useState } from 'react';
import { copyEngagementToDays, copyReadingToDays } from '../series/draftModel';
import { formatShort, startOfWeek, weekdayOf, WEEKDAY_LONG, WEEKDAY_SHORT } from '../series/dates';
import { typeLabel } from '../series/engagementTypes';
import { Dialog, TypeChip } from './ui';

/**
 * Copies an engagement (or the day's scripture) to other days. Quick
 * choices fill the selection, which can then be adjusted day by day.
 */
export default function CopyToDialog({ draft, sourceDayId, target, update, onClose, toast }) {
    const sourceIndex = draft.days.findIndex((d) => d.id === sourceDayId);
    const sourceDay = draft.days[sourceIndex];
    const engagement = target.kind === 'engagement' ? sourceDay.engagements.find((e) => e.id === target.engagementId) : null;
    const weekday = weekdayOf(sourceDay.date);
    const week = startOfWeek(sourceDay.date);
    const [selected, setSelected] = useState(() => new Set());

    const others = draft.days.filter((d) => d.id !== sourceDayId);
    const quick = [
        { label: 'All days', ids: others.map((d) => d.id) },
        { label: `Every ${WEEKDAY_LONG[weekday]}`, ids: others.filter((d) => weekdayOf(d.date) === weekday).map((d) => d.id) },
        { label: 'Rest of this week', ids: draft.days.slice(sourceIndex + 1).filter((d) => startOfWeek(d.date) === week).map((d) => d.id) },
        { label: 'All following days', ids: draft.days.slice(sourceIndex + 1).map((d) => d.id) },
        { label: 'Next day', ids: draft.days[sourceIndex + 1] ? [draft.days[sourceIndex + 1].id] : [] },
    ];

    const weeks = useMemo(() => {
        const map = new Map();
        for (const d of draft.days) {
            const w = startOfWeek(d.date);
            if (!map.has(w)) map.set(w, []);
            map.get(w).push(d);
        }
        return [...map.entries()];
    }, [draft.days]);

    const toggle = (id) => setSelected((s) => {
        const next = new Set(s);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
    });

    const replaceCount = engagement
        ? draft.days.filter((d) => selected.has(d.id) && d.engagements.some((e) => e.type === engagement.type)).length
        : draft.days.filter((d) => selected.has(d.id) && d.reading?.ref).length;

    const confirm = () => {
        const ids = [...selected];
        if (engagement) update((d) => copyEngagementToDays(d, sourceDayId, engagement.id, ids));
        else update((d) => copyReadingToDays(d, sourceDayId, ids));
        toast(`Copied to ${ids.length} day${ids.length === 1 ? '' : 's'}`, { undo: true });
        onClose();
    };

    const what = engagement ? typeLabel(engagement.type) : 'scripture';

    return (
        <Dialog
            title={<span className="flex items-center gap-2">Copy {engagement ? <TypeChip type={engagement.type} /> : 'scripture'} to other days</span>}
            eyebrow={`From ${formatShort(sourceDay.date)}${!engagement && sourceDay.reading?.ref ? ` · ${sourceDay.reading.ref}` : ''}`}
            onClose={onClose}
            width="max-w-2xl"
            footer={(
                <>
                    <span className="mr-auto self-center text-xs text-gray-500">
                        {selected.size} selected{replaceCount ? ` · replaces the existing ${what} on ${replaceCount}` : ''}
                    </span>
                    <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
                    <button className="btn btn-primary" disabled={!selected.size} onClick={confirm}>Copy to {selected.size} day{selected.size === 1 ? '' : 's'}</button>
                </>
            )}
        >
            {engagement?.linked && (
                <p className="mb-4 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
                    This {what} uses the template, so this copies its per-day fields (e.g. the verse or song). Template edits still apply everywhere.
                </p>
            )}
            <div className="mb-4 flex flex-wrap gap-2">
                {quick.map((q) => (
                    <button
                        key={q.label}
                        disabled={!q.ids.length}
                        onClick={() => setSelected(new Set(q.ids))}
                        className="btn btn-secondary btn-sm"
                    >
                        {q.label} <span className="text-gray-400">{q.ids.length}</span>
                    </button>
                ))}
                <button className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set())}>Clear</button>
            </div>
            <div className="space-y-1.5">
                {weeks.map(([w, days]) => (
                    <div key={w} className="flex items-center gap-2">
                        <span className="w-20 shrink-0 text-[11px] font-semibold text-gray-400">{formatShort(w).slice(4)}</span>
                        <div className="flex flex-wrap gap-1">
                            {days.map((d) => {
                                const isSource = d.id === sourceDayId;
                                const on = selected.has(d.id);
                                return (
                                    <button
                                        key={d.id}
                                        disabled={isSource}
                                        onClick={() => toggle(d.id)}
                                        title={`${formatShort(d.date)}${d.reading?.ref ? ` · ${d.reading.ref}` : ''}`}
                                        className={`h-8 w-14 rounded-lg text-xs font-semibold ${isSource ? 'bg-ink text-white' : on ? 'bg-brand text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                                    >
                                        {WEEKDAY_SHORT[weekdayOf(d.date)]} {Number(d.date.slice(8))}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </div>
        </Dialog>
    );
}
