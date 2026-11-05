// Series schedules. A schedule is
//   { start, end, weekdays: number[], excluded: string[], extra: string[] }
// and produces every date in [start, end] whose weekday is in `weekdays`,
// minus `excluded`, plus any `extra` dates. "Specific dates" schedules are
// simply `weekdays: []` with every date listed in `extra`.

import { addDays, isIsoDate, parseIso, weekdayOf } from './dates.js';

export const SCHEDULE_PRESETS = [
    { id: 'weekdays', label: 'Weekdays', hint: 'Mon – Fri', weekdays: [1, 2, 3, 4, 5] },
    { id: 'daily', label: 'Every day', hint: 'Sun – Sat', weekdays: [0, 1, 2, 3, 4, 5, 6] },
    { id: 'mwf', label: 'Mon / Wed / Fri', hint: 'Every other weekday', weekdays: [1, 3, 5] },
    { id: 'tth', label: 'Tue / Thu', hint: 'Twice a week', weekdays: [2, 4] },
    { id: 'weekly', label: 'Weekly', hint: 'Same day each week', weekdays: [1] },
];

// Guards against runaway loops from a typo'd year (e.g. 20260 instead of 2026).
const MAX_SPAN_DAYS = 366 * 3;

export function presetForWeekdays(weekdays) {
    const key = [...weekdays].sort().join(',');
    return SCHEDULE_PRESETS.find((p) => p.id !== 'weekly' && [...p.weekdays].sort().join(',') === key)
        ?? (weekdays.length === 1 ? SCHEDULE_PRESETS.find((p) => p.id === 'weekly') : null);
}

export function normalizeSchedule(schedule) {
    return {
        start: schedule?.start ?? '',
        end: schedule?.end ?? '',
        weekdays: [...new Set(schedule?.weekdays ?? [])].sort(),
        excluded: [...new Set(schedule?.excluded ?? [])].sort(),
        extra: [...new Set(schedule?.extra ?? [])].sort(),
    };
}

/** Dates matched by the weekday pattern alone (before exclusions/extras). */
export function patternDates(schedule) {
    const { start, end, weekdays } = schedule;
    if (!isIsoDate(start) || !isIsoDate(end) || end < start || !weekdays?.length) return [];
    const span = Math.round((parseIso(end) - parseIso(start)) / 86400000);
    if (span > MAX_SPAN_DAYS) return [];
    const wanted = new Set(weekdays);
    const dates = [];
    for (let iso = start; iso <= end; iso = addDays(iso, 1)) {
        if (wanted.has(weekdayOf(iso))) dates.push(iso);
    }
    return dates;
}

export function generateDates(schedule) {
    const excluded = new Set(schedule.excluded ?? []);
    const dates = new Set(patternDates(schedule).filter((d) => !excluded.has(d)));
    for (const d of schedule.extra ?? []) if (isIsoDate(d)) dates.add(d);
    return [...dates].sort();
}

/** True when `iso` is part of the generated schedule. */
export function isScheduled(schedule, iso) {
    return generateDates(schedule).includes(iso);
}

/**
 * Toggles a single date on or off, the way a click on the calendar does:
 * pattern dates move in/out of `excluded`, other dates in/out of `extra`.
 */
export function toggleDate(schedule, iso) {
    const inPattern = patternDates(schedule).includes(iso);
    const next = normalizeSchedule(schedule);
    if (inPattern) {
        next.excluded = toggleIn(next.excluded, iso);
    } else {
        next.extra = toggleIn(next.extra, iso);
    }
    return next;
}

function toggleIn(list, value) {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value].sort();
}

/**
 * End date that yields exactly `count` sessions from `start` with the given
 * weekdays and exclusions, or '' when it cannot be reached.
 */
export function endDateForCount({ start, weekdays, excluded = [] }, count) {
    if (!isIsoDate(start) || !weekdays?.length || !(count > 0)) return '';
    const wanted = new Set(weekdays);
    const skip = new Set(excluded);
    let found = 0;
    let iso = start;
    for (let i = 0; i <= MAX_SPAN_DAYS; i++, iso = addDays(iso, 1)) {
        if (wanted.has(weekdayOf(iso)) && !skip.has(iso)) {
            found++;
            if (found === count) return iso;
        }
    }
    return '';
}

/**
 * Infers the most natural schedule for an existing list of dates (used when
 * importing a series): the preset/weekday pattern needing the fewest
 * exclusions, falling back to a specific-dates schedule.
 */
export function inferSchedule(inputDates) {
    const dates = [...new Set(inputDates.filter(isIsoDate))].sort();
    if (dates.length === 0) return normalizeSchedule({});
    const start = dates[0];
    const end = dates.at(-1);
    const usedWeekdays = [...new Set(dates.map(weekdayOf))].sort();
    const candidates = [usedWeekdays, ...SCHEDULE_PRESETS.map((p) => p.weekdays)];
    const dateSet = new Set(dates);

    let best = null;
    for (const weekdays of candidates) {
        const pattern = patternDates({ start, end, weekdays });
        if (!dates.every((d) => pattern.includes(d))) continue;
        const excluded = pattern.filter((d) => !dateSet.has(d));
        if (!best || excluded.length < best.excluded.length) best = { weekdays, excluded };
    }
    if (best && best.excluded.length <= Math.max(2, Math.floor(dates.length * 0.2))) {
        return normalizeSchedule({ start, end, weekdays: best.weekdays, excluded: best.excluded });
    }
    return normalizeSchedule({ start, end, weekdays: [], extra: dates });
}

/** Weekdays the series actually meets on, Monday first (for per-weekday choices). */
export function scheduleWeekdays(schedule) {
    const days = schedule.weekdays?.length ? schedule.weekdays : [...new Set(generateDates(schedule).map(weekdayOf))];
    return [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
}

export function describeSchedule(schedule) {
    const preset = schedule.weekdays.length ? presetForWeekdays(schedule.weekdays) : null;
    if (!schedule.weekdays.length) return 'Specific dates';
    if (preset && preset.id !== 'weekly') return preset.label;
    const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return schedule.weekdays.map((d) => names[d]).join(' / ');
}
