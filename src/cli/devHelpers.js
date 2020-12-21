const inquirer = require('inquirer');
const ora = require('ora');

class DevHelpersCli {

    constructor(userManagerService, env) {
        this.userManagerService = userManagerService;
        this.allowedEnvs = ['dev', 'local_dev'];
        this.env = env;
    }

    async run() {
        this.canRunInEnv();
        return this.promptForOptions();
    }

    canRunInEnv() {
        if (!(this.env in this.allowedEnvs)) {
            throw new Error(`Cannot run in ${env}`);
        }
    }

    async promptForOptions() {
        const createVerifiedUserOption = 'Create verified user';

        const option = await inquirer.prompt(
            {
                type: 'list',
                name: 'option',
                message: 'Choose option: ',
                choices: [createVerifiedUserOption],
            }
        );

        switch (option.option) {
            case createVerifiedUserOption:
                await this.createVerifiedUser();
                break;
        }
    }

    async createVerifiedUser() {
        const defaultFirstName = 'test';
        const defaultLastName = `user-${Date.now().valueOf()}`;

        let firstName = await inquirer.prompt(
            {
                type: 'input',
                name: 'value',
                message: 'First Name',
                default: defaultFirstName,
            }
        );

        let lastName = await inquirer.prompt(
            {
                type: 'input',
                name: 'value',
                message: 'Last Name',
                default: defaultLastName,
            }
        );

        firstName = firstName.value;
        lastName = lastName.value;

        const defaultEmail = `${firstName}.${lastName}@mail.com`;
        const defaultPassword = '12345678';

        let email = await inquirer.prompt(
            {
                type: 'input',
                name: 'value',
                message: 'Email',
                default: defaultEmail,
            }
        );

        let password = await inquirer.prompt(
            {
                type: 'input',
                name: 'value',
                message: 'Password',
                default: defaultPassword,
            }
        );

        email = email.value;
        password = password.value;

        let spinner;
        let userRecord;

        // Create verified auth user
        try {
            spinner = ora('Creating verified user').start();
            userRecord = await this.userManagerService.createVerifiedUser(email, password);
            spinner.succeed();
        } catch (e) {
            spinner.fail(`Error creating verified user: ${e}`);
            return;
        }

        // Create user document
        try {
            spinner = ora('Creating user document').start();
            await this.userManagerService.createUserDocument(email, firstName, lastName);
            spinner.succeed();
        } catch (e) {
            spinner.fail(`User document creation failed. Error: ${e}.
                          Please manually delete auth user 
                          (UID: ${userRecord.uid}) and try again`);
            return;
        }

        // Create notification document
        try {
            spinner = ora('Creating notification settings document').start();
            await this.userManagerService.createDefaultNotificationSettings(email);
            spinner.succeed();
        } catch (e) {
            spinner.fail(`Notification settings document creation failed. Error: ${e}.
                          Please manually delete auth user (UID: ${userRecord.uid}) 
                          and associated user document and try again`);
            return;
        }
    }
}

module.exports = {
    DevHelpersCli,
};