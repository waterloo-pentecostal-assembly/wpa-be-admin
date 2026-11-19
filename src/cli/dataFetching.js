import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { BACK, choose, confirm, pickSeries, withSpinner } from './prompts.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPORTS_DIR = path.join(__dirname, '..', 'data', 'progress_records');

function writeCsv(name, rows) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
    const file = path.join(REPORTS_DIR, `${name}-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`);
    const cell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    fs.writeFileSync(file, rows.map((r) => r.map(cell).join(',')).join('\n'));
    console.log(`Written to ${path.relative(process.cwd(), file)}`);
}

export class DataFetchingCli {
    /**
     * @param {import('../services/dataFetchingService').DataFetchingService} dataFetchingService
     * @param {import('firebase-admin').firestore.Firestore} firestore - for picking series
     */
    constructor(dataFetchingService, firestore) {
        this.dataFetchingService = dataFetchingService;
        this.firestore = firestore;
    }

    async run() {
        const actions = {
            'Generate progress data (CSV)': () => this.getProgressData(),
            'Engagement completions by type for a series': () => this.engagementCountByType(),
            'Unique users who completed anything in a series': () => this.uniqueUsersForSeries(),
            'Completions per day for one engagement type in a series': () => this.completionsByType(),
        };
        const option = await choose('Fetch data: choose an option', Object.keys(actions));
        if (option === BACK) return;
        await actions[option]();
    }

    async getProgressData() {
        const progressData = await withSpinner('Getting data', () => this.dataFetchingService.getProgressData());
        console.log(`${progressData.length} users with progress above 0%.`);
        writeCsv('progress', [progressData]);
    }

    async engagementCountByType() {
        const picked = await pickSeries(this.firestore);
        if (picked === BACK) return;
        const [series] = picked;
        const counts = await withSpinner(`Counting completions for ${series.title}`, () => this.dataFetchingService.getEngagementCountByType(series.id));
        const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]);
        console.table(rows.map(([type, completions]) => ({ type: type ?? '(content no longer in series)', completions })));
    }

    async uniqueUsersForSeries() {
        const picked = await pickSeries(this.firestore);
        if (picked === BACK) return;
        const [series] = picked;
        const count = await withSpinner(`Counting users for ${series.title}`, () => this.dataFetchingService.getUniqueUsersForSeries(series.id));
        console.log(`${count} unique users completed at least one engagement in ${series.title}.`);
    }

    async completionsByType() {
        const picked = await pickSeries(this.firestore);
        if (picked === BACK) return;
        const [series] = picked;
        const typesSnapshot = await this.firestore.collection('bible_series').doc(series.id).collection('series_content').select('content_type').get();
        const types = [...new Set(typesSnapshot.docs.map((d) => d.data().content_type).filter(Boolean))].sort();
        if (!types.length) {
            console.log('This series has no content.');
            return;
        }
        const type = await choose('Engagement type', types);
        if (type === BACK) return;
        const data = await withSpinner(`Counting ${type} completions`, () => this.dataFetchingService.getCompletionsByType(type, series.id));
        const rows = data
            .sort((a, b) => a.date - b.date)
            .map((d) => ({ date: new Date(d.date).toISOString().slice(0, 10), completions: d.completion_count }));
        console.table(rows);
        if (rows.length && await confirm('Save as CSV?')) {
            writeCsv(`${type}-completions-${series.id}`, [['Date', 'Completions'], ...rows.map((r) => [r.date, r.completions])]);
        }
    }
}
