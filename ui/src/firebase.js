import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

let app;
let auth;
let db;

/**
 * Initializes Firebase by fetching config from the server.
 * This allows us to use Repder Secret Files loaded by the backend.
 */
export const initFirebase = async () => {
    if (app) return { auth, db };

    try {
        const response = await fetch('/api/firebase-config');
        if (!response.ok) {
            throw new Error(`Failed to load Firebase config: ${response.statusText}`);
        }

        const firebaseConfig = await response.json();

        app = initializeApp(firebaseConfig);
        auth = getAuth(app);
        db = getFirestore(app);

        return { auth, db };
    } catch (error) {
        console.error("Firebase initialization failed:", error);
        throw error;
    }
};

export const getAuthInstance = () => auth;
export const getDbInstance = () => db;
