// useful link: https://firebase.google.com/docs/admin/setup/#node.js_3
const admin = require("firebase-admin");

const env = 'local';

const config = require("./src/config/config").getConfig(env);
const serviceAccount = require("./src/config/service-account.json");

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: config.databaseURL,
});

const firestore = admin.firestore();
const auth = admin.auth();
const Timestamp = admin.firestore.Timestamp;

module.exports = {
    firestore,
    auth,
    Timestamp
};
