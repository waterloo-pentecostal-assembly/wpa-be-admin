// Compiles a draft into the final JSON consumed by the app and the Firebase
// loader:
//   { bible_series: { title, sub_title, image_gs_location, is_active, is_visible },
//     series_content: [{ title, content_type, date, body: [...] }] }
//
// Scripture text comes from a `lookup(ref)` function returning
//   { ok: true, label, passages } | { ok: false, error }
// (see passageCache.js), so compiling itself is synchronous and pure.

import { effectiveBlocks, effectiveTitle } from './draftModel.js';
import { SCRIPTURE_TOKEN, typeLabel } from './engagementTypes.js';
import { formatVerseRanges, passagesToScriptures, scriptureBodyBlock, splitReference } from './scriptureRefs.js';

/** Every scripture reference the draft needs resolved. */
export function collectRefs(draft) {
    const refs = new Set();
    for (const day of draft.days) {
        if (day.reading?.ref) refs.add(day.reading.ref.trim());
        for (const engagement of day.engagements) {
            for (const block of effectiveBlocks(draft, engagement)) {
                if (block.kind === 'scripture' && block.source === 'passage' && block.ref) refs.add(block.ref.trim());
            }
        }
    }
    for (const template of Object.values(draft.templates)) {
        for (const block of template.blocks) {
            if (block.kind === 'scripture' && block.source === 'passage' && !block.perDay && block.ref) refs.add(block.ref.trim());
        }
    }
    return [...refs];
}

export function usesScriptureToken(text) {
    return typeof text === 'string' && text.includes(SCRIPTURE_TOKEN);
}

function toLines(text) {
    return (text ?? '').split('\n').map((l) => l.trimEnd()).filter((l) => l.trim() !== '');
}

function readingLabel(day, lookup) {
    if (!day.reading?.ref) return null;
    const resolved = lookup(day.reading.ref.trim());
    return resolved?.ok ? resolved.label : day.reading.ref.trim();
}

/**
 * Compiles one engagement on one day.
 * @returns {{ entry: object, issues: Array<{ level: 'error'|'warning'|'pending', message: string }> }}
 */
export function compileEngagement(draft, day, engagement, lookup) {
    const issues = [];
    const name = typeLabel(engagement.type);
    const label = readingLabel(day, lookup);
    const body = [];

    const substitute = (text) => {
        if (!usesScriptureToken(text)) return text;
        if (!label) {
            issues.push({ level: 'error', code: 'no-reading', message: `${name}: uses {scripture} but the day has no scripture` });
            return text;
        }
        return text.split(SCRIPTURE_TOKEN).join(label);
    };

    for (const block of effectiveBlocks(draft, engagement)) {
        switch (block.kind) {
            case 'text': {
                const paragraphs = toLines(block.text).map(substitute);
                if (!paragraphs.length) {
                    if (block.fromDay) issues.push({ level: 'warning', message: `${name}: per-day text is empty` });
                    break;
                }
                body.push(block.title ? { title: block.title, paragraphs, body_type: 'text' } : { paragraphs, body_type: 'text' });
                break;
            }
            case 'question': {
                const questions = toLines(block.text).map(substitute);
                if (!questions.length) {
                    issues.push({ level: 'warning', message: `${name}: no questions` });
                    break;
                }
                body.push(block.title ? { title: block.title, body_type: 'question', questions } : { body_type: 'question', questions });
                break;
            }
            case 'link': {
                if (!block.url?.trim()) {
                    issues.push({ level: 'warning', message: `${name}: link URL is empty` });
                    break;
                }
                body.push({ text: substitute(block.text?.trim() || block.url.trim()), link: block.url.trim(), body_type: 'link' });
                break;
            }
            case 'scripture': {
                const ref = block.source === 'reading' ? day.reading?.ref?.trim() : block.ref?.trim();
                if (!ref) {
                    issues.push({
                        level: block.source === 'reading' ? 'error' : 'warning',
                        ...(block.source === 'reading' ? { code: 'no-reading' } : {}),
                        message: block.source === 'reading'
                            ? `${name}: needs the day's scripture`
                            : `${name}: scripture passage not set`,
                    });
                    break;
                }
                const resolved = lookup(ref);
                if (!resolved) {
                    // Still being looked up; callers resolve every ref before publishing.
                    issues.push({ level: 'pending', message: `${name}: looking up "${ref}"` });
                    break;
                }
                if (!resolved.ok) {
                    issues.push({
                        level: 'error',
                        ...(block.source === 'reading' ? { code: 'bad-reading' } : {}),
                        message: `${name}: ${resolved.error}`,
                    });
                    break;
                }
                const title = block.source === 'reading' ? (day.reading?.title ?? '') : (block.title ?? '');
                body.push(scriptureBodyBlock(passagesToScriptures(resolved.passages, title)));
                break;
            }
            case 'image_input':
                body.push({ body_type: 'image_input' });
                break;
            default:
                break;
        }
    }

    if (!body.length) issues.push({ level: 'warning', message: `${name}: has no content` });

    const seen = new Set();
    const unique = issues.filter((i) => !seen.has(i.message) && seen.add(i.message));

    return {
        entry: {
            title: substitute(effectiveTitle(draft, engagement) ?? ''),
            content_type: engagement.type,
            date: day.date,
            body,
        },
        issues: unique,
    };
}

