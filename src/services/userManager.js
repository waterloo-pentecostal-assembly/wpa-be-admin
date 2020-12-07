class UserManagerService {
    constructor(firebase, auth) {
        this.auth = auth;
        this.firebase = firebase;
    }

    async verifyUser(email) {
        try {
            const userId = await this.auth.getUserByEmail(email);
            const userRecord = await updateUser(uid, {emailVerified: true});
            return userRecord.toJSON();
        } catch (e) {
            throw(new Error(`Unable to verify user (${email})`));
        }
    }

    async createVerifiedUser() {
        try {
            // Create auth user
            // Get userId
            // Add information to firestore 
        } catch (e) {
            throw(new Error(`Unable to verify user (${email})`));
        }
    }
}