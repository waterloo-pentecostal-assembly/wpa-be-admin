import { BACK, ask, askDate, choose, confirmWrite, isoDate, withSpinner } from './prompts.js';

export class UserManagerCli {
    /**
     * @param {import('../services/userManagerService.js').UserManagerService} userManagerService
     * @param {string} env
     */
    constructor(userManagerService, env) {
        this.userManagerService = userManagerService;
        this.env = env;
    }

    async run() {
        const actions = {
            'Verify user by email': () => this.verifyUserByEmail(),
            'Count users who signed up on or after a date': () => this.countUsersAfterDate(),
            'Count active users between two dates': () => this.countActiveUsers(),
            'Subscribe all admins\' devices to the admin notification topics': () => this.subscribeAdmins(),
            'Reset every user\'s notification settings to all on  [writes]': () => this.resetNotificationSettings(),
            'Clean up invalid device tokens  [deletes]': () => this.cleanupInvalidTokens(),
        };
        const option = await choose('Users: choose an option', Object.keys(actions));
        if (option === BACK) return;
        await actions[option]();
    }

    async verifyUserByEmail() {
        const email = await ask('Email', { required: true });
        await withSpinner(`Verifying user ${email}`, () => this.userManagerService.verifyUserByEmail(email));
    }

    async countUsersAfterDate() {
        const date = await askDate('Signed up on or after');
        const count = await withSpinner('Counting sign-in accounts', () => this.userManagerService.getAllUsersAfterDate(date));
        console.log(`${count} users signed up on or after ${isoDate(date)}.`);
    }

    async countActiveUsers() {
        const start = await askDate('From (inclusive)');
        const end = await askDate('To (exclusive)', { default: isoDate(new Date()) });
        const { activeUsers, records } = await withSpinner(
            'Reading completions, prayer requests and testimonies',
            () => this.userManagerService.getActiveUsersBetweenDates(start, end),
        );
        console.log(`${activeUsers} active users from ${isoDate(start)} to ${isoDate(end)} (${records} completions, prayer requests and testimonies; each kind capped at 30,000).`);
    }

    async subscribeAdmins() {
        if (!(await confirmWrite(this.env, 'Subscribe every admin\'s devices to the admin FCM topics?'))) return;
        await this.userManagerService.subscribeAllAdminsToTopics();
    }

    async resetNotificationSettings() {
        const ok = await confirmWrite(this.env, 'Overwrite EVERY user\'s notification settings with all notifications on? Users\' own choices are lost.');
        if (!ok) return;
        await this.userManagerService.updateAllUserNotificationSettings();
    }

    async cleanupInvalidTokens() {
        const ok = await confirmWrite(this.env, 'Check every device token (FCM dry-run send) and DELETE devices whose token is missing or no longer valid?');
        if (!ok) return;
        await this.userManagerService.cleanupInvalidTokens();
    }
}
