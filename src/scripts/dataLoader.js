const fs = require('fs');
const path = require('path');

const inquirer = require('inquirer');
const ora = require('ora');

const { DataLoaderService } = require('../services/dataLoader');
const { firestore } = require('../../index');

const dataLoader = new DataLoaderService(firestore);

// This is a temporary implementation and should be improved 
// to be a more scalable cli tool. 
// See https://www.twilio.com/blog/how-to-build-a-cli-with-node-js
// for an example

async function promptForDataOptions() {
    const questions = [];

    const dataCollectionOption1 = 'Media';
    const dataCollectionOption2 = 'Bible Series and Series Content';

    // Choose which collection to load 
    questions.push({
        type: 'list',
        name: 'dataCollection',
        message: 'Please choose which collection to load',
        choices: [dataCollectionOption1, dataCollectionOption2],
    });

    // Get response 
    const answers = await inquirer.prompt(questions);

    if (answers.dataCollection === dataCollectionOption1) {
        const questions = [];
        // Get available media data
        const mediaOptions = fs.readdirSync(path.resolve(__dirname) + '/../data/media');

        questions.push({
            type: 'list',
            name: 'mediaChoice',
            message: 'Please choose which collection to load',
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
        await dataLoader.loadMedia(dataToLoad);
        spinner.succeed();

    } else if (answers.dataCollection === dataCollectionOption2) {
        const questions = [];

        // Get available bible series data
        const mediaOptions = fs.readdirSync(path.resolve(__dirname) + '/../data/bible_series');

        questions.push({
            type: 'list',
            name: 'mediaChoice',
            message: 'Please choose which collection to load',
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
        const bibleSeriesId = await dataLoader.loadBibleSeries(dataToLoad['bible_series']);
        spinner.succeed();

        spinner = ora('Inserting Bible Series Content').start();
        await dataLoader.loadSeriesContent(dataToLoad['series_content'], bibleSeriesId);
        spinner.succeed();
    }
}

promptForDataOptions();
