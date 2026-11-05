import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBibleService } from '../src/services/bibleService.js';
import {
    SCHEDULE_PRESETS, endDateForCount, generateDates, inferSchedule, toggleDate,
} from '../ui/src/series/schedule.js';
import { formatVerseRanges, referenceFromScriptures, splitReference } from '../ui/src/series/scriptureRefs.js';
import {
    ALL_WEEKDAYS, applySchedule, copyEngagementToDays, createDraft, detachEngagement, effectiveBlocks,
    migrateDraft, movePlanType, relinkEngagement, scheduleChangeImpact, setEngagementValue, toggleTypeWeekday,
    updateDay, weekdayToggleImpact,
} from '../ui/src/series/draftModel.js';
import { weekdayOf } from '../ui/src/series/dates.js';
import { collectRefs, compileDraft, createLookup } from '../ui/src/series/compile.js';
import { importSeriesJson } from '../ui/src/series/importSeries.js';
import { extractReference } from '../ui/src/series/planParsing.js';
import { STALE_AFTER_MS, publishState } from '../ui/src/series/publishes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const bible = loadBibleService(path.join(ROOT, 'src', 'data', 'niv.json'));

/** Resolves every reference a draft needs with the real NIV data. */
function lookupFor(draft) {
    const singles = new Map();
    for (const ref of collectRefs(draft)) {
        for (const part of splitReference(ref)) {
            try {
                singles.set(part, { ok: true, passage: bible.getPassage(part) });
            } catch (error) {
                singles.set(part, { ok: false, error: error.message });
            }
        }
    }
    return createLookup(singles);
}

const weekdays = SCHEDULE_PRESETS.find((p) => p.id === 'weekdays').weekdays;

describe('schedule', () => {
    test('weekday preset skips weekends', () => {
        const dates = generateDates({ start: '2026-02-02', end: '2026-02-15', weekdays });
        assert.deepEqual(dates, [
            '2026-02-02', '2026-02-03', '2026-02-04', '2026-02-05', '2026-02-06',
            '2026-02-09', '2026-02-10', '2026-02-11', '2026-02-12', '2026-02-13',
        ]);
    });

    test('toggleDate skips a pattern date and adds an off-pattern date', () => {
        let schedule = { start: '2026-02-02', end: '2026-02-08', weekdays, excluded: [], extra: [] };
        schedule = toggleDate(schedule, '2026-02-04');
        schedule = toggleDate(schedule, '2026-02-07');
        assert.deepEqual(schedule.excluded, ['2026-02-04']);
        assert.deepEqual(schedule.extra, ['2026-02-07']);
        assert.deepEqual(generateDates(schedule), ['2026-02-02', '2026-02-03', '2026-02-05', '2026-02-06', '2026-02-07']);
    });

    test('endDateForCount honours weekdays and exclusions', () => {
        assert.equal(endDateForCount({ start: '2026-02-02', weekdays }, 40), '2026-03-27');
        assert.equal(endDateForCount({ start: '2026-02-02', weekdays: [2, 4], excluded: ['2026-02-05'] }, 3), '2026-02-12');
    });

    test('inferSchedule finds the preset and the skipped days', () => {
        const dates = generateDates({ start: '2026-02-02', end: '2026-02-27', weekdays, excluded: ['2026-02-16'] });
        const schedule = inferSchedule(dates);
        assert.deepEqual(schedule.weekdays, weekdays);
        assert.deepEqual(schedule.excluded, ['2026-02-16']);
        assert.deepEqual(generateDates(schedule), dates);
    });

    test('inferSchedule falls back to specific dates for irregular lists', () => {
        const dates = ['2026-01-01', '2026-01-09', '2026-01-20', '2026-02-02'];
        const schedule = inferSchedule(dates);
        assert.deepEqual(schedule.weekdays, []);
        assert.deepEqual(generateDates(schedule), dates);
    });
});

