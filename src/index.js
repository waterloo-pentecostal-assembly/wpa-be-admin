// useful link: https://firebase.google.com/docs/admin/setup/#node.js_3
const admin = require("firebase-admin");

const env = process.env.WBA_BE_ENV || 'local';

const config = require("./config/config").getConfig(env);

admin.initializeApp({
    credential: admin.credential.cert(config.serviceAccount),
    databaseURL: config.databaseURL,
});

const firestore = admin.firestore();
const auth = admin.auth();

module.exports = {
    firestore,
    auth
};
