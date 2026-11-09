import React, { useEffect, useRef } from 'react';
import { Settings2, LayoutTemplate, AlertTriangle, AlertCircle } from 'lucide-react';
import { formatShort, startOfWeek, formatMonthYear } from '../series/dates';
import { perDayBlocks } from '../series/draftModel';
import { TypeDot, Kbd } from './ui';

function engagementIncomplete(draft, engagement) {
    if (!engagement.linked) return false;
    return perDayBlocks(draft, engagement.type).some((b) => {
        const v = engagement.values?.[b.id];
        return !(v?.text?.trim() || v?.url?.trim() || v?.ref?.trim());
    });
}

/**
 * Left rail: series details, templates, then every day grouped by week with
 * its scripture and one dot per engagement (hollow = per-day field empty).
 */
export default function DayRail({ draft, selection, onSelect, issuesByDay, filter, onFilterChange }) {
    const activeRef = useRef(null);
    useEffect(() => {
        activeRef.current?.scrollIntoView({ block: 'nearest' });
    }, [selection]);

    const days = draft.days
        .map((day, index) => ({ day, index, week: startOfWeek(day.date) }))
        .filter(({ day }) => filter !== 'issues' || issuesByDay.get(day.id)?.length)
        .map((item, i, list) => ({ ...item, firstOfWeek: i === 0 || list[i - 1].week !== item.week }));

    const navItem = (key, Icon, label, hint) => (
        <button
            ref={selection === key ? activeRef : null}
            onClick={() => onSelect(key)}
            className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm ${selection === key ? 'bg-brand-50 text-brand-700 font-semibold' : 'text-gray-700 hover:bg-gray-50'}`}
        >
            <Icon size={16} className="shrink-0" />
            <span className="flex-1 truncate">{label}</span>
            {hint}
        </button>
    );

    const issueCount = [...issuesByDay.values()].reduce((n, list) => n + list.length, 0);
    const seriesIssues = issuesByDay.get(null)?.length ?? 0;

    return (
        <aside className="flex w-64 shrink-0 flex-col border-r border-gray-200 bg-white">
            <div className="space-y-0.5 p-2 border-b border-gray-100">
                {navItem('series', Settings2, 'Series details', seriesIssues ? <AlertTriangle size={14} className="text-amber-500" /> : null)}
                {navItem('templates', LayoutTemplate, 'Templates', <span className="text-xs text-gray-400">{Object.keys(draft.templates).length}</span>)}
            </div>
            <div className="flex items-center justify-between px-4 pt-3 pb-1">
                <span className="section-label">{draft.days.length} days</span>
                <div className="flex rounded-md bg-gray-100 p-0.5 text-[11px] font-semibold">
                    {[['all', 'All'], ['issues', `To fix${issueCount ? ` (${issueCount})` : ''}`]].map(([value, label]) => (
                        <button
                            key={value}
                            onClick={() => onFilterChange(value)}
                            className={`rounded px-2 py-0.5 ${filter === value ? 'bg-white text-ink shadow-sm' : 'text-gray-500'}`}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            </div>
            <div className="flex-1 overflow-y-auto px-2 pb-3">
                {days.map(({ day, index, week, firstOfWeek }) => {
                    const header = firstOfWeek ? (
                        <div key={`w-${week}`} className="px-2 pt-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">
                            Week of {formatShort(week).slice(4)} · {formatMonthYear(week).slice(-4)}
                        </div>
                    ) : null;
                    const dayIssues = issuesByDay.get(day.id) ?? [];
                    const hasError = dayIssues.some((i) => i.level === 'error');
                    const key = `day:${day.id}`;
                    const active = selection === key;
                    return (
                        <React.Fragment key={day.id}>
                            {header}
                            <button
                                ref={active ? activeRef : null}
                                onClick={() => onSelect(key)}
                                className={`group w-full rounded-lg px-3 py-1.5 text-left ${active ? 'bg-brand text-white' : 'hover:bg-gray-50'}`}
                            >
                                <div className="flex items-center gap-2">
                                    <span className={`w-5 text-[11px] tabular-nums ${active ? 'text-white/70' : 'text-gray-400'}`}>{index + 1}</span>
                                    <span className={`text-sm font-semibold ${active ? '' : 'text-gray-800'}`}>{formatShort(day.date)}</span>
                                    <span className="ml-auto flex items-center gap-1">
                                        {day.engagements.map((e) => (
                                            <TypeDot key={e.id} type={e.type} hollow={engagementIncomplete(draft, e)} onDark={active} />
                                        ))}
                                    </span>
                                </div>
                                <div className="flex items-center gap-1 pl-7">
                                    <span className={`truncate text-xs ${active ? 'text-white/80' : day.reading?.ref ? 'text-gray-500' : 'text-gray-300 italic'}`}>
                                        {day.reading?.ref || 'No scripture'}
                                    </span>
                                    {dayIssues.length > 0 && (
                                        hasError
                                            ? <AlertCircle size={12} className={`ml-auto shrink-0 ${active ? 'text-white' : 'text-red-500'}`} />
                                            : <AlertTriangle size={12} className={`ml-auto shrink-0 ${active ? 'text-white' : 'text-amber-500'}`} />
                                    )}
                                </div>
                            </button>
                        </React.Fragment>
                    );
                })}
                {days.length === 0 && (
                    <p className="px-3 py-6 text-center text-sm text-gray-400">{filter === 'issues' ? 'Nothing to fix 🎉' : 'No days in the schedule.'}</p>
                )}
            </div>
            <div className="border-t border-gray-100 px-4 py-2 text-[10px] text-gray-400">
                <Kbd>Alt</Kbd>+<Kbd>↑</Kbd>/<Kbd>↓</Kbd> change day · <Kbd>Ctrl</Kbd>+<Kbd>Z</Kbd> undo
            </div>
        </aside>
    );
}
