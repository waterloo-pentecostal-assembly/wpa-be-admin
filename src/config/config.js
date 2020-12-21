const fs = require('fs');
const path = require('path');

exports.getConfig = (env) => {
    if (env === 'local_dev') {
        const serviceAccountFile = path.resolve(__dirname) + '/service-account-dev.json';
        let serviceAccount;

        // TODO: Use this once Dart auth package is updated to allow app
        // to point to local auth emulator
        // process.env.FIREBASE_AUTH_EMULATOR_HOST = "localhost:9099";
        process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";

        // Use environment variable is it exists
        if (process.env.SERVICE_ACCOUNT_CREDENTIALS) {
            serviceAccount = JSON.parse(process.env.SERVICE_ACCOUNT_CREDENTIALS); 
        } else if (fs.existsSync(serviceAccountFile)) {
            serviceAccount = path.resolve(__dirname) + '/service-account-dev.json';
        } else {
            throw new Error('Unable to find service account credentials');
        }

        return {
            databaseUrl: "https://wpa-be-app-dev.firebaseio.com",
            serviceAccount
        };
    }
    else if (env === 'dev') {
        const serviceAccountFile = path.resolve(__dirname) + '/service-account-dev.json';
        let serviceAccount;

        // Use environment variable is it exists
        if (process.env.SERVICE_ACCOUNT_CREDENTIALS) {
            serviceAccount = JSON.parse(process.env.SERVICE_ACCOUNT_CREDENTIALS); 
        } else if (fs.existsSync(serviceAccountFile)) {
            serviceAccount = path.resolve(__dirname) + '/service-account-dev.json';
        } else {
            throw new Error('Unable to find service account credentials');
        }

        return {
            databaseUrl: "https://wpa-be-app-dev.firebaseio.com",
            serviceAccount
        };
    } else if (env === 'prod') {
        delete process.env.FIRESTORE_EMULATOR_HOST;
        process.env.GOOGLE_APPLICATION_CREDENTIALS = path.resolve(__dirname) + '/service-account.json';
        return {
            databaseUrl: "https://wpa-be-app.firebaseio.com",
            serviceAccount: path.resolve(__dirname) + '/service-account.json'
        };
    } else {
        throw new Error(`invalid env: ${env}`);
    }
};