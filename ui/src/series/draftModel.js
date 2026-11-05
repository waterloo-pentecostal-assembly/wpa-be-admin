// The editable draft that the builder autosaves. It is compiled into the
// final { bible_series, series_content } JSON by compile.js.
//
// draft = {
//   schemaVersion: 1,
//   meta:      { title, sub_title, image_gs_location, is_active, is_visible },
//   schedule:  see schedule.js,
//   engagementPlan: [{ type, weekdays }]   // which engagements each weekday starts with, in order
//   templates: { [typeId]: { title, blocks: Block[] } },
//   days: [{ id, date, reading: { ref, title } | null, engagements: Engagement[] }],
// Publish records are not part of the draft: the server keeps them in the
// draft document's `publishes` field (see src/services/publishService.js).
// }
//
// Engagement = { id, type, linked: true, values: { [blockId]: BlockValue } }
//            | { id, type, linked: false, title, blocks: Block[] }
// A linked engagement renders its type's template; template blocks marked
// `perDay` take their content from `values` instead.
//
// Block = { id, kind: 'text' | 'question', text, title?, perDay? }
//       | { id, kind: 'link', text, url, perDay? }
//       | { id, kind: 'scripture', source: 'reading' | 'passage', ref?, title?, perDay? }
//       | { id, kind: 'image_input' }

import { TYPE_BY_ID } from './engagementTypes.js';
import { generateDates, normalizeSchedule } from './schedule.js';
import { formatShort, weekdayOf } from './dates.js';

export const SCHEMA_VERSION = 1;

export function newId(prefix = 'id') {
    const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
    return `${prefix}_${random.replace(/-/g, '').slice(0, 12)}`;
}

export function withIds(blocks) {
    return blocks.map((b) => ({ ...b, id: b.id ?? newId('b') }));
}

export function createTemplate(typeId) {
    const def = TYPE_BY_ID[typeId];
    return { title: '', blocks: withIds(def?.blocks ?? [{ kind: 'text', text: '' }]) };
}

export function newEngagement(typeId) {
    return { id: newId('e'), type: typeId, linked: true, values: {} };
}

export function emptyDay(date, types = []) {
    return { id: newId('d'), date, reading: null, engagements: types.map(newEngagement) };
}

// ---------- Engagement plan (which engagements each weekday has) ----------

export const ALL_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

/** Engagement types a day on `date` starts with, in plan order. */
export function typesForDate(plan, date) {
    const weekday = weekdayOf(date);
    return (plan ?? []).filter((p) => p.weekdays.includes(weekday)).map((p) => p.type);
}

/**
 * Upgrades drafts saved by earlier versions: flat `defaultTypes` become an
 * every-day engagement plan, and the old in-draft `publishHistory` (now kept
 * by the server on the draft document) is dropped.
 */
export function migrateDraft(draft) {
    if (!draft || (draft.engagementPlan && !('publishHistory' in draft))) return draft;
    const { defaultTypes = [], publishHistory: _old, ...rest } = draft;
    return {
        ...rest,
        engagementPlan: rest.engagementPlan ?? defaultTypes.map((type) => ({ type, weekdays: [...ALL_WEEKDAYS] })),
    };
}

/**
 * @param {object} options
 * @param {Array<{ type: string, weekdays: number[] }>} [options.engagementPlan]
 *   e.g. [{ type: 'read', weekdays: [1,2,3,4,5] }, { type: 'devotional', weekdays: [1] }]
 */
export function createDraft({ title = '', schedule, engagementPlan } = {}) {
    const normalized = normalizeSchedule(schedule);
    const plan = engagementPlan ?? ['read', 'reflect', 'prayer'].map((type) => ({ type, weekdays: [...ALL_WEEKDAYS] }));
    const templates = {};
    for (const { type } of plan) templates[type] = createTemplate(type);
    return {
        schemaVersion: SCHEMA_VERSION,
        meta: { title, sub_title: '', image_gs_location: '', is_active: false, is_visible: false },
        schedule: normalized,
        engagementPlan: plan,
        templates,
        days: generateDates(normalized).map((date) => emptyDay(date, typesForDate(plan, date))),
    };
}

