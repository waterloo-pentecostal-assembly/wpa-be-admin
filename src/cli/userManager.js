const inquirer = require('inquirer');
const ora = require('ora');

class UserManagerCli {
    constructor(userManagerService) {
        this.userManagerService = userManagerService;
    }

    async run() {
        return this.promptForOptions();
    }

    async promptForOptions() {
        const verifyUserByEmail = 'Verify user by email';

        const option = await inquirer.prompt(
            {
                type: 'list',
                name: 'option',
                message: 'Choose option: ',
                choices: [verifyUserByEmail],
            }
        );

        switch (option.option) {
            case verifyUserByEmail:
                await this.verifyUserByEmail();
                break;
        }
    }

    async verifyUserByEmail() {
        // Prompt for email
        let email = await inquirer.prompt(
            {
                type: 'input',
                name: 'value',
                message: 'Email',
            }
        );

        email = email.value;
        let spinner; 
        
        // Verify user
        try {
            spinner = ora(`Verifying user ${email}`).start();
            await this.userManagerService.verifyUserByEmail(email);
            spinner.succeed();
        } catch (e) {
            spinner.fail(`Error verifying user: ${e}`);
            return;
        }
    }

}

module.exports = {
    UserManagerCli
};