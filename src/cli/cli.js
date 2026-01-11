// See https://www.twilio.com/blog/how-to-build-a-cli-with-node-js

import inquirer from 'inquirer';

import { firestore, auth, env, messaging } from '../index.js';
import { DataLoaderCli } from './dataLoader.js';
import { DataFetchingCli } from './dataFetching.js';
import { DevHelpersCli } from './devHelpers.js';
import { UserManagerCli } from './userManager.js';
import { DataLoaderService } from '../services/dataLoaderService.js';
import { DataFetchingService } from '../services/dataFetchingService.js';
import { UserManagerService } from '../services/userManagerService.js';
// import { DataDeletingService } from '../services/dataDeletingService.js';
// import { DataManagerService } from '../services/dataManagerService.js';

class AdminCli {
    constructor(dataLoaderCli, dataFetchingCli, devHelpersCli, userManagerCli) {
        this.dataLoaderCli = dataLoaderCli;
        this.dataFetchingCli = dataFetchingCli;
        this.devHelpersCli = devHelpersCli;
        this.userManagerCli = userManagerCli;
    }

    async run() {
        return this.promptForOptions();
    }

    async promptForOptions() {

        const userManagerOption = 'Manage Users';
        const dataLoaderOption = 'Load Data';
        const dataFetchingOption = 'Fetch Data';
        const devHelperOption = 'Development Assist';
        const options = [userManagerOption, dataLoaderOption, dataFetchingOption, devHelperOption];

        const option = await inquirer.prompt(
            {
                type: 'list',
                name: 'option',
                message: `[ENV: ${env}] Choose Option: `,
                choices: options,
            }
        );

        switch (option.option) {
            case userManagerOption:
                await this.userManagerCli.run();
                break;
            case dataLoaderOption:
                await this.dataLoaderCli.run();
                break;
            case devHelperOption:
                await this.devHelpersCli.run();
                break;
            case dataFetchingOption:
                await this.dataFetchingCli.run();
        }

        const again = await inquirer.prompt(
            {
                type: 'confirm',
                name: 'again',
                message: 'Would you like to perform another operation?',
                default: false,
            }
        );

        if (again.again) {
            this.promptForOptions();
        }
        return;
    }
}

// Inject dependencies
const dataLoaderService = new DataLoaderService(firestore);
const dataFetchingService = new DataFetchingService(firestore);
// const dataManagerService = new DataManagerService(firestore);
const userManagerService = new UserManagerService(firestore, auth, messaging);
// const dataDeletingService = new DataDeletingService(firestore, auth);

const dataLoaderCli = new DataLoaderCli(dataLoaderService);
const dataFetchingCli = new DataFetchingCli(dataFetchingService);
const devHelpersCli = new DevHelpersCli(userManagerService, env);
const userManagerCli = new UserManagerCli(userManagerService);

const adminCli = new AdminCli(dataLoaderCli, dataFetchingCli, devHelpersCli, userManagerCli);

// adminCli.run();

// --- ADHOC ---
async function main() {
    // await userManagerService.getAllUsersAfterDate(new Date('October 6, 2025'));
    // await userManagerService.getActiveUsersBetweenDates(new Date('January 1, 2025'), new Date('August 21, 2025'));
    // await dataFetchingService.getEngagementCountByType('MMOCISOqyI8egl5kd6VL');
    // await dataFetchingService.getUniqueUsersForSeries('6r2eXvUx4GKzMUeBUvHh');
    // await dataFetchingService.getCompletionsByType('devotional', 'JSyJhGV0wmpEPNf7R6VN');
    // await dataDeletingService.deleteOldPrayerRequests(new Date(Date.UTC(2022,9,1,0,0,0)));
    // await dataManagerService.updateYoutubeLinks();
    // await userManagerService.updateAllUserNotificationSettings();
    await userManagerService.subscribeAllAdminsToTopics();
}
main();