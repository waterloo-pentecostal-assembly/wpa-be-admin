import { DateTime } from 'luxon';
import admin from 'firebase-admin';

const Timestamp = admin.firestore.Timestamp;

function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

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
     * Writes each content entry under bible_series/{id}/series_content, one
     * every 2 s. An entry that fails is logged and skipped so the rest still
     * load; the returned report says which ones failed.
     *
     * @param {(progress: { written: number, failed: number, total: number }) => void} [options.onProgress]
     * @returns {Promise<{ total: number, written: number, failed: Array<{ index: number, date: string, content_type: string, error: string }> }>}
     */
    async loadSeriesContent(data, bibleSeriesId, { onProgress } = {}) {
        const report = { total: data.length, written: 0, failed: [] };
        try {
            for (var i = 0; i < data.length; i++) {
                const { date, content_type } = data[i];
                try {

                    // Convert date from string to millis with America/Toronto timezone
                    const contentDate = DateTime
                        .fromFormat(data[i].date, 'yyyy-MM-dd', { zone: 'America/Toronto' })
                        .toMillis();

                    const contentFirebaseTimestamp = Timestamp.fromMillis(contentDate);
                    data[i].date = contentFirebaseTimestamp;

                    await this.firestore
                        .collection('bible_series')
                        .doc(bibleSeriesId)
                        .collection('series_content')
                        .add(data[i]);
                    report.written++;
                    await sleep(2000);
                } catch (error) {
                    console.log(">>>>> Unable to load", data[i], error);
                    report.failed.push({ index: i, date, content_type, error: error.message });
                }
                onProgress?.({ written: report.written, failed: report.failed.length, total: report.total });
            }
        } catch (e) {
            throw Error(`Unable to load bible series content: ${e}`);
        }
        return report;
    }
}