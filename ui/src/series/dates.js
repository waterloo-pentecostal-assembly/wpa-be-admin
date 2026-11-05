// Date helpers for ISO calendar dates ("YYYY-MM-DD"). All arithmetic is done
// in UTC so a date never shifts because of the browser's time zone.

export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const WEEKDAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value) {
    if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
    return toIso(parseIso(value)) === value;
}

export function parseIso(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
}

export function toIso(date) {
    return date.toISOString().slice(0, 10);
}

export function addDays(iso, days) {
    const date = parseIso(iso);
    date.setUTCDate(date.getUTCDate() + days);
    return toIso(date);
}

export function weekdayOf(iso) {
    return parseIso(iso).getUTCDay();
}

export function todayIso() {
    const now = new Date();
    return toIso(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
}

/** Monday-based start of the week containing `iso`. */
export function startOfWeek(iso) {
    const offset = (weekdayOf(iso) + 6) % 7;
    return addDays(iso, -offset);
}

export function formatShort(iso) {
    const d = parseIso(iso);
    return `${WEEKDAY_SHORT[d.getUTCDay()]} ${MONTH_SHORT[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

export function formatLong(iso) {
    const d = parseIso(iso);
    return `${WEEKDAY_LONG[d.getUTCDay()]}, ${MONTH_SHORT[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

export function formatMonthYear(iso) {
    const d = parseIso(iso);
    return `${MONTH_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
