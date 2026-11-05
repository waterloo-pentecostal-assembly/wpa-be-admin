// Imports an existing { bible_series, series_content } JSON file into a
// draft. Repeated content is turned into linked templates automatically:
// for each engagement type, blocks that are the same on most days become
// template blocks and blocks that vary become per-day fields.

import { isIsoDate, weekdayOf } from './dates.js';
import { SCHEMA_VERSION, createTemplate, newId, withIds } from './draftModel.js';
import { SCRIPTURE_TOKEN } from './engagementTypes.js';
import { formatVerseRanges, referenceFromScriptures } from './scriptureRefs.js';
import { inferSchedule } from './schedule.js';

function autoTitle(s) {
    return `${s.book} ${s.chapter}:${formatVerseRanges(Object.keys(s.verses ?? {}))}`;
}

function findReading(entries) {
    const ordered = [...entries.filter((e) => e.content_type === 'read'), ...entries];
    for (const entry of ordered) {
        const block = (entry.body ?? []).find((b) => b.body_type === 'scripture' && b.scriptures?.length);
        if (block) {
            const first = block.scriptures[0];
            const title = first.title && first.title !== autoTitle(first) ? first.title : '';
            return { ref: referenceFromScriptures(block.scriptures), title, scriptures: block.scriptures };
        }
    }
    return null;
}

// Ways the day's reading may be written in pre-text. Per-chapter labels are
// only used for single-chapter readings so that "1 Kings 3:1-28 and 4:1-34"
// is not half-replaced.
function readingLabels(reading) {
    if (!reading) return [];
    const labels = new Set([reading.ref]);
    if (reading.scriptures.length === 1) {
        const [s] = reading.scriptures;
        labels.add(autoTitle(s));
        if (s.title) labels.add(s.title);
        const verses = Object.keys(s.verses ?? {}).map(Number).sort((a, b) => a - b);
        if (verses.length) labels.add(`${s.book} ${s.chapter}:${verses[0]}-${verses.at(-1)}`);
    }
    return [...labels].filter((l) => l && l.length > 3).sort((a, b) => b.length - a.length);
}

function tokenize(text, labels) {
    let result = text;
    for (const label of labels) result = result.split(label).join(SCRIPTURE_TOKEN);
    return result;
}

function bodyToBlocks(body, reading, labels) {
    const blocks = [];
    for (const b of body ?? []) {
        switch (b.body_type) {
            case 'text':
                blocks.push({ kind: 'text', text: tokenize((b.paragraphs ?? []).join('\n'), labels), ...(b.title ? { title: b.title } : {}) });
                break;
            case 'question':
                blocks.push({ kind: 'question', text: tokenize((b.questions ?? []).join('\n'), labels), ...(b.title ? { title: b.title } : {}) });
                break;
            case 'link':
                blocks.push({ kind: 'link', text: tokenize(b.text ?? '', labels), url: b.link ?? '' });
                break;
            case 'scripture': {
                const ref = referenceFromScriptures(b.scriptures);
                if (reading && ref === reading.ref) {
                    blocks.push({ kind: 'scripture', source: 'reading' });
                } else {
                    const first = b.scriptures?.[0];
                    const title = first?.title && first.title !== autoTitle(first) ? first.title : '';
                    blocks.push({ kind: 'scripture', source: 'passage', ref, ...(title ? { title } : {}) });
                }
                break;
            }
            case 'image_input':
                blocks.push({ kind: 'image_input' });
                break;
            default:
                break;
        }
    }
    return blocks;
}

const signature = (blocks) => blocks.map((b) => (b.kind === 'scripture' ? `scripture:${b.source}` : b.kind)).join('|');

// The per-day value of a block: everything except identity/structure.
function blockValue(block) {
    switch (block.kind) {
        case 'text':
        case 'question':
            return { text: block.text, ...(block.title ? { title: block.title } : {}) };
        case 'link':
            return { text: block.text, url: block.url };
        case 'scripture':
            return block.source === 'passage' ? { ref: block.ref, ...(block.title ? { title: block.title } : {}) } : {};
        default:
            return {};
    }
}

