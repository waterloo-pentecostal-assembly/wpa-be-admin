exports.getConfig = (env) => {
    if (env === 'local') {
        process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";
        return {
            databaseUrl: "https://wpa-app-test.firebaseio.com"
        };
    }
    else if (env === 'test') {
        delete process.env.FIRESTORE_EMULATOR_HOST;
        return {
            databaseUrl: "https://wpa-app-test.firebaseio.com"
        };
    } else {
        delete process.env.FIRESTORE_EMULATOR_HOST;
        return {
            databaseUrl: "https://wpa-be-app-prod.firebaseio.com"
        };
    }
};