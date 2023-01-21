const fs = require('fs');
const path = require('path');

const inquirer = require('inquirer');
const ora = require('ora');

class DataFetchingCli {
    /**
     * @param {import('../services/dataFetchingService').DataFetchingService} dataFetchingService 
     */
    constructor(dataFetchingService) {
        this.dataFetchingService = dataFetchingService;
    }

    async run() {
        return this.promptForOptions();
    }

    async promptForOptions() {
        const choices = {
            generateProgressData: 'Generate Progress Data'
        };

        const option = await inquirer.prompt(
            {
                type: 'list',
                name: 'option',
                message: 'Choose option: ',
                choices: Object.values(choices),
            }
        );

        switch (option.option) {
            case choices.generateProgressData:
                await this.getProgressData();
                break;
        }
    }

    async getProgressData() {
        let spinner = ora('Getting data');
        spinner.start();
        const progressData = await this.dataFetchingService.getProgressData();
        spinner.succeed();

        spinner = ora('Writing to file');
        spinner.start();
        const progressCsv = progressData.join(',');
        fs.writeFileSync(path.resolve(__dirname) + `/../data/progress_records/${Date.now().toLocaleString()}.csv`, progressCsv);
        spinner.succeed();
    }
}

module.exports = {
    DataFetchingCli
};
