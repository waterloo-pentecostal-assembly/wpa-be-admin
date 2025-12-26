import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
    apiKey: "AIzaSyAfrUSJZetuv2UstvDQP4v--hy3PJwE3lE",
    authDomain: "wpa-be-app.firebaseapp.com",
    projectId: "wpa-be-app",
    storageBucket: "wpa-be-app.appspot.com",
    messagingSenderId: "755795301430",
    appId: "1:755795301430:web:4189cdb87c5f25b54fb497",
    measurementId: "G-745202NTVC"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
