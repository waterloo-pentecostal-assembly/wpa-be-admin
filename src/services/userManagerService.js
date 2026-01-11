// See https://firebase.google.com/docs/auth/admin/manage-users#update_a_user
/** @typedef {import("@google-cloud/firestore").Firestore} Firestore */
/** @typedef {import("@google-cloud/firestore").Firestore} Auth */
export class UserManagerService {
    /**
     * @param {Firestore} firestore 
     * @param {Auth} auth 
     * @param {import("firebase-admin").messaging.Messaging} messaging
     */
    constructor(firestore, auth, messaging) {
        this.auth = auth;
        this.firestore = firestore;
        this.messaging = messaging;
    }

    async verifyUserByEmail(email) {
        // Find uid by email
        const userRecordBefore = await this.auth.getUserByEmail(email);
        const uid = userRecordBefore.uid;

        await this.auth.updateUser(uid, { emailVerified: true });

        // Verify user using transaction 
        const userRef = this.firestore.collection('users').doc(uid);
        await this.firestore.runTransaction(async (t) => {
            await t.get(userRef);
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
        let afterDateCount = 0;
        do {
            const result = await this.auth.listUsers(1000, nextToken)
            nextToken = result.pageToken;
            result['users'].forEach((user) => {
                const creationTime = new Date(user.metadata.creationTime);
                if (creationTime >= date) {
                    afterDateCount += 1;
                }
            });
        } while (nextToken != undefined)
        return afterDateCount;
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
            count += 1;
            console.log(user_id, count);
            users.add(user_id);
        });
        prayerRequestSnapshot.forEach(doc => {
            const data = doc.data();
            const user_id = data.user_id;
            count += 1;
            console.log(user_id, count);
            users.add(user_id);
        });
        testimoniesSnapshot.forEach(doc => {
            const data = doc.data();
            const user_id = data.user_id;
            count += 1;
            console.log(user_id, count);
            users.add(user_id);
        });
        console.log('Total active users: ', users.size);
    }

    async updateAllUserNotificationSettings() {
        console.log('Starting one-time update of all user notification settings...');
        const usersSnapshot = await this.firestore.collection('users').get();
        console.log(`Found ${usersSnapshot.size} users.`);

        let count = 0;
        for (const userDoc of usersSnapshot.docs) {
            const notificationSettingsRef = userDoc.ref.collection('notification_settings');
            const snapshot = await notificationSettingsRef.limit(1).get();

            if (!snapshot.empty) {
                const doc = snapshot.docs[0];
                await doc.ref.set({
                    "daily_engagement_reminder": true,
                    "testimonies": true,
                    "prayers": true,
                    "new_prayer_request": true,
                    "new_testimony": true,
                    "new_forum_thread": true,
                    "forum_comment_likes": true,
                    "forum_comment_replies": true,
                    "forum_thread_comments": true,
                });
                count++;
                if (count % 20 === 0) {
                    console.log(`Updated ${count} users...`);
                }
            } else {
                // Optional: Create if missing? User said "update the doc" implying existence, 
                // but usually good to handle. For now, I'll just log it as the request was specific.
                console.log(`User ${userDoc.id} has no notification_settings doc. Skipping.`);
            }
        }
        console.log(`Finished. Updated ${count} users.`);
    }

    async subscribeAllAdminsToTopics() {
        if (!this.messaging) {
            throw new Error('Messaging service not initialized in UserManagerService');
        }

        console.log('Starting execution of subscribeAllAdminsToTopics...');

        // 1. Get all admin users
        const adminsSnapshot = await this.firestore.collection('users').where('is_admin', '==', true).get();
        console.log(`Found ${adminsSnapshot.size} admin users.`);

        const tokensToSubscribe = [];

        // 2. Collect tokens from each admin's devices
        for (const adminDoc of adminsSnapshot.docs) {
            const devicesSnapshot = await adminDoc.ref.collection('devices').get();
            devicesSnapshot.forEach(deviceDoc => {
                const data = deviceDoc.data();
                if (data.token) {
                    tokensToSubscribe.push(data.token);
                }
            });
        }

        console.log(`Found ${tokensToSubscribe.length} tokens to subscribe.`);

        if (tokensToSubscribe.length === 0) {
            console.log('No tokens found. Exiting.');
            return;
        }

        const topics = [
            'user_signup_notifications',
            'user_delete_request',
            'new_testimony_for_approval',
            'new_prayer_request_for_approval'
        ];

        // 3. Subscribe tokens to each topic
        for (const topic of topics) {
            console.log(`Subscribing tokens to topic: ${topic}`);
            // subscribeToTopic accepts up to 1000 tokens per call.
            // If tokens > 1000, we'd need to chunk, but for admins it's unlikely to exceed.
            // Still, good practice to be aware.
            try {
                const response = await this.messaging.subscribeToTopic(tokensToSubscribe, topic);
                console.log(`Successfully subscribed to ${topic}:`, response.successCount, 'successes,', response.failureCount, 'failures');
                if (response.errors && response.errors.length > 0) {
                    // console.error('Errors:', response.errors);
                }
            } catch (error) {
                console.error(`Error subscribing to ${topic}:`, error);
            }
        }
        console.log('Finished subscribing admins to topics.');
    }
}
