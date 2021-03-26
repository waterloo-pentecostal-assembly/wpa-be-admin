const { DateTime } = require('luxon');

const Timestamp = require("firebase-admin").firestore.Timestamp;
 
function sleep(ms) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

// TODO: make this more robust. e.g. check for data duplication 

class DataLoaderService {
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

    async loadSeriesContent(data, bibleSeriesId) {
        try {
            for(var i = 0; i < data.length; i++){
                // Convert date from string to millis with America/Toronto timezone
                const contentDate = DateTime
                    .fromFormat(data[i].date, 'yyyy-MM-dd', { zone: 'America/Toronto' })
                    .toMillis();

                const contentFirebaseTimestamp = Timestamp.fromMillis(contentDate);
                data[i].date = contentFirebaseTimestamp;

                // eslint-disable-next-line no-await-in-loop
                await this.firestore
                    .collection('bible_series')
                    .doc(bibleSeriesId)
                    .collection('series_content')
                    .add(data[i]);
                await sleep(2000);
            }
        } catch (e) {
            throw Error(`Unable to load bible series content: ${e}`);
        }
    }
}

module.exports = {
    DataLoaderService
};