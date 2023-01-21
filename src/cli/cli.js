// See https://www.twilio.com/blog/how-to-build-a-cli-with-node-js

const inquirer = require('inquirer');

const { firestore, auth, env } = require('../index');
const { DataLoaderCli } = require('./dataLoader');
const { DataFetchingCli } = require('./dataFetching');
const { DevHelpersCli } = require('./devHelpers');
const { UserManagerCli } = require('./userManager');
const { DataLoaderService } = require('../services/dataLoaderService');
const { DataFetchingService } = require('../services/dataFetchingService');
const { UserManagerService } = require('../services/userManagerService');
const { DataDeletingService } = require('../services/dataDeletingService');

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

        switch(option.option){
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
const userManagerService = new UserManagerService(firestore, auth);
const dataDeletingService = new DataDeletingService(firestore, auth);

const dataLoaderCli = new DataLoaderCli(dataLoaderService);
const dataFetchingCli = new DataFetchingCli(dataFetchingService);
const devHelpersCli = new DevHelpersCli(userManagerService, env);
const userManagerCli = new UserManagerCli(userManagerService);

const adminCli = new AdminCli(dataLoaderCli, dataFetchingCli, devHelpersCli, userManagerCli);

// adminCli.run();

// --- ADHOC ---
async function main() {
    await userManagerService.getAllUsersAfterDate(new Date('January 1, 2022'));
    // await dataFetchingService.getEngagementCountByType('bDAV2va3PTR73C4hw1lF');
    // await dataFetchingService.getCompletionsByType('devotional', 'bDAV2va3PTR73C4hw1lF');
    // await dataDeletingService.deleteOldPrayerRequests(new Date(Date.UTC(2022,9,1,0,0,0)));
}
main();