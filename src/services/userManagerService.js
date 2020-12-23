// See https://firebase.google.com/docs/auth/admin/manage-users#update_a_user

class UserManagerService {
    constructor(firestore, auth) {
        this.auth = auth;
        this.firestore = firestore;
    }

    async verifyUserByEmail(email) {
        // Find user by email
        const userRecordBefore = await this.auth.getUserByEmail(email);
        const uid = userRecordBefore.uid;

        // Verify user
        const userRecordAfter = await this.auth.updateUser(uid, { emailVerified: true });
        return userRecordAfter;
    }

    async verifyUserById(uid) {
        const userRecordAfter = await this.auth.updateUser(uid, { emailVerified: true });
        return userRecordAfter;
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

    async createVerifiedUser(email, password) {
        // Create auth user
        const userRecord = await this.auth.createUser({
            email,
            emailVerified: true,
            password,
        });

        return userRecord;
    }

    async createUserDocument(email, firstName, lastName) {
        // Find user by email
        const userRecordBefore = await this.auth.getUserByEmail(email);
        const uid = userRecordBefore.uid;

        // Add information to firestore 
        await this.firestore.collection('users').doc(uid).set({
            "email": email,
            "first_name": firstName,
            "last_name": lastName,
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
}

module.exports = {
    UserManagerService
};