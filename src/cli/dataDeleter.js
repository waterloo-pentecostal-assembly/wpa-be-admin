const fs = require('fs');
const path = require('path');

const inquirer = require('inquirer');
const ora = require('ora');

class DataDeleterCli {
    constructor(dataDeletingService) {
        this.dataDeletingService = dataDeletingService;
    }

    async run() {
        return this.promptForOptions();
    }

    async promptForOptions() {
        const questions = [];
        const choices = ['Delete old Prayer Requests'];

        // Choose which collection to load 
        questions.push({
            type: 'list',
            name: 'dataDeletion',
            message: 'Choose an option',
            choices,
        });

        // Get response 
        const answers = await inquirer.prompt(questions);

        if (answers.dataDeletion === choices[0]) {
            const questions = [];
            // Get available media data
            const mediaOptions = fs.readdirSync(path.resolve(__dirname) + '/../data/media');

            questions.push({
                type: 'list',
                name: 'mediaChoice',
                message: 'Please choose data file',
                choices: mediaOptions,
            });

            const answers = await inquirer.prompt(questions);

            // Confirm data load
            const proceed = await inquirer.prompt(
                {
                    type: 'confirm',
                    name: 'proceed',
                    message: 'This data will be duplicated if it already exists, proceed?',
                    default: false,
                }
            );

            if (!proceed.proceed) {
                return;
            }

            let dataToLoad = JSON.parse(fs.readFileSync(path.resolve(__dirname) + `/../data/media/${answers.mediaChoice}`));
            // TODO: Match data against schema for validation
            dataToLoad = dataToLoad['media'];

            let spinner = ora('Inserting Media');
            spinner.start();
            await this.dataDeletingService.loadMedia(dataToLoad);
            spinner.succeed();

        } else if (answers.dataCollection === dataCollectionOption2) {
            const questions = [];

            // Get available bible series data
            const mediaOptions = fs.readdirSync(path.resolve(__dirname) + '/../data/bible_series');

            questions.push({
                type: 'list',
                name: 'mediaChoice',
                message: 'Please choose data file',
                choices: mediaOptions,
            });

            const answers = await inquirer.prompt(questions);

            // Confirm data load
            const proceed = await inquirer.prompt(
                {
                    type: 'confirm',
                    name: 'proceed',
                    message: 'This data will be duplicated if it already exists, proceed?',
                    default: false,
                }
            );

            if (!proceed.proceed) {
                return;
            }

            let dataToLoad = JSON.parse(
                fs.readFileSync(path.resolve(__dirname) + `/../data/bible_series/${answers.mediaChoice}`)
            );

            let spinner = ora('Inserting Bible Series');
            spinner.start();
            const bibleSeriesId = await this.dataDeletingService.loadBibleSeries(dataToLoad['bible_series']);
            spinner.succeed();

            spinner = ora('Inserting Bible Series Content').start();
            await this.dataDeletingService.loadSeriesContent(dataToLoad['series_content'], bibleSeriesId);
            spinner.succeed();
        }
    }
}

module.exports = {
    DataDeleterCli
};