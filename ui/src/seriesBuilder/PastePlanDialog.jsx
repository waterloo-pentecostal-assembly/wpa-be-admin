import React, { useMemo, useState } from 'react';
import { Check, AlertCircle, Loader2 } from 'lucide-react';
import { assignReadings } from '../series/draftModel';
import { formatShort } from '../series/dates';
import { ensureRefs, getLookup } from '../series/passageStore';
import { extractReference } from '../series/planParsing';
import { Dialog } from './ui';

export default function PastePlanDialog({ draft, startDayId, update, onClose, toast }) {
    const defaultStart = Math.max(0, draft.days.findIndex((d) => d.id === startDayId));
    const [text, setText] = useState('');
    const [startIndex, setStartIndex] = useState(defaultStart);
    const [checked, setChecked] = useState(null); // [{ input, ref, result }]
    const [checking, setChecking] = useState(false);

    const lines = useMemo(() => text.split('\n').map(extractReference).filter(Boolean), [text]);
    const overflow = Math.max(0, startIndex + lines.length - draft.days.length);
    const overwrite = draft.days.slice(startIndex, startIndex + lines.length).filter((d) => d.reading?.ref).length;

    const check = async () => {
        setChecking(true);
        try {
            await ensureRefs(lines);
            const lookup = getLookup();
            setChecked(lines.map((input) => ({ input, result: lookup(input) })));
        } finally {
            setChecking(false);
        }
    };

    const valid = checked?.filter((c) => c.result?.ok).length ?? 0;
    const invalid = checked ? checked.length - valid : 0;

    const apply = () => {
        const refs = checked.map((c) => (c.result?.ok ? c.result.label : c.input));
        update((d) => assignReadings(d, startIndex, refs));
        toast(`Set scripture for ${Math.min(refs.length, draft.days.length - startIndex)} days`, { undo: true });
        onClose();
    };

    return (
        <Dialog
            title="Paste a reading plan"
            eyebrow="Scripture for many days"
            onClose={onClose}
            width="max-w-3xl"
            footer={(
                <>
                    <span className="mr-auto self-center text-xs text-gray-500">
                        {checked ? `${valid} valid${invalid ? ` · ${invalid} need fixing (kept as typed)` : ''}` : `${lines.length} reference${lines.length === 1 ? '' : 's'}`}
                    </span>
                    <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
                    {checked ? (
                        <>
                            <button className="btn btn-secondary" onClick={() => setChecked(null)}>Edit</button>
                            <button className="btn btn-primary" onClick={apply}>Apply to {Math.min(checked.length, draft.days.length - startIndex)} days</button>
                        </>
                    ) : (
                        <button className="btn btn-primary" disabled={!lines.length || checking} onClick={check}>
                            {checking && <Loader2 size={14} className="animate-spin" />} Check references
                        </button>
                    )}
                </>
            )}
        >
            {!checked ? (
                <div className="grid gap-4 sm:grid-cols-[1fr_220px]">
                    <div>
                        <label className="label">One reference per line</label>
                        <textarea
                            autoFocus
                            className="input h-72 font-mono text-sm"
                            placeholder={'Matthew 1:1-17\nMatthew 1:18-25\nMatt 2:1-12\n…'}
                            value={text}
                            onChange={(e) => setText(e.target.value)}
                        />
                        <p className="mt-1 text-xs text-gray-400">Abbreviations work. List numbers, bullets and spreadsheet columns are ignored.</p>
                    </div>
                    <div className="space-y-3">
                        <div>
                            <label className="label">Starting on</label>
                            <select className="input" value={startIndex} onChange={(e) => setStartIndex(Number(e.target.value))}>
                                {draft.days.map((d, i) => (
                                    <option key={d.id} value={i}>Day {i + 1} · {formatShort(d.date)}{d.reading?.ref ? ' ✓' : ''}</option>
                                ))}
                            </select>
                        </div>
                        {lines.length > 0 && (
                            <div className="rounded-lg bg-gray-50 p-3 text-xs text-gray-600 space-y-1">
                                <p>Fills day {startIndex + 1} to {Math.min(draft.days.length, startIndex + lines.length)}.</p>
                                {overwrite > 0 && <p className="text-amber-700">Replaces scripture already set on {overwrite} day{overwrite === 1 ? '' : 's'}.</p>}
                                {overflow > 0 && <p className="text-red-600">{overflow} reference{overflow === 1 ? '' : 's'} won’t fit. Extend the schedule first.</p>}
                            </div>
                        )}
                    </div>
                </div>
            ) : (
                <table className="w-full text-sm">
                    <thead>
                        <tr className="text-left text-xs text-gray-400">
                            <th className="pb-2 font-semibold">Day</th>
                            <th className="pb-2 font-semibold">You typed</th>
                            <th className="pb-2 font-semibold">Scripture</th>
                        </tr>
                    </thead>
                    <tbody>
                        {checked.map((c, i) => {
                            const day = draft.days[startIndex + i];
                            return (
                                <tr key={i} className={`border-t border-gray-100 ${!day ? 'opacity-40' : ''}`}>
                                    <td className="py-1.5 pr-3 whitespace-nowrap text-gray-500">{day ? `${startIndex + i + 1} · ${formatShort(day.date)}` : 'won’t fit'}</td>
                                    <td className="py-1.5 pr-3 font-mono text-xs text-gray-500">{c.input}</td>
                                    <td className="py-1.5">
                                        {c.result?.ok ? (
                                            <span className="flex items-center gap-1 text-emerald-700"><Check size={14} /> {c.result.label}</span>
                                        ) : (
                                            <span className="flex items-center gap-1 text-red-600"><AlertCircle size={14} /> {c.result?.error ?? 'Could not check'}</span>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            )}
        </Dialog>
    );
}
