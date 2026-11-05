import React, { useMemo } from 'react';
import { addDays, formatMonthYear, isIsoDate, parseIso, toIso, WEEKDAY_SHORT, formatShort } from '../series/dates';
import { SCHEDULE_PRESETS, endDateForCount, generateDates, patternDates, presetForWeekdays, toggleDate } from '../series/schedule';

const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

function months(start, end) {
    if (!isIsoDate(start) || !isIsoDate(end) || end < start) return [];
    const list = [];
    const d = parseIso(start);
    d.setUTCDate(1);
    const last = parseIso(end);
    while (d <= last && list.length < 24) {
        list.push(toIso(d));
        d.setUTCMonth(d.getUTCMonth() + 1);
    }
    return list;
}

function Month({ monthIso, scheduled, pattern, excluded, extra, onToggle, highlight }) {
    const first = parseIso(monthIso);
    const leading = (first.getUTCDay() + 6) % 7;
    const daysInMonth = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
    const cells = [...Array(leading).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => addDays(monthIso, i))];
    return (
        <div>
            <div className="mb-1 text-xs font-bold text-gray-700">{formatMonthYear(monthIso)}</div>
            <div className="grid grid-cols-7 gap-0.5 text-center text-[10px] text-gray-400">
                {WEEK_ORDER.map((d) => <div key={d}>{WEEKDAY_SHORT[d][0]}</div>)}
                {cells.map((iso, i) => {
                    if (!iso) return <div key={`x${i}`} />;
                    const on = scheduled.has(iso);
                    const isExcluded = excluded.has(iso) && pattern.has(iso);
                    const isExtra = extra.has(iso);
                    return (
                        <button
                            key={iso}
                            type="button"
                            onClick={() => onToggle(iso)}
                            title={`${formatShort(iso)}${isExcluded ? ' (skipped)' : ''}${isExtra ? ' (added)' : ''}`}
                            className={`h-6 rounded text-[11px] tabular-nums transition-colors ${
                                on
                                    ? `${highlight?.has(iso) ? 'bg-brand-700' : 'bg-brand'} text-white font-semibold ${isExtra ? 'ring-2 ring-brand-300' : ''}`
                                    : isExcluded
                                        ? 'text-gray-400 line-through bg-gray-100'
                                        : 'text-gray-600 hover:bg-gray-100'
                            }`}
                        >
                            {parseIso(iso).getUTCDate()}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

/**
 * Picks the series dates: a pattern preset or custom weekdays, a start date,
 * an end date or a number of days, and click-to-skip/add on a calendar.
 */
export default function SchedulePicker({ schedule, onChange }) {
    const dates = useMemo(() => generateDates(schedule), [schedule]);
    const pattern = useMemo(() => new Set(patternDates(schedule)), [schedule]);
    const scheduled = useMemo(() => new Set(dates), [dates]);
    const activePreset = schedule.weekdays.length ? presetForWeekdays(schedule.weekdays) : null;
    const specificDates = schedule.weekdays.length === 0;

    const set = (patch) => onChange({ ...schedule, ...patch });

    const setPreset = (preset) => {
        let weekdays = preset.weekdays;
        if (preset.id === 'weekly' && isIsoDate(schedule.start)) weekdays = [parseIso(schedule.start).getUTCDay()];
        set({ weekdays, excluded: [], extra: [] });
    };

    const toggleWeekday = (d) => {
        const weekdays = schedule.weekdays.includes(d) ? schedule.weekdays.filter((x) => x !== d) : [...schedule.weekdays, d];
        set({ weekdays: weekdays.sort() });
    };

    const setCount = (count) => {
        const end = endDateForCount(schedule, count);
        if (end) set({ end });
    };

    return (
        <div className="space-y-5">
            <div>
                <label className="label">Repeats</label>
                <div className="flex flex-wrap gap-2">
                    {SCHEDULE_PRESETS.map((preset) => (
                        <button
                            key={preset.id}
                            type="button"
                            onClick={() => setPreset(preset)}
                            className={`rounded-xl border px-3 py-2 text-left transition-colors ${activePreset?.id === preset.id ? 'border-brand bg-brand-50 ring-1 ring-brand' : 'border-gray-200 bg-white hover:border-gray-300'}`}
                        >
                            <div className="text-sm font-semibold text-ink">{preset.label}</div>
                            <div className="text-[11px] text-gray-500">{preset.hint}</div>
                        </button>
                    ))}
                    <button
                        type="button"
                        onClick={() => set({ weekdays: [], excluded: [], extra: dates })}
                        className={`rounded-xl border px-3 py-2 text-left transition-colors ${specificDates ? 'border-brand bg-brand-50 ring-1 ring-brand' : 'border-gray-200 bg-white hover:border-gray-300'}`}
                    >
                        <div className="text-sm font-semibold text-ink">Specific dates</div>
                        <div className="text-[11px] text-gray-500">Click days on the calendar</div>
                    </button>
                </div>
                {!specificDates && (
                    <div className="mt-3 flex items-center gap-1">
                        <span className="mr-2 text-xs text-gray-500">Custom days:</span>
                        {WEEK_ORDER.map((d) => (
                            <button
                                key={d}
                                type="button"
                                onClick={() => toggleWeekday(d)}
                                className={`h-8 w-10 rounded-lg text-xs font-semibold ${schedule.weekdays.includes(d) ? 'bg-brand text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                            >
                                {WEEKDAY_SHORT[d]}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                    <label className="label">Start date</label>
                    <input type="date" className="input" value={schedule.start} onChange={(e) => set({ start: e.target.value })} />
                </div>
                <div>
                    <label className="label">End date</label>
                    <input type="date" className="input" value={schedule.end} min={schedule.start} onChange={(e) => set({ end: e.target.value })} />
                </div>
                <div>
                    <label className="label">or number of days</label>
                    <input
                        type="number"
                        min={1}
                        max={366}
                        className="input"
                        disabled={specificDates}
                        value={dates.length || ''}
                        onChange={(e) => setCount(Number(e.target.value))}
                    />
                </div>
            </div>

            <div>
                <div className="mb-2 flex items-baseline justify-between">
                    <label className="label mb-0">Calendar</label>
                    <span className="text-xs text-gray-500">
                        {dates.length ? <><span className="font-semibold text-ink">{dates.length} days</span> · {formatShort(dates[0])} – {formatShort(dates.at(-1))} · click a day to skip or add it</> : 'Pick a start and end date'}
                    </span>
                </div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-xl border border-gray-200 bg-white p-4 sm:grid-cols-3">
                    {months(schedule.start, schedule.end).map((m) => (
                        <Month
                            key={m}
                            monthIso={m}
                            scheduled={scheduled}
                            pattern={pattern}
                            excluded={new Set(schedule.excluded)}
                            extra={new Set(schedule.extra)}
                            onToggle={(iso) => onChange(toggleDate(schedule, iso))}
                        />
                    ))}
                    {!months(schedule.start, schedule.end).length && <p className="col-span-full py-6 text-center text-sm text-gray-400">No dates yet.</p>}
                </div>
            </div>
        </div>
    );
}
