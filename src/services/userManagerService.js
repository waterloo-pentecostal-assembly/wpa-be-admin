// See https://firebase.google.com/docs/auth/admin/manage-users#update_a_user
/** @typedef {import("@google-cloud/firestore").Firestore} Firestore */
/** @typedef {import("@google-cloud/firestore").Firestore} Auth */

class UserManagerService {
    /**
     * @param {Firestore} firestore 
     * @param {Auth} auth 
     */
    constructor(firestore, auth) {
        this.auth = auth;
        this.firestore = firestore;
    }

    async verifyUserByEmail(email) {
        // Find uid by email
        const userRecordBefore = await this.auth.getUserByEmail(email);
        const uid = userRecordBefore.uid;

        await this.auth.updateUser(uid, { emailVerified: true });

        // Verify user using transaction 
        const userRef = this.firestore.collection('users').doc(uid);
        await this.firestore.runTransaction(async (t) => {
            const doc = await t.get(userRef);
            t.update(userRef, { is_verified: true });
        });
        return true;
    }

    async deleteUserByEmail(email) {
        // Find user by email
        const userRecordBefore = await this.auth.getUserByEmail(email);
        const uid = userRecordBefore.uid;

        // Delete user
        await this.auth.deleteUser(uid);
    }

    async deleteUserById(uid) {
        await this.auth.deleteUser(uid);
    }

    async createVerifiedUser(email, password, firstName, lastName) {
        const userRecord = await this.auth.createUser({
            email,
            password,
        });

        const uid = userRecord.uid;

        // Add information to firestore 
        await this.firestore.collection('users').doc(uid).set({
            "email": email,
            "first_name": firstName,
            "last_name": lastName,
            "is_verified": true,
            "is_admin": false,
            "reports": 0
        });

        return uid;
    }

    async createDefaultNotificationSettings(email) {
        // Find user by email
        const userRecordBefore = await this.auth.getUserByEmail(email);
        const uid = userRecordBefore.uid;

        // Add default notification settings
        const docRef = await this.firestore.collection('users').doc(uid).collection('notification_settings').add({
            'daily_engagement_reminder': true
        });

        return docRef.id;
    }

    async getAllUsersAfterDate(date) {
        let nextToken = undefined;
        let allCount = 0;
        let afterDateCount = 0;
        do {
            const result = await this.auth.listUsers(1000, nextToken)
            nextToken = result.pageToken;
            console.log(">>", nextToken);
            result['users'].forEach((user)=>{
                allCount += 1;
                const creationTime = new Date(user.metadata.creationTime);
                if (creationTime>=date){
                    afterDateCount+=1;
                }
            });
        } while (nextToken != undefined)
        console.log('Total users: ', allCount, ', Users after ', date, ': ', afterDateCount); 
    }

    async getActiveUsersBetweenDates(date_start, date_end) {
        const completionsSnapshot = await this.firestore
            .collection('completions')
            .where('completion_date', '>=', date_start)
            .where('completion_date', '<', date_end)
            .limit(30000)
            .get();
        const prayerRequestSnapshot = await this.firestore
            .collection('prayer_requests')
            .where('date', '>=', date_start)
            .where('date', '<', date_end)
            .limit(30000)
            .get();
        const testimoniesSnapshot = await this.firestore
            .collection('testimonies')
            .where('date', '>=', date_start)
            .where('date', '<', date_end)
            .limit(30000)
            .get();
        let count = 0;
        const users = new Set();
        completionsSnapshot.forEach(doc => {
            const data = doc.data();
            const user_id = data.user_id;
            count+=1;
            console.log(user_id, count);
            users.add(user_id);
        });
        prayerRequestSnapshot.forEach(doc => {
            const data = doc.data();
            const user_id = data.user_id;
            count+=1;
            console.log(user_id, count);
            users.add(user_id);
        });
        testimoniesSnapshot.forEach(doc => {
            const data = doc.data();
            const user_id = data.user_id;
            count+=1;
            console.log(user_id, count);
            users.add(user_id);
        });
        console.log('Total active users: ', users.size); 
    }
}

module.exports = {
    UserManagerService
};