describe('scripture references', () => {
    test('splitReference separates books but keeps chapter continuations', () => {
        assert.deepEqual(splitReference('Psalm 1; Psalm 2'), ['Psalm 1', 'Psalm 2']);
        assert.deepEqual(splitReference('1 Kings 3:1-28; 4:1-34'), ['1 Kings 3:1-28; 4:1-34']);
        assert.deepEqual(splitReference('Romans 4:1-3, 5; 2 Cor 1:3'), ['Romans 4:1-3, 5', '2 Cor 1:3']);
    });

    test('formatVerseRanges and referenceFromScriptures', () => {
        assert.equal(formatVerseRanges(['3', '1', '2', '5', '7', '8']), '1-3, 5, 7-8');
        assert.equal(referenceFromScriptures([
            { book: '1 Kings', chapter: '3', verses: { 1: 'a', 2: 'b' } },
            { book: '1 Kings', chapter: '4', verses: { 1: 'c' } },
        ]), '1 Kings 3:1-2; 4:1');
    });

    test('extractReference ignores list markers and spreadsheet columns', () => {
        assert.equal(extractReference('1. Matthew 1:1-17'), 'Matthew 1:1-17');
        assert.equal(extractReference('- Mt 2'), 'Mt 2');
        assert.equal(extractReference('Day 3: John 3:16'), 'John 3:16');
        assert.equal(extractReference('Feb 2\tMatthew 1'), 'Matthew 1');
    });
});

