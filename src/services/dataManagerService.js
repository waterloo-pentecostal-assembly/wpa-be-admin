/** @typedef {import("@google-cloud/firestore").Firestore} Firestore */
import { DateTime } from 'luxon';
import admin from "firebase-admin";

const Timestamp = admin.firestore.Timestamp;


export class DataManagerService {
    /**
     * @param {Firestore} firestore 
     */
    constructor(firestore) {
        this.firestore = firestore;
    }

    /**
     * Rewrites YouTube links in every series' content to embed URLs
     * (https://youtube.com/embed/<id>). Links that are already embed URLs or
     * can't be parsed are left alone.
     *
     * @param {{ dryRun?: boolean, log?: (line: string) => void }} [options]
     *   `dryRun`: report the changes without writing them.
     * @returns {Promise<Array<{ seriesId: string, contentId: string, from: string, to: string }>>}
     */
    async updateYoutubeLinks({ dryRun = false, log = console.log } = {}) {
        const changes = [];
        const bibleSeriesQuerySnapshot = await this.firestore.collection('bible_series').get();
        for (const seriesDoc of bibleSeriesQuerySnapshot.docs) {
            const seriesId = seriesDoc.id;
            const contentCollection = this.firestore.collection('bible_series').doc(seriesId).collection('series_content');
            const seriesContentSnapshot = await contentCollection.get();
            for (const contentDoc of seriesContentSnapshot.docs) {
                let changed = false;
                const body = (contentDoc.data().body ?? []).map((block) => {
                    if (block?.body_type !== 'link' || typeof block.link !== 'string' || !block.link.includes('yout')) return block;
                    const converted = this.convertToEmbedUrl(block.link);
                    if (!converted || converted === block.link) return block;
                    changes.push({ seriesId, contentId: contentDoc.id, from: block.link, to: converted });
                    log(`${seriesId}/${contentDoc.id}: ${block.link} -> ${converted}`);
                    changed = true;
                    return { ...block, link: converted };
                });
                if (changed && !dryRun) await contentCollection.doc(contentDoc.id).update({ body });
            }
        }
        return changes;
    }

    convertToEmbedUrl(youtubeUrl) {
        // Extract video ID from different formats of YouTube URLs
        const regex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:[^/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|\S*?[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i;
        const match = youtubeUrl.match(regex);

        if (match && match[1]) {
            const videoId = match[1];
            // Construct the embed URL
            const embedUrl = `https://youtube.com/embed/${videoId}`;
            return embedUrl;
        } else {
            // Invalid YouTube URL
            return null;
        }
    }
}