/**
 * Pulls a scripture reference out of a pasted line, ignoring list markers
 * ("1.", "-", "Day 3:") and extra spreadsheet columns ("Feb 2<TAB>Matthew 1").
 */
export function extractReference(line) {
    const cells = line.split('\t').map((c) => c.trim()).filter(Boolean);
    const cell = [...cells].reverse().find((c) => /[A-Za-z].*\d/.test(c)) ?? cells[0] ?? '';
    return cell.replace(/^\s*(?:day\s*\d+\s*[:.)-]?\s*|\d+\s*[.)]\s+|[-*•]\s+)/i, '').trim();
}
