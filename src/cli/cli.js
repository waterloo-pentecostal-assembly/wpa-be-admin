// See https://www.twilio.com/blog/how-to-build-a-cli-with-node-js

const inquirer = require('inquirer');

const { firestore, auth, env } = require('../index');
const { DataLoaderCli } = require('./dataLoader');
const { DevHelpersCli } = require('./devHelpers');
const { UserManagerCli } = require('./userManager');
const { DataLoaderService } = require('../services/dataLoader');
const { UserManagerService } = require('../services/userManager');

class AdminCli {
    constructor(dataLoaderCli, devHelpersCli, userManagerCli) {
        this.dataLoaderCli = dataLoaderCli;
        this.devHelpersCli = devHelpersCli;
        this.userManagerCli = userManagerCli;
    }

    async run() {
        return this.promptForOptions();
    }

    async promptForOptions() {

        const userManagerOption = 'Manage Users';
        const dataLoaderOption = 'Load Data';
        const devHelperOption = 'Development Assist';
        const options = [userManagerOption, dataLoaderOption, devHelperOption];

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
const userManagerService = new UserManagerService(firestore, auth);

const dataLoaderCli = new DataLoaderCli(dataLoaderService);
const devHelpersCli = new DevHelpersCli(userManagerService, env);
const userManagerCli = new UserManagerCli(userManagerService);

const adminCli = new AdminCli(dataLoaderCli, devHelpersCli, userManagerCli);

adminCli.run();