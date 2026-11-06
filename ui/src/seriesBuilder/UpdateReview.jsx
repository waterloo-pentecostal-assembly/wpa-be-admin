import React, { useState } from 'react';
import { AlertTriangle, ChevronDown, CheckCircle2 } from 'lucide-react';
import { formatShort } from '../series/dates';
import { diffLines } from '../series/entryDiff';
import { typeLabel } from '../series/engagementTypes';

const SERIES_LABELS = {
    title: 'Title',
    sub_title: 'Subtitle',
    image_gs_location: 'Cover image',
    is_active: 'Active',
    is_visible: 'Visible',
};

function show(value) {
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    return value === '' ? '(empty)' : value;
}

function Section({ title, items, tone = 'gray', children }) {
    const [open, setOpen] = useState(items.length <= 10);
    if (!items.length) return null;
    return (
        <div>
            <button className={`flex items-center gap-1 text-sm font-semibold ${tone === 'red' ? 'text-red-600' : 'text-gray-700'}`} onClick={() => setOpen((o) => !o)}>
                <ChevronDown size={14} className={open ? 'rotate-180' : ''} /> {title}
            </button>
            {open && (
                <ul className="mt-1.5 max-h-[28rem] overflow-y-auto rounded-lg border border-gray-200 divide-y divide-gray-100 text-sm">
                    {items.slice(0, 300).map(children)}
                </ul>
            )}
        </div>
    );
}

const LINE_STYLES = {
    same: 'text-gray-600',
    del: 'bg-red-50 text-red-900',
    add: 'bg-emerald-50 text-emerald-900',
};
const WORD_STYLES = { del: 'bg-red-200/80 rounded-sm', add: 'bg-emerald-200/80 rounded-sm' };
const MARKS = { same: ' ', del: '−', add: '+' };

function DiffLine({ type, text, segments }) {
    return (
        <div className={`flex gap-2 px-2 ${LINE_STYLES[type]}`}>
            <span className="w-3 shrink-0 select-none text-center opacity-60">{MARKS[type]}</span>
            <span className="min-w-0 whitespace-pre-wrap break-words">
                {segments
                    ? segments.map((seg, i) => <span key={i} className={seg.changed ? WORD_STYLES[type] : undefined}>{seg.text}</span>)
                    : text}
            </span>
        </div>
    );
}

/** Line diff of an entry's text, with word-level highlights on changed lines. */
function DiffView({ before, after }) {
    const lines = diffLines(before, after);
    return (
        <div className="mt-1.5 overflow-hidden rounded-md border border-gray-200 bg-white py-1 font-mono text-[11px] leading-5">
            {lines.map((line, i) => (line.type === 'skip'
                ? <div key={i} className="px-2 text-gray-400 select-none">⋯ {line.count} unchanged line{line.count === 1 ? '' : 's'}</div>
                : <DiffLine key={i} {...line} />))}
        </div>
    );
}

/** A whole entry as added or removed lines. */
function LinesView({ lines, type }) {
    return (
        <div className="mt-1.5 max-h-72 overflow-y-auto rounded-md border border-gray-200 bg-white py-1 font-mono text-[11px] leading-5">
            {lines.map((text, i) => <DiffLine key={i} type={type} text={text} />)}
        </div>
    );
}

function EntryHeader({ date, type, children }) {
    return (
        <div className="flex items-start gap-2">
            <span className="w-24 shrink-0 text-gray-500">{date ? formatShort(date) : 'No date'}</span>
            <span className="w-24 shrink-0 font-semibold text-gray-700">{typeLabel(type)}</span>
            <span className="min-w-0 flex-1 text-gray-600">{children}</span>
        </div>
    );
}

