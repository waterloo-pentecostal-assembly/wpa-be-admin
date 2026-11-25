// Day arithmetic for featured content, on YYYY-MM-DD strings (which sort as dates).

/** YYYY-MM-DD for today (browser time). */
export const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const addDays = (day, n) => {
    const d = new Date(`${day}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
};

/**
 * The day within start..end (both included) when the most `items` show
 * ({ start, end } days): { count, day, items }, count 0 if none overlap.
 * The server makes the same check when saving.
 */
export function busiestDay(items, start, end) {
    let best = { count: 0, day: null, items: [] };
    if (!start || !end || end < start) return best;
    const overlapping = items.filter((item) => item.start <= end && item.end >= start);
    for (let day = start; day <= end; day = addDays(day, 1)) {
        const showing = overlapping.filter((item) => item.start <= day && item.end >= day);
        if (showing.length > best.count) best = { count: showing.length, day, items: showing };
    }
    return best;
}
