/** @typedef {import("@google-cloud/firestore").Firestore} Firestore */

class DataFetchingService {
    /**
     * @param {Firestore} firestore 
     */
    constructor(firestore) {
        this.firestore = firestore;
    }

    async getEngagementCountByType(series_id) {
        const result = new Map();
        const contentTypeMapping = new Map();
        const seriesContentSnapshot = await this.firestore
            .collection('bible_series')
            .doc(series_id)
            .collection('series_content')
            .get();
        seriesContentSnapshot.docs.forEach(doc => {
            const type = doc.data().content_type;
            const id = doc.id;
            contentTypeMapping.set(id, type);
        });
        const completionsSnapshot = await this.firestore
            .collection('completions')
            .where('series_id', '==', series_id)
            .get();
        completionsSnapshot.forEach(doc => {
            const data = doc.data();
            const content_id = data.content_id;
            const content_type = contentTypeMapping.get(content_id);
            if (result.has(content_type)) {
                const new_count = result.get(content_type) + 1;
                result.set(content_type, new_count);
            } else {
                result.set(content_type, 1);
            }
        });
        console.log(result);
        // return result;
    }

    async getProgressData() {
        const progressData = [];

        const progressSnapshot = await this.firestore
            .collection('achievements')
            .get();

        progressSnapshot.forEach(doc => {
            const data = doc.data();
            const seriesProgress = data.series_progress;
            progressData.push(seriesProgress);
        });
        return progressData;
    }

    async getCompletionsByType(content_type, series_id) {
        // get content ids for content type in the series
        const contentIdSnapshot = await this.firestore
            .collection('bible_series')
            .doc(series_id)
            .collection('series_content')
            .where('content_type', '==', content_type)
            .get();

        const contentData = [];

        contentIdSnapshot.docs.forEach(doc => {
            const timestamp = doc.data().date;
            const id = doc.id;
            contentData.push({
                id,
                date: timestamp.seconds * 1000,
            });
        });

        const snapshotPromises = [];

        contentData.forEach(element => {
            snapshotPromises.push(
                this.firestore.collection('completions').where('content_id', '==', element.id).get()
            );
        });

        const snapshots = await Promise.all(snapshotPromises);

        let contentIndex = 0;
        snapshots.forEach(snapshot => {
            const data = snapshot.docs;
            contentData[contentIndex].completion_count = data.length;
            contentIndex += 1;
        });
        return contentData;
        // const csvString = [
        //     [
        //         "Date of Devotional",
        //         "Completions"
        //     ],
        //     ...contentData.sort(
        //         (a,b)=>(a.date < b.date) ? 1 : (a.date > b.date) ? -1 : 0
        //         ).map(data => [
        //         new Date(data.date),
        //         data.completion_count
        //     ])
        // ]
        // .map(e => e.join(",")) 
        // .join("\n");

        // console.log(csvString);
    }
}

module.exports = {
    DataFetchingService
};