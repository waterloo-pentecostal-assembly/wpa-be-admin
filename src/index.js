// useful link: https://firebase.google.com/docs/admin/setup/#node.js_3
import admin from "firebase-admin";

const env = process.env.WPA_BE_ENV || 'local_dev';

import { getConfig } from "./config/config.js";
const config = getConfig(env);

admin.initializeApp({ credential: admin.credential.cert(config.serviceAccount) });

const firestore = admin.firestore();
const auth = admin.auth();
const messaging = admin.messaging();    

export {
    firestore,
    auth,
    env,
    messaging
};