/** An added or removed entry; click to see its content. */
function ExpandableEntry({ date, type, lines, lineType, children }) {
    const [open, setOpen] = useState(false);
    return (
        <li className="px-3 py-1.5">
            <button className="w-full text-left" onClick={() => setOpen((o) => !o)} title={open ? 'Hide content' : 'Show content'}>
                <EntryHeader date={date} type={type}>
                    <span className="flex items-start gap-1">
                        <span className="min-w-0 flex-1">{children}</span>
                        <ChevronDown size={14} className={`mt-0.5 shrink-0 text-gray-400 ${open ? 'rotate-180' : ''}`} />
                    </span>
                </EntryHeader>
            </button>
            {open && lines && <LinesView lines={lines} type={lineType} />}
        </li>
    );
}

/** What updating a published series will change (from the server's update preview). */
export default function UpdateReview({ summary }) {
    if (!summary.writeCount) {
        return (
            <p className="flex items-center gap-2 py-6 justify-center text-sm text-gray-600">
                <CheckCircle2 size={18} className="text-emerald-500" /> The published series already matches this draft.
            </p>
        );
    }
    const contentChanges = summary.updated.length + summary.added.length + summary.removed.length;
    return (
        <div className="space-y-4">
            <div className="grid grid-cols-4 gap-3 text-center">
                {[['Changed', summary.updated.length], ['Added', summary.added.length], ['Removed', summary.removed.length], ['Unchanged', summary.unchanged]].map(([label, value]) => (
                    <div key={label} className={`rounded-xl border p-3 ${label === 'Removed' && value ? 'border-red-200 bg-red-50' : 'border-gray-200'}`}>
                        <div className="text-xl font-bold text-ink">{value}</div>
                        <div className="text-xs text-gray-500">{label}</div>
                    </div>
                ))}
            </div>

            {summary.series.length > 0 && (
                <div>
                    <p className="mb-1.5 text-sm font-semibold text-gray-700">Series details</p>
                    <ul className="rounded-lg border border-gray-200 divide-y divide-gray-100 text-sm">
                        {summary.series.map((c) => (
                            <li key={c.field} className="flex gap-2 px-3 py-1.5">
                                <span className="w-24 shrink-0 font-semibold text-gray-700">{SERIES_LABELS[c.field] ?? c.field}</span>
                                <span className="min-w-0 break-all text-gray-600">
                                    <span className="text-gray-400 line-through">{show(c.from)}</span> → {show(c.to)}
                                </span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            <Section title={`${summary.updated.length} changed`} items={summary.updated}>
                {(u) => (
                    <li key={u.id} className="px-3 py-2">
                        <EntryHeader date={u.date} type={u.content_type}>
                            {u.title}
                            {u.fromDate && <span className="ml-1 font-semibold text-amber-700">· moved from {formatShort(u.fromDate)}</span>}
                            {u.fromType && <span className="ml-1 font-semibold text-amber-700">· was {typeLabel(u.fromType)}</span>}
                        </EntryHeader>
                        {u.before && u.after && <DiffView before={u.before} after={u.after} />}
                    </li>
                )}
            </Section>
            <Section title={`${summary.added.length} added`} items={summary.added}>
                {(a) => (
                    <ExpandableEntry key={a.index} date={a.date} type={a.content_type} lines={a.lines} lineType="add">
                        {a.title}
                    </ExpandableEntry>
                )}
            </Section>
            <Section title={`${summary.removed.length} removed`} items={summary.removed} tone="red">
                {(r) => (
                    <ExpandableEntry key={r.id} date={r.date} type={r.content_type} lines={r.lines} lineType="del">
                        {r.title}
                        {r.completions > 0 && <span className="ml-1 font-semibold text-red-600">· {r.completions} completion{r.completions === 1 ? '' : 's'}</span>}
                    </ExpandableEntry>
                )}
            </Section>

            {summary.snippetChanged && !contentChanges && (
                <p className="alert border-amber-200 bg-amber-50 text-amber-800">
                    <AlertTriangle size={16} className="shrink-0" /> The series’ list of days is out of step with its content and will be rebuilt.
                </p>
            )}
        </div>
    );
}
