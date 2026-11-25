import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBibleService } from '../src/services/bibleService.js';
import { TEST_BIBLE } from './helpers/fakeApiBible.js';
import {
    SCHEDULE_PRESETS, endDateForCount, generateDates, inferSchedule, toggleDate,
} from '../ui/src/series/schedule.js';
import {
    bibleVersionLine, formatVerseRanges, passageIdsFor, passagesToScriptures, referenceFromScriptures, scriptureBodyBlock, splitReference,
} from '../ui/src/series/scriptureRefs.js';
import {
    ALL_WEEKDAYS, addEngagement, applySchedule, copyEngagementToDays, createDraft, detachEngagement, effectiveBlocks,
    migrateDraft, movePlanType, relinkEngagement, scheduleChangeImpact, setEngagementValue, toggleTypeWeekday,
    updateDay, weekdayToggleImpact,
} from '../ui/src/series/draftModel.js';
import { weekdayOf } from '../ui/src/series/dates.js';
import { collectRefs, compileDraft, compileEngagement, createLookup } from '../ui/src/series/compile.js';
import { BLOCK_KINDS, newBlock } from '../ui/src/series/blocks.js';
import { importSeriesJson } from '../ui/src/series/importSeries.js';
import { extractReference } from '../ui/src/series/planParsing.js';
import { STALE_AFTER_MS, publishState } from '../ui/src/series/publishes.js';
import { diffLines, entryLines } from '../ui/src/series/entryDiff.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const bible = loadBibleService(path.join(ROOT, 'src', 'data', 'niv.json'));

