// Placeholders that personalize a notification's title and message, e.g.
// "Hi {first_name}, you're {percent} through {series_title}". Shared by the
// Notification Hub page (insert list, live preview) and the server
// (src/services/notificationHubService.js), so what the preview shows is what
// is sent. Pure functions only: no React, no Node APIs.
//
// Syntax: {key}, or {key|fallback} to use the fallback when the recipient
// has no value (e.g. {first_name|friend}). An empty value with no fallback
// is dropped along with the space before it, so "Hi {first_name}, welcome"
// becomes "Hi, welcome".

export const PLACEHOLDERS = [
    { key: 'first_name', group: 'user', label: 'First name', example: 'Mary' },
    { key: 'last_name', group: 'user', label: 'Last name', example: 'Jones' },
    { key: 'full_name', group: 'user', label: 'Full name', example: 'Mary Jones' },
    { key: 'series_title', group: 'series', label: 'Series title', example: 'Matthew' },
    { key: 'total_days', group: 'series', label: 'Days in the series', example: '40' },
    { key: 'percent', group: 'progress', label: 'Their progress', example: '35%' },
    { key: 'expected_percent', group: 'progress', label: 'Expected progress', example: '40%' },
    { key: 'percent_behind', group: 'progress', label: 'How far behind expected', example: '5%' },
    { key: 'percent_ahead', group: 'progress', label: 'How far ahead of expected', example: '0%' },
    { key: 'percent_left', group: 'progress', label: 'Progress still to go', example: '65%' },
];

export const PLACEHOLDER_GROUPS = [
    { group: 'user', label: 'User' },
    { group: 'series', label: 'Current series' },
    { group: 'progress', label: 'Their series progress' },
];

const KNOWN = new Map(PLACEHOLDERS.map((p) => [p.key, p]));
const pattern = () => /\{\s*([A-Za-z_]+)\s*(?:\|([^{}]*))?\}/g;
const EMPTY = '\uE000'; // marks an empty value until the spacing around it is tidied

/** The placeholders used in some text: [{ key, fallback, known, group }]. */
export function findPlaceholders(text) {
    return [...String(text ?? '').matchAll(pattern())].map(([, rawKey, fallback]) => {
        const key = rawKey.toLowerCase();
        return { key, fallback: fallback?.trim(), known: KNOWN.has(key), group: KNOWN.get(key)?.group ?? null };
    });
}

/** Unknown placeholder keys used in any of the texts. */
export function unknownPlaceholders(...texts) {
    return [...new Set(texts.flatMap(findPlaceholders).filter((p) => !p.known).map((p) => p.key))];
}

/** Whether any of the texts use a placeholder of the group ('user', 'series' or 'progress'). */
export function usesGroup(group, ...texts) {
    return texts.flatMap(findPlaceholders).some((p) => p.group === group);
}

/** Fills in placeholders from `values` (key -> string). Unknown placeholders are left as typed. */
export function renderTemplate(text, values = {}) {
    const out = String(text ?? '').replace(pattern(), (match, rawKey, fallback) => {
        const key = rawKey.toLowerCase();
        if (!KNOWN.has(key)) return match;
        const value = values[key];
        if (value !== undefined && value !== null && String(value) !== '') return String(value);
        if (fallback !== undefined && fallback.trim()) return fallback.trim();
        return EMPTY;
    });
    if (!out.includes(EMPTY)) return out;
    return out
        .replace(/[ \t]*\uE000(?=[,.!?;:])/g, '') // "Hi {first_name}, …" -> "Hi, …"
        .replace(/[ \t]*\uE000[ \t]*/g, ' ')
        .replace(/^ +| +$/gm, '');
}

const pct = (n) => (typeof n === 'number' ? `${Math.round(n)}%` : '');
const num = (n) => (typeof n === 'number' ? String(n) : '');

/**
 * One recipient's values.
 * @param {{ user?: { firstName?: string, lastName?: string, name?: string }|null,
 *   progress?: { percent: number, expectedPercent: number, behindPoints: number, aheadPoints: number }|null,
 *   series?: { title?: string, totalDays?: number }|null }} sources
 */
export function placeholderValues({ user = null, progress = null, series = null } = {}) {
    const firstName = user?.firstName || (user?.name ? user.name.split(/\s+/)[0] : '');
    const totalDays = series?.totalDays;
    return {
        first_name: firstName ?? '',
        last_name: user?.lastName ?? '',
        full_name: user?.name || [user?.firstName, user?.lastName].filter(Boolean).join(' '),
        series_title: series?.title ?? '',
        total_days: num(totalDays),
        percent: pct(progress?.percent),
        expected_percent: pct(progress?.expectedPercent),
        percent_behind: pct(progress?.behindPoints),
        percent_ahead: pct(progress?.aheadPoints),
        percent_left: progress ? pct(Math.max(0, 100 - progress.percent)) : '',
    };
}

/** The example values shown before a real recipient is picked. */
export const EXAMPLE_VALUES = Object.fromEntries(PLACEHOLDERS.map((p) => [p.key, p.example]));