function mode(values) {
    const counts = new Map();
    for (const v of values) {
        const key = JSON.stringify(v);
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    let best = null;
    for (const [key, count] of counts) if (!best || count > best.count) best = { key, count };
    return best;
}

/** Builds a template for one type from its imported engagements. */
function detectTemplate(items) {
    const groups = new Map();
    for (const item of items) {
        const sig = signature(item.blocks);
        if (!groups.has(sig)) groups.set(sig, []);
        groups.get(sig).push(item);
    }
    const group = [...groups.values()].sort((a, b) => b.length - a.length)[0];
    if (!group || group.length < 2) return null;

    const majority = Math.ceil(group.length / 2);
    const titleMode = mode(group.map((i) => i.title));
    if (titleMode.count < majority) return null;

    const blocks = group[0].blocks.map((block, index) => {
        const values = group.map((i) => blockValue(i.blocks[index]));
        const common = mode(values);
        const shape = { kind: block.kind, ...(block.kind === 'scripture' ? { source: block.source } : {}) };
        if (common.count >= majority) {
            return { ...shape, ...JSON.parse(common.key), id: newId('b') };
        }
        const empty = block.kind === 'link' ? { text: '', url: '' } : block.kind === 'scripture' ? { ref: '' } : { text: '' };
        return { ...shape, ...empty, perDay: true, id: newId('b') };
    });

    return { title: JSON.parse(titleMode.key), blocks, signature: signature(group[0].blocks) };
}

function linkIfMatches(template, item) {
    if (signature(item.blocks) !== template.signature || item.title !== template.title) return null;
    const values = {};
    for (let i = 0; i < template.blocks.length; i++) {
        const tBlock = template.blocks[i];
        const value = blockValue(item.blocks[i]);
        if (tBlock.perDay) {
            values[tBlock.id] = value;
        } else if (JSON.stringify(value) !== JSON.stringify(blockValue(tBlock))) {
            return null;
        }
    }
    return values;
}

/**
 * @returns {{ draft: object, report: { days: number, entries: number, linked: number,
 *   custom: number, skipped: number, templates: string[] } }}
 */
export function importSeriesJson(json) {
    const meta = json?.bible_series ?? (json?.title ? json : {});
    const content = Array.isArray(json?.series_content) ? json.series_content : [];
    const valid = content.filter((e) => isIsoDate(e?.date) && e.content_type);
    const byDate = new Map();
    for (const entry of valid) {
        if (!byDate.has(entry.date)) byDate.set(entry.date, []);
        byDate.get(entry.date).push(entry);
    }
    const dates = [...byDate.keys()].sort();

    // Convert every entry to blocks relative to its day's reading.
    const dayItems = dates.map((date) => {
        const entries = byDate.get(date);
        const reading = findReading(entries);
        const labels = readingLabels(reading);
        return {
            date,
            reading: reading ? { ref: reading.ref, title: reading.title } : null,
            items: entries.map((entry) => ({
                type: entry.content_type,
                title: tokenize(entry.title ?? '', labels),
                blocks: bodyToBlocks(entry.body, reading, labels),
            })),
        };
    });

    const types = [...new Set(dayItems.flatMap((d) => d.items.map((i) => i.type)))];
    const detected = {};
    for (const type of types) {
        detected[type] = detectTemplate(dayItems.flatMap((d) => d.items.filter((i) => i.type === type)));
    }

    let linked = 0;
    let custom = 0;
    const days = dayItems.map(({ date, reading, items }) => ({
        id: newId('d'),
        date,
        reading,
        engagements: items.map((item) => {
            const template = detected[item.type];
            const values = template ? linkIfMatches(template, item) : null;
            if (values) {
                linked++;
                return { id: newId('e'), type: item.type, linked: true, values };
            }
            custom++;
            return { id: newId('e'), type: item.type, linked: false, title: item.title, blocks: withIds(item.blocks) };
        }),
    }));

    const templates = {};
    for (const type of types) {
        const t = detected[type];
        templates[type] = t ? { title: t.title, blocks: t.blocks } : createTemplate(type);
    }

    // A type is planned for a weekday when it appears on at least half of
    // that weekday's days (e.g. Devotional only on Mondays).
    const daysByWeekday = new Map();
    for (const d of dayItems) {
        const w = weekdayOf(d.date);
        if (!daysByWeekday.has(w)) daysByWeekday.set(w, []);
        daysByWeekday.get(w).push(d);
    }
    const engagementPlan = types
        .map((type) => ({
            type,
            weekdays: [...daysByWeekday.entries()]
                .filter(([, list]) => list.filter((d) => d.items.some((i) => i.type === type)).length >= list.length / 2)
                .map(([w]) => w)
                .sort(),
        }))
        .filter((p) => p.weekdays.length);

    return {
        draft: {
            schemaVersion: SCHEMA_VERSION,
            meta: {
                title: meta.title ?? '',
                sub_title: meta.sub_title ?? '',
                image_gs_location: meta.image_gs_location ?? '',
                is_active: !!meta.is_active,
                is_visible: !!meta.is_visible,
            },
            schedule: inferSchedule(dates),
            engagementPlan,
            templates,
            days,
        },
        report: {
            days: days.length,
            entries: valid.length,
            linked,
            custom,
            skipped: content.length - valid.length,
            templates: types.filter((t) => detected[t]),
        },
    };
}