/**
 * @returns {{ json: { bible_series, series_content }, issues: Array<{ level, message, dayId, engagementId? }> }}
 */
export function compileDraft(draft, lookup) {
    const issues = [];
    const seriesContent = [];
    const meta = draft.meta ?? {};

    if (!meta.title?.trim()) issues.push({ level: 'error', message: 'Series title is empty', dayId: null });
    if (!meta.image_gs_location?.trim()) issues.push({ level: 'warning', message: 'No cover image', dayId: null });

    const days = [...draft.days].sort((a, b) => a.date.localeCompare(b.date));
    for (const day of days) {
        if (!day.engagements.length) {
            issues.push({ level: 'warning', message: 'No engagements', dayId: day.id });
            continue;
        }
        if (day.reading?.ref) {
            const resolved = lookup(day.reading.ref.trim());
            if (resolved && !resolved.ok) issues.push({ level: 'error', message: `Scripture: ${resolved.error}`, dayId: day.id });
        }
        let needsReading = false;
        for (const engagement of day.engagements) {
            const { entry, issues: engagementIssues } = compileEngagement(draft, day, engagement, lookup);
            for (const issue of engagementIssues) {
                // Problems with the day's scripture are reported once for the day, not per engagement.
                if (issue.code === 'no-reading') needsReading = true;
                else if (issue.code !== 'bad-reading') issues.push({ ...issue, dayId: day.id, engagementId: engagement.id });
            }
            if (entry.body.length) seriesContent.push(entry);
        }
        if (needsReading) issues.push({ level: 'error', code: 'no-reading', message: 'No scripture for this day', dayId: day.id });
    }

    return {
        json: {
            bible_series: {
                title: meta.title?.trim() ?? '',
                sub_title: meta.sub_title?.trim() ?? '',
                image_gs_location: meta.image_gs_location?.trim() ?? '',
                is_active: !!meta.is_active,
                is_visible: !!meta.is_visible,
            },
            series_content: seriesContent,
        },
        issues,
    };
}

/**
 * Reference text with explicit verse ranges per chapter, the way series
 * pre-texts are written: "Matthew 1:1-25", "1 Kings 3:1-28; 4:1-34".
 */
export function passageLabel(passage) {
    const byChapter = new Map();
    for (const v of passage.verses) {
        if (!byChapter.has(v.chapter)) byChapter.set(v.chapter, []);
        byChapter.get(v.chapter).push(v.verse);
    }
    const parts = [...byChapter].map(([chapter, verses]) => `${chapter}:${formatVerseRanges(verses)}`);
    return `${passage.book} ${parts.join('; ')}`;
}

/** Builds a lookup function from batch-resolved single-book passages. */
export function createLookup(resolvedSingles) {
    return (ref) => {
        const parts = splitReference(ref);
        if (!parts.length) return { ok: false, error: 'Empty reference' };
        const passages = [];
        for (const part of parts) {
            const result = resolvedSingles.get(part);
            if (!result) return null;
            if (!result.ok) return { ok: false, error: result.error };
            passages.push(result.passage);
        }
        return { ok: true, label: passages.map(passageLabel).join('; '), passages };
    };
}
