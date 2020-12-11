const path = require('path');

exports.getConfig = (env) => {
    if (env === 'local') {
        process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";

        // Use this once Dart auth package is updated to allow app
        // to point to local auth emulator
        // process.env.FIREBASE_AUTH_EMULATOR_HOST = "localhost:9099";
        
        return {
            databaseUrl: "https://wpa-be-app-dev.firebaseio.com",
            serviceAccount: path.resolve(__dirname) + '/service-account-dev.json'
        };
    }
    else if (env === 'dev') {
        delete process.env.FIRESTORE_EMULATOR_HOST;
        return {
            databaseUrl: "https://wpa-be-app-dev.firebaseio.com",
            serviceAccount: path.resolve(__dirname) + '/service-account-dev.json'
        };
    } else {
        delete process.env.FIRESTORE_EMULATOR_HOST;
        return {
            databaseUrl: "https://wpa-be-app.firebaseio.com",
            serviceAccount: path.resolve(__dirname) + '/service-account.json'
        };
    }
};