/** Ensures every engagement type used in the draft has a template. */
export function ensureTemplates(draft, types) {
    const missing = types.filter((t) => !draft.templates[t]);
    if (!missing.length) return draft;
    const templates = { ...draft.templates };
    for (const t of missing) templates[t] = createTemplate(t);
    return { ...draft, templates };
}

// ---------- Reading engagement content ----------

/** The blocks an engagement renders, with per-day values applied. */
export function effectiveBlocks(draft, engagement) {
    if (!engagement.linked) return engagement.blocks ?? [];
    const template = draft.templates[engagement.type];
    if (!template) return [];
    return template.blocks.map((block) => {
        if (!block.perDay) return block;
        const value = engagement.values?.[block.id];
        return value ? { ...block, ...value, perDay: false, fromDay: true } : { ...block, perDay: false, fromDay: true, missing: true };
    });
}

export function effectiveTitle(draft, engagement) {
    return engagement.linked ? (draft.templates[engagement.type]?.title ?? '') : (engagement.title ?? '');
}

export function perDayBlocks(draft, typeId) {
    return (draft.templates[typeId]?.blocks ?? []).filter((b) => b.perDay);
}

/** True when a day has content that would be lost if the day were removed. */
export function dayHasContent(day) {
    if (day.reading?.ref) return true;
    return day.engagements.some((e) => !e.linked || Object.values(e.values ?? {}).some(hasValue));
}

function hasValue(value) {
    return Object.entries(value ?? {}).some(([k, v]) => k !== 'title' && typeof v === 'string' && v.trim() !== '');
}

// ---------- Immutable updates ----------

export function updateDay(draft, dayId, fn) {
    return { ...draft, days: draft.days.map((d) => (d.id === dayId ? fn(d) : d)) };
}

export function updateEngagement(draft, dayId, engagementId, fn) {
    return updateDay(draft, dayId, (day) => ({
        ...day,
        engagements: day.engagements.map((e) => (e.id === engagementId ? fn(e) : e)),
    }));
}

export function addEngagement(draft, dayId, typeId) {
    const next = ensureTemplates(draft, [typeId]);
    return updateDay(next, dayId, (day) => ({
        ...day,
        engagements: insertInPlanOrder(day.engagements, newEngagement(typeId), next.engagementPlan),
    }));
}

export function removeEngagement(draft, dayId, engagementId) {
    return updateDay(draft, dayId, (day) => ({
        ...day,
        engagements: day.engagements.filter((e) => e.id !== engagementId),
    }));
}

export function moveEngagement(draft, dayId, engagementId, delta) {
    return updateDay(draft, dayId, (day) => {
        const list = [...day.engagements];
        const from = list.findIndex((e) => e.id === engagementId);
        const to = from + delta;
        if (from < 0 || to < 0 || to >= list.length) return day;
        [list[from], list[to]] = [list[to], list[from]];
        return { ...day, engagements: list };
    });
}

/** Turns a linked engagement into an independent copy of its content. */
export function detachEngagement(draft, dayId, engagementId) {
    return updateEngagement(draft, dayId, engagementId, (e) => {
        if (!e.linked) return e;
        const blocks = effectiveBlocks(draft, e).map((b) => {
            const copy = { ...b, id: newId('b') };
            delete copy.fromDay;
            delete copy.missing;
            return copy;
        });
        return { id: e.id, type: e.type, linked: false, title: effectiveTitle(draft, e), blocks };
    });
}

/** Re-links a custom engagement to its template, discarding custom content. */
export function relinkEngagement(draft, dayId, engagementId) {
    const engagement = draft.days.find((d) => d.id === dayId)?.engagements.find((e) => e.id === engagementId);
    if (!engagement) return draft;
    return updateEngagement(ensureTemplates(draft, [engagement.type]), dayId, engagementId, (e) => ({
        id: e.id, type: e.type, linked: true, values: {},
    }));
}

