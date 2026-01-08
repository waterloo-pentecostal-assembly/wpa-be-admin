export class NotificationTestingService {
    constructor(admin) {
        this.admin = admin;
    }

    async sendTestNotification(token, title, body, data) {
        if (!this.admin) {
            throw new Error('Firebase Admin not initialized');
        }

        const message = {
            notification: {
                title,
                body
            },
            token: token
        };

        if (data) {
            message.data = data;
        }
        
        try {
            const response = await this.admin.messaging().send(message);
            return response;
        } catch (error) {
            console.error('Error in NotificationTestingService:', error);
            throw error;
        }
    }
}