describe('draft model and compile', () => {
    const schedule = { start: '2026-02-02', end: '2026-02-06', weekdays, excluded: [], extra: [] };

    function setup() {
        const engagementPlan = ['read', 'reflect', 'prayer', 'memorize'].map((type) => ({ type, weekdays: [...ALL_WEEKDAYS] }));
        let draft = createDraft({ title: 'Matthew', schedule, engagementPlan });
        draft = { ...draft, meta: { ...draft.meta, image_gs_location: 'gs://bucket/bible_series/matthew/cover.jpg' } };
        draft.days.forEach((day, i) => {
            draft = updateDay(draft, day.id, (d) => ({ ...d, reading: { ref: `Matthew ${i + 1}:1-5`, title: '' } }));
        });
        return draft;
    }

    test('compiles linked templates with {scripture} replaced and per-day values', () => {
        let draft = setup();
        const day = draft.days[0];
        const prayer = day.engagements.find((e) => e.type === 'prayer');
        const pointsBlock = draft.templates.prayer.blocks.find((b) => b.perDay);
        draft = setEngagementValue(draft, day.id, prayer.id, pointsBlock.id, { text: '- Pray one\n\n- Pray two' });
        const memorize = day.engagements.find((e) => e.type === 'memorize');
        const verseBlock = draft.templates.memorize.blocks.find((b) => b.perDay);
        draft = setEngagementValue(draft, day.id, memorize.id, verseBlock.id, { ref: 'John 3:16' });

        const { json, issues } = compileDraft(draft, lookupFor(draft));
        const first = json.series_content.filter((e) => e.date === '2026-02-02');
        assert.deepEqual(first.map((e) => e.content_type), ['read', 'reflect', 'prayer', 'memorize']);
        assert.deepEqual(Object.keys(first[0]), ['title', 'content_type', 'date', 'body']);

        const read = first[0].body.find((b) => b.body_type === 'scripture');
        assert.deepEqual(Object.keys(read), ['attribution', 'bible_version', 'body_type', 'scriptures']);
        assert.equal(read.scriptures[0].book, 'Matthew');
        assert.equal(read.scriptures[0].chapter, '1');
        assert.equal(read.scriptures[0].title, 'Matthew 1:1-5');
        assert.deepEqual(Object.keys(read.scriptures[0].verses), ['1', '2', '3', '4', '5']);

        assert.match(first[1].body[0].paragraphs[0], /\(Matthew 1:1-5\)/);
        assert.match(first[1].body[1].questions[0], /^Scripture: Read Matthew 1:1-5\./);
        assert.deepEqual(first[2].body[1].paragraphs, ['- Pray one', '- Pray two']);
        assert.equal(first[3].body[1].scriptures[0].book, 'John');

        // Day 2 has no prayer points or memory verse yet: warned, and the empty blocks are left out.
        assert.ok(issues.some((i) => i.dayId === draft.days[1].id && /per-day text is empty/.test(i.message)));
        assert.ok(!issues.some((i) => i.level === 'error'));
        const day2Prayer = json.series_content.find((e) => e.date === '2026-02-03' && e.content_type === 'prayer');
        assert.equal(day2Prayer.body.length, 1);
    });

    test('a missing day scripture is an error wherever it is needed', () => {
        let draft = setup();
        draft = updateDay(draft, draft.days[2].id, (d) => ({ ...d, reading: null }));
        const { issues } = compileDraft(draft, lookupFor(draft));
        const dayErrors = issues.filter((i) => i.dayId === draft.days[2].id && i.level === 'error');
        // Reported once for the day rather than once per engagement/block.
        assert.deepEqual(dayErrors.map((i) => i.message), ['No scripture for this day']);
    });

    test('invalid references are reported, not published', () => {
        let draft = setup();
        draft = updateDay(draft, draft.days[0].id, (d) => ({ ...d, reading: { ref: 'Matthew 99', title: '' } }));
        const { json, issues } = compileDraft(draft, lookupFor(draft));
        assert.ok(issues.some((i) => i.level === 'error' && /Chapter not found|Invalid/.test(i.message)));
        const read = json.series_content.find((e) => e.date === '2026-02-02' && e.content_type === 'read');
        assert.ok(!read.body.some((b) => b.body_type === 'scripture'));
    });

    test('detach copies the effective content; relink restores the template', () => {
        let draft = setup();
        const day = draft.days[0];
        const reflect = day.engagements.find((e) => e.type === 'reflect');
        draft = detachEngagement(draft, day.id, reflect.id);
        const detached = draft.days[0].engagements.find((e) => e.id === reflect.id);
        assert.equal(detached.linked, false);
        assert.deepEqual(detached.blocks.map((b) => b.kind), ['text', 'question']);
        assert.ok(detached.blocks.every((b) => !('fromDay' in b) && !('missing' in b)));
        draft = relinkEngagement(draft, day.id, reflect.id);
        assert.equal(draft.days[0].engagements.find((e) => e.id === reflect.id).linked, true);
    });

    test('copyEngagementToDays replaces the same type in place and adds where missing', () => {
        let draft = setup();
        const [d0, d1, d2] = draft.days;
        const memorize = d0.engagements.find((e) => e.type === 'memorize');
        const verseBlock = draft.templates.memorize.blocks.find((b) => b.perDay);
        draft = setEngagementValue(draft, d0.id, memorize.id, verseBlock.id, { ref: 'John 3:16' });
        draft = updateDay(draft, d2.id, (d) => ({ ...d, engagements: d.engagements.filter((e) => e.type !== 'memorize') }));
        const memorizeIndex = d1.engagements.findIndex((e) => e.type === 'memorize');

        draft = copyEngagementToDays(draft, d0.id, memorize.id, [d1.id, d2.id]);
        for (const day of [draft.days[1], draft.days[2]]) {
            const copies = day.engagements.filter((e) => e.type === 'memorize');
            assert.equal(copies.length, 1);
            assert.equal(copies[0].values[verseBlock.id].ref, 'John 3:16');
            assert.notEqual(copies[0].id, memorize.id);
        }
        assert.equal(draft.days[1].engagements.findIndex((e) => e.type === 'memorize'), memorizeIndex);
    });

    test('applySchedule keeps sequence or dates, and reports what would be lost', () => {
        const draft = setup();
        const later = { ...schedule, start: '2026-02-09', end: '2026-02-13' };
        const impact = scheduleChangeImpact(draft, later);
        assert.equal(impact.lostByOrder.length, 0);
        assert.equal(impact.lostByDate.length, 5);

        const shifted = applySchedule(draft, later, 'order');
        assert.equal(shifted.days[0].date, '2026-02-09');
        assert.equal(shifted.days[0].reading.ref, 'Matthew 1:1-5');

        const skipWednesday = { ...schedule, excluded: ['2026-02-04'] };
        const byDate = applySchedule(draft, skipWednesday, 'date');
        assert.deepEqual(byDate.days.map((d) => d.reading.ref), ['Matthew 1:1-5', 'Matthew 2:1-5', 'Matthew 4:1-5', 'Matthew 5:1-5']);
    });
});

