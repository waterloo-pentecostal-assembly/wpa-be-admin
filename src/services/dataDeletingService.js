/** @typedef {import("@google-cloud/firestore").Firestore} Firestore */
import { DateTime } from 'luxon';
import admin from "firebase-admin";

const Timestamp = admin.firestore.Timestamp;


export class DataDeletingService {
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