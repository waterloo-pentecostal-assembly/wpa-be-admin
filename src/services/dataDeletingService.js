/** @typedef {import("@google-cloud/firestore").Firestore} Firestore */
const { DateTime } = require('luxon');

const Timestamp = require("firebase-admin").firestore.Timestamp;

function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

class DataDeletingService {
    /**
     * @param {Firestore} firestore 
     */
    constructor(firestore) {
        this.firestore = firestore;
    }

    async deleteOldPrayerRequests(date) {
        // get all prayer requests ids that is older than
        const prayerRequestSnapshot = await this.firestore
            .collection('prayer_requests')
            .where('date', '<=', date)
            .get();
        console.log(prayerRequestSnapshot.docs.length);
        // prayerRequestSnapshot.forEach(doc => {
        //     doc.ref.delete();
        // });
    }
}

module.exports = {
    DataDeletingService
};