describe('engagements by weekday', () => {
    const twoWeeks = { start: '2026-02-02', end: '2026-02-13', weekdays, excluded: [], extra: [] };
    const types = (day) => day.engagements.map((e) => e.type);
    const monday = (d) => weekdayOf(d.date) === 1;

    test('createDraft gives each weekday its own engagements', () => {
        const draft = createDraft({
            schedule: twoWeeks,
            engagementPlan: [
                { type: 'read', weekdays: weekdays },
                { type: 'devotional', weekdays: [1] },
                { type: 'reflect', weekdays: weekdays },
            ],
        });
        for (const day of draft.days) {
            assert.deepEqual(types(day), monday(day) ? ['read', 'devotional', 'reflect'] : ['read', 'reflect']);
        }
        assert.ok(draft.templates.devotional);
    });

    test('toggleTypeWeekday adds in plan order on that weekday only, and removes again', () => {
        let draft = createDraft({
            schedule: twoWeeks,
            engagementPlan: [{ type: 'read', weekdays }, { type: 'devotional', weekdays: [1] }, { type: 'reflect', weekdays }],
        });
        assert.deepEqual(weekdayToggleImpact(draft, 'devotional', 3), { adding: true, count: 2, withContent: 0 });
        draft = toggleTypeWeekday(draft, 'devotional', 3);
        for (const day of draft.days) {
            const w = weekdayOf(day.date);
            assert.deepEqual(types(day), w === 1 || w === 3 ? ['read', 'devotional', 'reflect'] : ['read', 'reflect']);
        }
        assert.deepEqual(draft.engagementPlan.find((p) => p.type === 'devotional').weekdays, [1, 3]);

        draft = toggleTypeWeekday(draft, 'devotional', 1);
        assert.ok(draft.days.filter(monday).every((d) => !types(d).includes('devotional')));
        assert.ok(draft.days.filter((d) => weekdayOf(d.date) === 3).every((d) => types(d).includes('devotional')));
    });

    test('new days from a schedule extension follow the weekday plan', () => {
        const draft = createDraft({ schedule: twoWeeks, engagementPlan: [{ type: 'read', weekdays }, { type: 'devotional', weekdays: [1] }] });
        const extended = applySchedule(draft, { ...twoWeeks, end: '2026-02-20' });
        const newMonday = extended.days.find((d) => d.date === '2026-02-16');
        const newTuesday = extended.days.find((d) => d.date === '2026-02-17');
        assert.deepEqual(types(newMonday), ['read', 'devotional']);
        assert.deepEqual(types(newTuesday), ['read']);
    });

    test('movePlanType reorders the plan and every day', () => {
        let draft = createDraft({ schedule: twoWeeks, engagementPlan: [{ type: 'read', weekdays }, { type: 'devotional', weekdays: [1] }] });
        draft = movePlanType(draft, 'devotional', -1);
        assert.deepEqual(draft.engagementPlan.map((p) => p.type), ['devotional', 'read']);
        assert.deepEqual(types(draft.days[0]), ['devotional', 'read']);
    });

    test('drafts saved with defaultTypes are migrated to an every-day plan', () => {
        const migrated = migrateDraft({ days: [], defaultTypes: ['read', 'reflect'] });
        assert.deepEqual(migrated.engagementPlan, [
            { type: 'read', weekdays: ALL_WEEKDAYS },
            { type: 'reflect', weekdays: ALL_WEEKDAYS },
        ]);
        assert.ok(!('defaultTypes' in migrated));
        const noHistory = migrateDraft({ days: [], engagementPlan: [], publishHistory: [{ seriesId: 'x' }] });
        assert.ok(!('publishHistory' in noHistory));
    });
});