export function setEngagementValue(draft, dayId, engagementId, blockId, patch) {
    return updateEngagement(draft, dayId, engagementId, (e) => ({
        ...e,
        values: { ...e.values, [blockId]: { ...(e.values?.[blockId] ?? {}), ...patch } },
    }));
}

export function updateTemplate(draft, typeId, fn) {
    const current = draft.templates[typeId] ?? createTemplate(typeId);
    return { ...draft, templates: { ...draft.templates, [typeId]: fn(current) } };
}

/** How many days currently render the given type from its template. */
export function linkedCount(draft, typeId) {
    return draft.days.filter((d) => d.engagements.some((e) => e.type === typeId && e.linked)).length;
}

/**
 * Inserts an engagement where the plan order says it belongs (e.g. a new
 * Devotional goes after Read, not at the end); unplanned types go last.
 */
function insertInPlanOrder(engagements, engagement, plan) {
    const order = (plan ?? []).map((p) => p.type);
    const rank = order.indexOf(engagement.type);
    if (rank < 0) return [...engagements, engagement];
    const index = engagements.findIndex((e) => {
        const r = order.indexOf(e.type);
        return r < 0 || r > rank;
    });
    return index < 0 ? [...engagements, engagement] : [...engagements.slice(0, index), engagement, ...engagements.slice(index)];
}

/** Days whose engagement for `type` would be added/removed by toggling `weekday`. */
export function weekdayToggleImpact(draft, type, weekday) {
    const on = (draft.engagementPlan ?? []).find((p) => p.type === type)?.weekdays.includes(weekday) ?? false;
    const days = draft.days.filter((d) => weekdayOf(d.date) === weekday);
    if (on) {
        const affected = days.filter((d) => d.engagements.some((e) => e.type === type));
        const withContent = affected.filter((d) => d.engagements.some((e) => e.type === type && (!e.linked || Object.values(e.values ?? {}).some(hasValue))));
        return { adding: false, count: affected.length, withContent: withContent.length };
    }
    return { adding: true, count: days.filter((d) => !d.engagements.some((e) => e.type === type)).length, withContent: 0 };
}

/**
 * Turns an engagement type on or off for one weekday: updates the plan and
 * adds it to (or removes it from) every existing day on that weekday.
 * Other weekdays are left exactly as they are.
 */
export function toggleTypeWeekday(draft, type, weekday) {
    const plan = draft.engagementPlan ?? [];
    const existing = plan.find((p) => p.type === type);
    const turningOn = !existing?.weekdays.includes(weekday);
    const nextPlan = existing
        ? plan.map((p) => (p.type === type
            ? { ...p, weekdays: turningOn ? [...p.weekdays, weekday].sort() : p.weekdays.filter((w) => w !== weekday) }
            : p))
        : [...plan, { type, weekdays: [weekday] }];
    const next = { ...ensureTemplates(draft, [type]), engagementPlan: nextPlan };
    return {
        ...next,
        days: next.days.map((day) => {
            if (weekdayOf(day.date) !== weekday) return day;
            const has = day.engagements.some((e) => e.type === type);
            if (turningOn && !has) return { ...day, engagements: insertInPlanOrder(day.engagements, newEngagement(type), nextPlan) };
            if (!turningOn && has) return { ...day, engagements: day.engagements.filter((e) => e.type !== type) };
            return day;
        }),
    };
}

/** Moves a type up/down in the plan and reorders every day's engagements to match. */
export function movePlanType(draft, type, delta) {
    const plan = [...(draft.engagementPlan ?? [])];
    const from = plan.findIndex((p) => p.type === type);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= plan.length) return draft;
    [plan[from], plan[to]] = [plan[to], plan[from]];
    const order = plan.map((p) => p.type);
    const rank = (e) => {
        const r = order.indexOf(e.type);
        return r < 0 ? order.length : r;
    };
    return {
        ...draft,
        engagementPlan: plan,
        days: draft.days.map((day) => ({
            ...day,
            engagements: day.engagements.map((e, i) => ({ e, i })).sort((a, b) => rank(a.e) - rank(b.e) || a.i - b.i).map(({ e }) => e),
        })),
    };
}

