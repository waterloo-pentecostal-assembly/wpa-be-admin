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

    async updateYoutubeLinks() {
        // get all bible series
        const bibleSeriesQuerySnapshot = await this.firestore
            .collection('bible_series')
            .get();
        const bibleSeriesDocs = bibleSeriesQuerySnapshot.docs;
        for (let a = 0; a < bibleSeriesDocs.length; a++) {

            // const bibleSeries = bibleSeriesDocs[a].data();
            const seriesId = bibleSeriesDocs[a].id;
            // if (seriesId !== 'MX6BPXbMHwWvjjGv1BH8') {
            //     continue;
            // }
            const seriesContentSnapshot = await this.firestore
                .collection('bible_series')
                .doc(seriesId)
                .collection('series_content')
                .get();
            const seriesContentDocs = seriesContentSnapshot.docs;
            for (let b = 0; b < seriesContentDocs.length; b++) {
                const contentData = seriesContentDocs[b].data();
                const contentId = seriesContentDocs[b].id;
                const body = contentData['body'];
                for (let i = 0; i < body.length; i++) {
                    const b = body[i];
                    if (b['body_type'] === 'link') {
                        const link = b['link'];
                        if (link.includes('yout')) {
                            const conv = this.convertToEmbedUrl(link);
                            console.log(seriesId, contentId, link, conv);
                            body[i]['link'] = conv;
                            // console.log(body);
                            await this.firestore
                                .collection('bible_series')
                                .doc(seriesId)
                                .collection('series_content')
                                .doc(contentId)
                                .update({ body });
                        }
                    }
                }
            }
        }
        console.log("DONE");
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