describe('publish state', () => {
    test('active publishes become interrupted when the server stops updating them', () => {
        const now = 10_000_000;
        assert.equal(publishState({ status: 'publishing', updatedAt: now - 1000 }, now), 'active');
        assert.equal(publishState({ status: 'publishing', updatedAt: now - STALE_AFTER_MS - 1 }, now), 'interrupted');
        assert.equal(publishState({ status: 'done', failedCount: 0 }, now), 'done');
        assert.equal(publishState({ status: 'done', failedCount: 2 }, now), 'partial');
        assert.equal(publishState({ status: 'failed' }, now), 'failed');
    });
});

describe('importing existing series', () => {
    const file = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'data', 'bible_series', name), 'utf8'));

    test('matthew_2026.json becomes linked templates and compiles back to the same content', () => {
        const original = file('matthew_2026.json');
        const { draft, report } = importSeriesJson(original);
        assert.equal(report.days, 40);
        assert.equal(report.custom, 0);
        assert.deepEqual(report.templates, ['read', 'worship', 'reflect', 'prayer']);
        assert.deepEqual(generateDates(draft.schedule), draft.days.map((d) => d.date));
        assert.ok(draft.templates.prayer.blocks.some((b) => b.perDay));
        assert.ok(draft.templates.reflect.blocks.every((b) => !b.perDay));

        const { json, issues } = compileDraft(draft, lookupFor(draft));
        assert.deepEqual(issues.filter((i) => i.level === 'error'), []);
        assert.deepEqual(json.bible_series, original.bible_series);
        assert.equal(json.series_content.length, original.series_content.length);

        const strip = (entry) => ({
            ...entry,
            body: entry.body.map((b) => (b.body_type === 'scripture'
                ? { ...b, scriptures: b.scriptures.map((s) => ({ book: s.book, chapter: s.chapter, verses: Object.keys(s.verses) })) }
                : b)),
        });
        const sortKey = (e) => `${e.date}|${e.content_type}`;
        const expected = [...original.series_content].sort((a, b) => sortKey(a).localeCompare(sortKey(b))).map(strip);
        const actual = [...json.series_content].sort((a, b) => sortKey(a).localeCompare(sortKey(b))).map(strip);
        assert.deepEqual(actual, expected);
    });

    test('import detects engagements that only happen on some weekdays', () => {
        const { draft } = importSeriesJson(file('Romans-2025.json'));
        const plan = Object.fromEntries(draft.engagementPlan.map((p) => [p.type, p.weekdays]));
        assert.deepEqual(plan.devotional, [1]);
        assert.deepEqual(plan.read, [1, 2, 3, 4, 5]);
    });

    test('import detects Tue/Thu schedules', () => {
        const { draft } = importSeriesJson(file('psalm119-2022.json'));
        assert.deepEqual(draft.schedule.weekdays, [2, 4]);
    });

    test('effective blocks of an imported linked engagement carry the day values', () => {
        const { draft } = importSeriesJson(file('Romans-2025.json'));
        const memorize = draft.days[0].engagements.find((e) => e.type === 'memorize');
        assert.ok(memorize.linked);
        const verse = effectiveBlocks(draft, memorize).find((b) => b.kind === 'scripture');
        assert.equal(verse.ref, 'Romans 1:16');
    });
});
