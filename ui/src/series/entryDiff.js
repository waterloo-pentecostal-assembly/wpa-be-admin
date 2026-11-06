// Readable line form of series content entries and a line/word diff, for
// reviewing an update to a published series. The server sends entries as
// lines (entryLines); the browser diffs them (diffLines).

// Trailing spaces would otherwise make two lines look identical.
const showTrailing = (text) => String(text).replace(/\s+$/, (m) => '·'.repeat(m.length));

function value(v) {
    return typeof v === 'string' ? showTrailing(v) : JSON.stringify(v);
}

/** Lines for keys a block has besides `known`, so every difference shows. */
function otherKeys(object, known) {
    return Object.keys(object ?? {})
        .filter((k) => !known.includes(k))
        .sort()
        .map((k) => `${k}: ${value(object[k])}`);
}

function blockLines(block) {
    if (!block || typeof block !== 'object') return [value(block)];
    const heading = (label) => `— ${label}${block.title ? `: ${showTrailing(block.title)}` : ''}`;
    switch (block.body_type) {
        case 'text':
            return [heading('Text'), ...(block.paragraphs ?? []).map(value), ...otherKeys(block, ['body_type', 'title', 'paragraphs'])];
        case 'question':
            return [heading('Questions'), ...(block.questions ?? []).map(value), ...otherKeys(block, ['body_type', 'title', 'questions'])];
        case 'link':
            return ['— Link', `${value(block.text ?? '')} → ${value(block.link ?? '')}`, ...otherKeys(block, ['body_type', 'text', 'link'])];
        case 'scripture':
            return [
                '— Scripture',
                ...(block.scriptures ?? []).flatMap((s) => [
                    `${s.book} ${s.chapter} · title: ${s.title === undefined ? '(none)' : value(s.title) || '(blank)'}`,
                    ...Object.keys(s.verses ?? {})
                        .sort((a, b) => Number(a) - Number(b))
                        .map((n) => `${n}  ${value(s.verses[n])}`),
                    ...otherKeys(s, ['book', 'chapter', 'title', 'verses']),
                ]),
                ...otherKeys(block, ['body_type', 'scriptures']),
            ];
        case 'image_input':
            return ['— Image input', ...otherKeys(block, ['body_type'])];
        default:
            return [`— ${block.body_type ?? 'Block'}`, ...otherKeys(block, ['body_type'])];
    }
}

/** An entry's title and body as lines of text. */
export function entryLines(entry) {
    const body = Array.isArray(entry?.body) ? entry.body.flatMap(blockLines) : [`body: ${value(entry?.body)}`];
    return [`Title: ${value(entry?.title ?? '')}`, ...body];
}

// Longest common subsequence table; callers keep inputs small.
function lcs(a, b) {
    const table = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
    for (let i = a.length - 1; i >= 0; i--) {
        for (let j = b.length - 1; j >= 0; j--) {
            table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
        }
    }
    return table;
}

function diffSequence(a, b) {
    if (a.length * b.length > 2_000_000) {
        return [...a.map((text) => ({ type: 'del', text })), ...b.map((text) => ({ type: 'add', text }))];
    }
    const table = lcs(a, b);
    const ops = [];
    let i = 0;
    let j = 0;
    while (i < a.length && j < b.length) {
        if (a[i] === b[j]) {
            ops.push({ type: 'same', text: a[i] });
            i++;
            j++;
        } else if (table[i + 1][j] >= table[i][j + 1]) {
            ops.push({ type: 'del', text: a[i++] });
        } else {
            ops.push({ type: 'add', text: b[j++] });
        }
    }
    while (i < a.length) ops.push({ type: 'del', text: a[i++] });
    while (j < b.length) ops.push({ type: 'add', text: b[j++] });
    return ops;
}

/** Word-level diff of two lines: segments of [{ text, changed }] for each side. */
export function diffWords(before, after) {
    const a = before.split(/(\s+)/).filter(Boolean);
    const b = after.split(/(\s+)/).filter(Boolean);
    const ops = a.length * b.length > 250_000 ? null : diffSequence(a, b);
    const side = (keep) => {
        if (!ops) return [{ text: keep === 'del' ? before : after, changed: true }];
        const segments = [];
        for (const op of ops) {
            if (op.type !== 'same' && op.type !== keep) continue;
            const changed = op.type !== 'same';
            const last = segments.at(-1);
            if (last && last.changed === changed) last.text += op.text;
            else segments.push({ text: op.text, changed });
        }
        // Highlight "the church" as one change, not two around a space.
        for (let i = segments.length - 2; i > 0; i--) {
            if (!segments[i].changed && !segments[i].text.trim() && segments[i - 1].changed && segments[i + 1].changed) {
                segments.splice(i - 1, 3, { text: segments[i - 1].text + segments[i].text + segments[i + 1].text, changed: true });
                i--;
            }
        }
        return segments;
    };
    return { before: side('del'), after: side('add') };
}

/**
 * Line diff with unchanged runs beyond `context` lines collapsed. Removed and
 * added lines that replace each other carry word-level `segments`.
 *
 * @returns {Array<{ type: 'same'|'del'|'add', text: string, segments?: Array<{ text: string, changed: boolean }> }
 *   | { type: 'skip', count: number }>}
 */
export function diffLines(before, after, { context = 2 } = {}) {
    const ops = diffSequence(before, after);

    // Pair the removed and added lines of each changed run for word highlights.
    for (let i = 0; i < ops.length;) {
        if (ops[i].type === 'same') {
            i++;
            continue;
        }
        let end = i;
        while (end < ops.length && ops[end].type !== 'same') end++;
        const dels = ops.slice(i, end).filter((op) => op.type === 'del');
        const adds = ops.slice(i, end).filter((op) => op.type === 'add');
        for (let k = 0; k < Math.min(dels.length, adds.length); k++) {
            const words = diffWords(dels[k].text, adds[k].text);
            dels[k].segments = words.before;
            adds[k].segments = words.after;
        }
        i = end;
    }

    const near = ops.map(() => false);
    ops.forEach((op, i) => {
        if (op.type === 'same') return;
        for (let k = Math.max(0, i - context); k <= Math.min(ops.length - 1, i + context); k++) near[k] = true;
    });
    const result = [];
    ops.forEach((op, i) => {
        if (near[i]) {
            result.push(op);
        } else if (result.at(-1)?.type === 'skip') {
            result.at(-1).count++;
        } else {
            result.push({ type: 'skip', count: 1 });
        }
    });
    return result;
}
