import { buildSnippet, contentTimestamp } from './publishedSeries.js';

// TODO: make this more robust. e.g. check for data duplication 

export class DataLoaderService {
    constructor(firestore) {
        this.firestore = firestore;
    }

    async loadMedia(data) {
        try {
            data.forEach(async (media) => {
                await this.firestore.collection('media').add(media);
            });
        } catch (e) {
            throw Error(`Unable to load media: ${e}`);
        }
    }

    async loadBibleSeries(data) {
        try {
            const docRef = await this.firestore.collection('bible_series').add(data);
            return docRef.id;
        } catch (e) {
            throw Error(`Unable to load bible series: ${e}`);

        }
    }

    /**
     * Writes each content entry under bible_series/{id}/series_content, then
     * sets the series' snippet and start/end dates from the entries written
     * (in the order given). An entry that fails is logged and skipped so the
     * rest still load; the returned report says which ones failed.
     *
     * @param {(progress: { written: number, failed: number, total: number }) => void} [options.onProgress]
     * @returns {Promise<{ total: number, written: number, failed: Array<{ index: number, date: string, content_type: string, error: string }> }>}
     */
    async loadSeriesContent(data, bibleSeriesId, { onProgress } = {}) {
        const report = { total: data.length, written: 0, failed: [] };
        const seriesRef = this.firestore.collection('bible_series').doc(bibleSeriesId);
        const written = [];
        for (let i = 0; i < data.length; i++) {
            const { date, content_type } = data[i];
            try {
                const entry = { ...data[i], date: contentTimestamp(date) };
                const docRef = await seriesRef.collection('series_content').add(entry);
                written.push({ id: docRef.id, content_type, date: entry.date });
                report.written++;
            } catch (error) {
                console.log(">>>>> Unable to load", data[i], error);
                report.failed.push({ index: i, date, content_type, error: error.message });
            }
            onProgress?.({ written: report.written, failed: report.failed.length, total: report.total });
        }
        try {
            await seriesRef.update(buildSnippet(written));
        } catch (e) {
            throw Error(`Content was written but the series snippet could not be updated: ${e}`);
        }
        return report;
    }
}