/** Resolves every reference a draft needs with the real NIV data, as the Bible API would (with `bible`). */
function lookupFor(draft) {
    const singles = new Map();
    for (const ref of collectRefs(draft)) {
        for (const part of splitReference(ref)) {
            try {
                singles.set(part, { ok: true, passage: { ...bible.getPassage(part), bible: TEST_BIBLE } });
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
        assert.deepEqual(Object.keys(read), ['attribution', 'bible_version', 'body_type', 'passage_ids', 'scriptures']);
        assert.equal(read.scriptures[0].book, 'Matthew');
        assert.equal(read.scriptures[0].chapter, '1');
        assert.equal(read.scriptures[0].title, 'Matthew 1:1-5');
        assert.deepEqual(Object.keys(read.scriptures[0].verses), ['1', '2', '3', '4', '5']);
        // What an updated app needs to fetch the passage through the Bible proxy, in its own translation:
        // at the block's root, so `scriptures` keeps exactly the shape existing apps read.
        assert.deepEqual(read.passage_ids, ['MAT.1.1-MAT.1.5']);
        assert.deepEqual(Object.keys(read.scriptures[0]), ['book', 'chapter', 'title', 'verses']);
        assert.equal(read.attribution, TEST_BIBLE.copyright);
        // The translation of the stored text is recorded once, on the series.
        assert.equal(json.bible_series.scripture_bible_id, 'test-niv');

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

    test('a day can have two engagements of one type; copying the second replaces the second', () => {
        let draft = setup();
        const [d0, d1, d2] = draft.days;
        draft = addEngagement(draft, d0.id, 'memorize');
        draft = addEngagement(draft, d1.id, 'memorize');
        const second = draft.days[0].engagements.filter((e) => e.type === 'memorize')[1];
        const verseBlock = draft.templates.memorize.blocks.find((b) => b.perDay);
        draft = setEngagementValue(draft, d0.id, second.id, verseBlock.id, { ref: 'John 3:16' });

        const json = compileDraft(draft, lookupFor(draft)).json;
        assert.equal(json.series_content.filter((e) => e.date === d0.date && e.content_type === 'memorize').length, 2);

        const d1Before = draft.days[1].engagements.filter((e) => e.type === 'memorize');
        draft = copyEngagementToDays(draft, d0.id, second.id, [d1.id, d2.id]);
        const d1After = draft.days[1].engagements.filter((e) => e.type === 'memorize');
        assert.equal(d1After.length, 2);
        assert.equal(d1After[0].id, d1Before[0].id);
        assert.equal(d1After[1].values[verseBlock.id].ref, 'John 3:16');
        // Day 2 has one Memorize, so the copy of the second is added beside it.
        assert.equal(draft.days[2].engagements.filter((e) => e.type === 'memorize').length, 2);
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
        assert.equal(publishState({ status: 'publishing', updated_at: now - 1000 }, now), 'active');
        assert.equal(publishState({ status: 'publishing', updated_at: now - STALE_AFTER_MS - 1 }, now), 'interrupted');
        assert.equal(publishState({ status: 'done', failed_count: 0 }, now), 'done');
        assert.equal(publishState({ status: 'done', failed_count: 2 }, now), 'partial');
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
        assert.deepEqual(json.bible_series, { ...original.bible_series, scripture_bible_id: 'test-niv' });
        assert.equal(json.series_content.length, original.series_content.length);

        const strip = (entry) => ({
            ...entry,
            body: entry.body.map((b) => {
                if (b.body_type !== 'scripture') return b;
                const { passage_ids: _ids, ...rest } = b; // added on compile; the original predates them
                return { ...rest, scriptures: b.scriptures.map((s) => ({ book: s.book, chapter: s.chapter, verses: Object.keys(s.verses) })) };
            }),
        });
        const sortKey = (e) => `${e.date}|${e.content_type}`;
        const expected = [...original.series_content].sort((a, b) => sortKey(a).localeCompare(sortKey(b))).map(strip);
        const actual = [...json.series_content].sort((a, b) => sortKey(a).localeCompare(sortKey(b))).map(strip);
        assert.deepEqual(actual, expected);
        const scriptureBlocks = json.series_content.flatMap((e) => e.body).filter((b) => b.body_type === 'scripture');
        assert.ok(scriptureBlocks.length && scriptureBlocks.every((b) => b.passage_ids?.length), 'every compiled scripture block has root passage_ids');
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

describe('audio blocks', () => {
    const URL_1 = 'https://firebasestorage.googleapis.com/v0/b/wpa-be-app-dev.appspot.com/o/audio_files%2Fday_1.mp3?alt=media&token=t1';
    const URL_2 = 'https://firebasestorage.googleapis.com/v0/b/wpa-be-app-dev.appspot.com/o/audio_files%2Fday_2.mp3?alt=media&token=t2';
    const draftWith = () => createDraft({
        title: 'Psalms', schedule: { start: '2026-02-02', end: '2026-02-04', weekdays, excluded: [], extra: [] },
        engagementPlan: [{ type: 'reflect', weekdays: [...ALL_WEEKDAYS] }],
    });
    const custom = (blocks) => ({ id: 'e1', type: 'reflect', linked: false, title: 'Listen', blocks });

    test('can be added and compile to { title, audio_file_url, body_type: audio }', () => {
        assert.ok(BLOCK_KINDS.some((k) => k.kind === 'audio'));
        assert.deepEqual({ ...newBlock('audio'), id: undefined }, { id: undefined, kind: 'audio', title: '', url: '', filename: '' });
        const draft = draftWith();
        const day = draft.days[0];
        const { entry, issues } = compileEngagement(draft, day, custom([{ id: 'b1', kind: 'audio', title: ' Psalm 23, read aloud ', url: URL_1, filename: 'day 1.mp3' }]), () => null);
        assert.deepEqual(entry.body, [{ title: 'Psalm 23, read aloud', audio_file_url: URL_1, body_type: 'audio' }]);
        assert.deepEqual(issues, []);
    });

    test('a title is required and a block without a file is left out', () => {
        const draft = draftWith();
        const day = draft.days[0];
        const untitled = compileEngagement(draft, day, custom([{ id: 'b1', kind: 'audio', title: '', url: URL_1 }]), () => null);
        assert.ok(untitled.issues.some((i) => i.level === 'error' && /audio needs a title/.test(i.message)));
        const noFile = compileEngagement(draft, day, custom([{ id: 'b1', kind: 'audio', title: 'Listen', url: '' }]), () => null);
        assert.equal(noFile.entry.body.length, 0);
        assert.ok(noFile.issues.some((i) => i.level === 'warning' && /audio file not uploaded/.test(i.message)));
    });

    test('a published series with audio imports as a per-day audio template and compiles back the same', () => {
        const entry = (date, title, url) => ({
            title: 'Listen', content_type: 'reflect', date,
            body: [{ paragraphs: ['Take a few minutes to listen.'], body_type: 'text' }, { title, audio_file_url: url, body_type: 'audio' }],
        });
        const original = {
            bible_series: { title: 'Psalms', sub_title: '', image_gs_location: '', is_active: false, is_visible: false },
            series_content: [entry('2026-02-02', 'Psalm 1', URL_1), entry('2026-02-03', 'Psalm 2', URL_2), entry('2026-02-04', 'Psalm 3', URL_1)],
        };
        const { draft } = importSeriesJson(original);
        const audio = draft.templates.reflect.blocks.find((b) => b.kind === 'audio');
        assert.equal(audio.perDay, true);
        const { json } = compileDraft(draft, lookupFor(draft));
        assert.deepEqual(json.series_content, original.series_content);
    });

    test('show in the update review', () => {
        assert.deepEqual(entryLines({ title: 'Listen', body: [{ title: 'Psalm 1', audio_file_url: URL_1, body_type: 'audio' }] }), [
            'Title: Listen', '— Audio: Psalm 1', URL_1,
        ]);
    });
});

describe('update review diff', () => {
    const entry = {
        title: 'Read',
        content_type: 'read',
        body: [
            { body_type: 'text', paragraphs: ['Read Romans 1:1-7 '] },
            {
                body_type: 'scripture', bible_version: 'NIV', attribution: 'Biblica',
                scriptures: [{ book: 'Romans', chapter: '1', title: '', verses: { 2: 'the gospel he promised', 1: 'Paul, a servant' } }],
            },
        ],
    };

    test('entryLines shows every field, verses in order and trailing spaces', () => {
        assert.deepEqual(entryLines(entry), [
            'Title: Read',
            '— Text',
            'Read Romans 1:1-7·',
            '— Scripture',
            'Romans 1 · title: (blank)',
            '1  Paul, a servant',
            '2  the gospel he promised',
            'attribution: Biblica',
            'bible_version: NIV',
        ]);
    });

    test('diffLines marks changed words and collapses unchanged lines', () => {
        const before = ['a', 'b', 'c', 'd', 'e', 'Pray for the church', 'f'];
        const after = ['a', 'b', 'c', 'd', 'e', 'Pray for our city', 'f', 'g'];
        const diff = diffLines(before, after, { context: 1 });
        assert.deepEqual(diff.map((l) => (l.type === 'skip' ? `skip ${l.count}` : `${l.type} ${l.text}`)), [
            'skip 4', 'same e', 'del Pray for the church', 'add Pray for our city', 'same f', 'add g',
        ]);
        const changed = (segments) => segments.filter((s) => s.changed).map((s) => s.text);
        assert.deepEqual(changed(diff[2].segments), ['the church']);
        assert.deepEqual(changed(diff[3].segments), ['our city']);
        assert.equal(diff[5].segments, undefined, 'a line with nothing to pair has no word highlights');
    });
});

describe('stored scripture format (API.Bible)', () => {
    test('passage IDs cover each run of consecutive verses', () => {
        assert.deepEqual(passageIdsFor('ROM', 4, [1, 2, 3, 5]), ['ROM.4.1-ROM.4.3', 'ROM.4.5-ROM.4.5']);
        assert.deepEqual(passageIdsFor('PSA', '119', [176, 175]), ['PSA.119.175-PSA.119.176']);
        assert.deepEqual(passageIdsFor(null, 1, [1]), []);
        assert.deepEqual(passageIdsFor('GEN', 1, []), []);
    });

    test('blocks list every entry\'s passage IDs, in order, at the root and keep entries in the old shape', () => {
        const block = scriptureBodyBlock([
            { book: 'Romans', chapter: '4', title: 'Romans 4:1-3, 5; 5:1', verses: { 1: 'a', 2: 'b', 3: 'c', 5: 'e' }, passage_ids: ['ROM.4.1-ROM.4.3', 'ROM.4.5-ROM.4.5'] },
            { book: 'Romans', chapter: '5', title: '', verses: { 1: 'f' }, passage_ids: ['ROM.5.1-ROM.5.1'] },
        ]);
        assert.deepEqual(block.passage_ids, ['ROM.4.1-ROM.4.3', 'ROM.4.5-ROM.4.5', 'ROM.5.1-ROM.5.1']);
        assert.deepEqual(Object.keys(block), ['attribution', 'bible_version', 'body_type', 'passage_ids', 'scriptures']);
        assert.ok(block.scriptures.every((s) => !('passage_ids' in s)));
    });

    test('blocks keep the fields existing apps read, with the translation\'s copyright', () => {
        const scriptures = [{ book: 'John', chapter: '3', title: 'John 3:16', verses: { 16: 'For God so loved' } }];
        const bsb = { id: 'bsb-id', abbreviation: 'BSB', name: 'Berean Standard Bible', copyright: 'Public domain' };
        assert.deepEqual(scriptureBodyBlock(scriptures, bsb), {
            attribution: 'Public domain',
            bible_version: 'Scripture quotations taken from Berean Standard Bible (BSB)',
            body_type: 'scripture',
            scriptures,
        });
        assert.deepEqual(scriptureBodyBlock(scriptures), { attribution: '', bible_version: '', body_type: 'scripture', scriptures });
        assert.equal(bibleVersionLine(TEST_BIBLE), 'Scripture quotations taken from The Holy Bible, New International Version® NIV®');
    });

    test('the series records its translation only when scripture was resolved', () => {
        const draft = createDraft({ title: 'No scripture', schedule: { start: '2026-02-02', end: '2026-02-02', weekdays } });
        assert.equal('scripture_bible_id' in compileDraft(draft, lookupFor(draft)).json.bible_series, false);
    });

    test('drafts default to the server translation; imports keep the series\' one', () => {
        assert.equal(createDraft({ title: 'x' }).meta.bible_id, null);
        assert.equal(createDraft({ title: 'x', bibleId: 'bsb-id' }).meta.bible_id, 'bsb-id');
        const json = {
            bible_series: { title: 'T', scripture_bible_id: 'bsb-id' },
            series_content: [{
                title: 'Read', content_type: 'read', date: '2026-02-02',
                body: [scriptureBodyBlock([{ book: 'John', chapter: '3', title: '', verses: { 16: 'x' } }], { id: 'bsb-id', name: 'B' })],
            }],
        };
        assert.equal(importSeriesJson(json).draft.meta.bible_id, 'bsb-id');
        delete json.bible_series.scripture_bible_id;
        assert.equal(importSeriesJson(json).draft.meta.bible_id, null);
    });
});

describe('scripture picker selection', () => {
    test('keeps verses from every book and chapter visited', async () => {
        const {
            chapterSelection, countVerses, countsByBook, chapterLabel, removeChapter, selectionToScriptures, updateChapter,
        } = await import('../ui/src/series/scriptureSelection.js');
        let selection = [];
        selection = updateChapter(selection, 'Ezra', 4, { 2: 'a', 3: 'b', 4: 'c', 5: 'd', 6: 'e' });
        selection = updateChapter(selection, 'Genesis', 1, { 1: 'g1', 2: 'g2', 3: 'g3', 4: 'g4' });
        assert.deepEqual(Object.keys(chapterSelection(selection, 'Ezra', '4')), ['2', '3', '4', '5', '6'], 'switching away keeps Ezra');
        assert.equal(countVerses(selection), 9);
        assert.deepEqual(countsByBook(selection), { Ezra: 5, Genesis: 4 });
        assert.equal(chapterLabel(selection[0]), 'Ezra 4:2-6');

        // Books stay in the order picked; a book's chapters are put in order.
        selection = updateChapter(selection, 'Ezra', 1, { 1: 'x' });
        const scriptures = selectionToScriptures(selection, 'Rebuilding');
        assert.deepEqual(scriptures.map((s) => `${s.book} ${s.chapter}`), ['Ezra 1', 'Ezra 4', 'Genesis 1']);
        assert.deepEqual(scriptures.map((s) => s.title), ['Rebuilding', '', '']);
        assert.equal(referenceFromScriptures(scriptures), 'Ezra 1:1; 4:2-6; Genesis 1:1-4');

        // Deselecting a chapter's last verse, or removing it, drops it.
        selection = updateChapter(selection, 'Ezra', 1, { 1: null });
        assert.equal(selection.length, 2);
        selection = removeChapter(selection, 'Genesis', '1');
        assert.deepEqual(selection.map(chapterLabel), ['Ezra 4:2-6']);
        // Empty-text verses (verse bridges) still count as selected.
        assert.deepEqual(Object.keys(chapterSelection(updateChapter([], 'Acts', 8, { 37: '' }), 'Acts', 8)), ['37']);
    });

    test('a multi-book selection resolves back to the same passages', async () => {
        const { selectionFromScriptures, selectionToScriptures, updateChapter } = await import('../ui/src/series/scriptureSelection.js');
        let selection = updateChapter([], 'Ezra', 4, { 2: '', 3: '', 4: '', 5: '', 6: '' });
        selection = updateChapter(selection, 'Genesis', 1, { 1: '', 2: '', 4: '' });
        const ref = referenceFromScriptures(selectionToScriptures(selection));
        assert.equal(ref, 'Ezra 4:2-6; Genesis 1:1-2, 4');
        const singles = new Map(splitReference(ref).map((part) => [part, { ok: true, passage: bible.getPassage(part) }]));
        const resolved = createLookup(singles)(ref);
        assert.equal(resolved.label, 'Ezra 4:2-6; Genesis 1:1-2, 4');

        // Reopening the picker on that reference starts with the same selection.
        const reopened = selectionFromScriptures(passagesToScriptures(resolved.passages).map(({ book, chapter, verses }) => ({ book, chapter, verses })));
        assert.deepEqual(reopened.map((s) => [s.book, s.chapter, Object.keys(s.verses)]), [
            ['Ezra', 4, ['2', '3', '4', '5', '6']],
            ['Genesis', 1, ['1', '2', '4']],
        ]);
        assert.deepEqual(selectionFromScriptures({ book: 'John', chapter: '3', verses: { 16: 't' } }).map((s) => s.chapter), [3]);
        assert.deepEqual(selectionFromScriptures(null), []);
    });
});
