import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { BACK, ask, askDate, choose, confirm, confirmWrite, isoDate, pickSeries, withSpinner } from './prompts.js';
import { listThreadTitleBackups, restoreThreadTitleBackup, runThreadTitleFix } from './threadTitleTasks.js';
import { MAX_TITLE_LENGTH } from '../services/threadTitleFix.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERIES_DIR = path.join(__dirname, '..', 'data', 'bible_series');
const PSALMS_FILE = path.join(__dirname, '..', 'data', 'psalms.json');

/**
 * Fills Psalms scripture entries with empty `verses` in a series JSON file
 * from src/data/psalms.json (formerly fill_verses.js).
 * @returns {number} entries filled
 */
export function fillEmptyPsalmsVerses(seriesJson, psalmsData) {
    let filled = 0;
    for (const day of seriesJson.series_content ?? []) {
        for (const block of day.body ?? []) {
            if (block.body_type !== 'scripture' || !block.scriptures) continue;
            for (const sc of block.scriptures) {
                if (sc.book === 'Psalms' && sc.chapter && sc.verses && Object.keys(sc.verses).length === 0) {
                    const chapterData = psalmsData.Psalms?.[sc.chapter];
                    if (chapterData) {
                        sc.verses = chapterData;
                        filled++;
                    }
                }
            }
        }
    }
    return filled;
}

export class MaintenanceCli {
    /**
     * @param {{ dataManagerService: import('../services/dataManagerService.js').DataManagerService,
     *           dataDeletingService: import('../services/dataDeletingService.js').DataDeletingService,
     *           firestore: import('firebase-admin').firestore.Firestore, env: string }} deps
     */
    constructor({ dataManagerService, dataDeletingService, firestore, env }) {
        this.dataManagerService = dataManagerService;
        this.dataDeletingService = dataDeletingService;
        this.firestore = firestore;
        this.env = env;
    }

    async run() {
        const actions = {
            'Convert YouTube links in all series to embed URLs  [writes, after a dry run]': () => this.updateYoutubeLinks(),
            'Delete prayer requests dated before a date  [deletes]': () => this.deleteOldPrayerRequests(),
            [`Shorten forum thread titles over ${MAX_TITLE_LENGTH} characters  [writes, after a dry run]`]: () => this.fixThreadTitles(),
            'Restore a thread title fix backup  [writes]': () => this.restoreThreadTitles(),
            'Fill empty Psalms verses in a local series file (src/data/bible_series)': () => this.fillPsalmsVerses(),
        };
        const option = await choose('Maintenance: choose an option', Object.keys(actions));
        if (option === BACK) return;
        await actions[option]();
    }

    async updateYoutubeLinks() {
        const changes = await withSpinner('Finding YouTube links to convert (dry run)', () => this.dataManagerService.updateYoutubeLinks({ dryRun: true, log: () => {} }));
        if (!changes.length) {
            console.log('Every YouTube link is already an embed URL (or couldn\'t be parsed).');
            return;
        }
        for (const c of changes) console.log(`  ${c.seriesId}/${c.contentId}: ${c.from} -> ${c.to}`);
        const entries = new Set(changes.map((c) => `${c.seriesId}/${c.contentId}`)).size;
        if (!(await confirmWrite(this.env, `Convert ${changes.length} links in ${entries} entries?`))) return;
        const applied = await withSpinner('Converting links', () => this.dataManagerService.updateYoutubeLinks({ log: () => {} }));
        console.log(`Converted ${applied.length} links.`);
    }

    async deleteOldPrayerRequests() {
        const before = await askDate('Delete prayer requests dated before');
        const day = isoDate(before);
        const count = await withSpinner('Counting prayer requests', () => this.dataDeletingService.countOldPrayerRequests(before));
        if (!count) {
            console.log(`No prayer requests are dated before ${day}.`);
            return;
        }
        if (!(await confirmWrite(this.env, `Permanently delete ${count} prayer requests dated before ${day} (with any subcollections)?`))) return;
        const deleted = await withSpinner(`Deleting ${count} prayer requests`, () => this.dataDeletingService.deleteOldPrayerRequests(before));
        console.log(`Deleted ${deleted} prayer requests dated before ${day}.`);
    }

    async fixThreadTitles() {
        const scope = await choose('Which forums?', [
            { name: 'All forums', value: 'all' },
            { name: 'Choose series…', value: 'some' },
            { name: 'Specific thread IDs…', value: 'threads' },
        ]);
        if (scope === BACK) return;
        let forumIds = null;
        let threadIds = null;
        if (scope === 'threads') {
            threadIds = (await ask('Thread IDs (separate several with spaces or commas)', { required: true })).split(/[\s,]+/).filter(Boolean);
            const seriesId = await ask('Series ID of their forum (blank = look in every forum)');
            if (seriesId) forumIds = [seriesId];
        }
        if (scope === 'some') {
            const picked = await pickSeries(this.firestore, { multiple: true, message: 'Forums of which series? (space to select, enter to confirm)' });
            if (picked === BACK || !picked.length) return;
            forumIds = picked.map((s) => s.id);
        }
        const dry = await runThreadTitleFix({ firestore: this.firestore, env: this.env, forumIds, threadIds });
        if (!dry.threads) return;
        console.log('Note: the added comments are new documents, so anything triggered by new comments (e.g. notifications) may run for them.');
        if (!(await confirmWrite(this.env, `Fix these ${dry.threads} threads (shorter title, full title as the first comment; a backup is saved first)?`))) return;
        const result = await runThreadTitleFix({ firestore: this.firestore, env: this.env, forumIds, threadIds, apply: true });
        if (result.backupFile) console.log('To undo: Maintenance → Restore a thread title fix backup.');
    }

    async restoreThreadTitles() {
        const backups = listThreadTitleBackups(this.env);
        if (!backups.length) {
            console.log(`No thread title backups for ${this.env} in backups/.`);
            return;
        }
        const file = await choose('Backup to restore', backups.map((b) => ({ name: `${b.createdAt}  ${b.threads} threads  (${b.name})`, value: b.file })));
        if (file === BACK) return;
        await restoreThreadTitleBackup({ firestore: this.firestore, env: this.env, file, confirmWrite: (message) => confirmWrite(this.env, message) });
    }

    async fillPsalmsVerses() {
        const files = fs.readdirSync(SERIES_DIR).filter((f) => f.endsWith('.json')).sort();
        const file = await choose('Series file', files.map((f) => ({ name: f, value: f })).sort((a, b) => (b.value === 'psalms-gpt.json') - (a.value === 'psalms-gpt.json')));
        if (file === BACK) return;
        const filePath = path.join(SERIES_DIR, file);
        const seriesJson = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const filled = fillEmptyPsalmsVerses(seriesJson, JSON.parse(fs.readFileSync(PSALMS_FILE, 'utf8')));
        if (!filled) {
            console.log(`${file} has no Psalms entries with empty verses.`);
            return;
        }
        if (!(await confirm(`Fill ${filled} Psalms entries in ${file} (the local file is rewritten)?`, { default: true }))) return;
        fs.writeFileSync(filePath, JSON.stringify(seriesJson, null, 4));
        console.log(`Filled verses for ${filled} scripture entries in ${file}.`);
    }
}