/** Removes a type from the plan and from every day. */
export function removeTypeEverywhere(draft, type) {
    return {
        ...draft,
        engagementPlan: (draft.engagementPlan ?? []).filter((p) => p.type !== type),
        days: draft.days.map((day) => ({ ...day, engagements: day.engagements.filter((e) => e.type !== type) })),
    };
}

// ---------- Copying ----------

function cloneEngagement(engagement) {
    const copy = structuredClone(engagement);
    copy.id = newId('e');
    if (!copy.linked) copy.blocks = copy.blocks.map((b) => ({ ...b, id: newId('b') }));
    return copy;
}

/**
 * Copies an engagement to other days. On each target day an engagement of
 * the same type is replaced (keeping its position); otherwise it is added.
 */
export function copyEngagementToDays(draft, sourceDayId, engagementId, targetDayIds) {
    const source = draft.days.find((d) => d.id === sourceDayId)?.engagements.find((e) => e.id === engagementId);
    if (!source) return draft;
    const targets = new Set(targetDayIds.filter((id) => id !== sourceDayId));
    return {
        ...draft,
        days: draft.days.map((day) => {
            if (!targets.has(day.id)) return day;
            const copy = cloneEngagement(source);
            const index = day.engagements.findIndex((e) => e.type === source.type);
            const engagements = [...day.engagements];
            if (index >= 0) engagements[index] = copy;
            else engagements.push(copy);
            return { ...day, engagements };
        }),
    };
}

/** Copies a day's reading to other days. */
export function copyReadingToDays(draft, sourceDayId, targetDayIds) {
    const reading = draft.days.find((d) => d.id === sourceDayId)?.reading ?? null;
    const targets = new Set(targetDayIds);
    return {
        ...draft,
        days: draft.days.map((d) => (targets.has(d.id) ? { ...d, reading: reading ? { ...reading } : null } : d)),
    };
}

/** Assigns readings to consecutive days starting at `startIndex`. */
export function assignReadings(draft, startIndex, refs) {
    return {
        ...draft,
        days: draft.days.map((d, i) => {
            const ref = refs[i - startIndex];
            return i >= startIndex && ref ? { ...d, reading: { ref, title: '' } } : d;
        }),
    };
}

// ---------- Schedule changes ----------

/**
 * Applies a new schedule. `strategy` decides what happens to existing days
 * when the dates change:
 *   'order' - keep days in sequence (day 1 stays day 1 on the new start date)
 *   'date'  - keep content on its calendar date; removed dates are dropped
 */
export function applySchedule(draft, schedule, strategy = 'order') {
    const normalized = normalizeSchedule(schedule);
    const dates = generateDates(normalized);
    let days;
    if (strategy === 'date') {
        const byDate = new Map(draft.days.map((d) => [d.date, d]));
        days = dates.map((date) => byDate.get(date) ?? emptyDay(date, typesForDate(draft.engagementPlan, date)));
    } else {
        days = dates.map((date, i) => (draft.days[i] ? { ...draft.days[i], date } : emptyDay(date, typesForDate(draft.engagementPlan, date))));
    }
    return { ...draft, schedule: normalized, days };
}

/** Days that would lose content under each strategy (for confirmation UI). */
export function scheduleChangeImpact(draft, schedule) {
    const dates = generateDates(normalizeSchedule(schedule));
    const dateSet = new Set(dates);
    const withContent = draft.days.filter(dayHasContent);
    return {
        newCount: dates.length,
        lostByOrder: draft.days.slice(dates.length).filter(dayHasContent),
        lostByDate: withContent.filter((d) => !dateSet.has(d.date)),
        datesChanged: dates.length !== draft.days.length || dates.some((d, i) => draft.days[i]?.date !== d),
    };
}

export function describeDay(day) {
    return `${formatShort(day.date)}${day.reading?.ref ? ` · ${day.reading.ref}` : ''}`;
}
