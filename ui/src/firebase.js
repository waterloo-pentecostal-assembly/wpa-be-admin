import { initializeApp } from "firebase/app";
import { getAuth, signOut } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

let app;
let auth;
let db;

let initializing = null;

/**
 * Initializes Firebase by fetching config from the server.
 * This allows us to use Repder Secret Files loaded by the backend.
 * Safe to call from several places at once: they share one initialization.
 */
export const initFirebase = () => {
    if (app) return Promise.resolve({ auth, db });
    initializing ??= (async () => {
        try {
            // Plain fetch: this is one of the API routes that needs no sign-in.
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
            initializing = null; // let a later call retry
            throw error;
        }
    })();
    return initializing;
};

/**
 * The signed-in user's Firebase ID token for API calls, or null if nobody is
 * signed in. Waits for Firebase to restore a saved sign-in after a page load,
 * and refreshes the token when it is about to expire (or always, with
 * `forceRefresh`, e.g. after the server rejected it).
 */
export async function getIdToken(forceRefresh = false) {
    const { auth: authInstance } = await initFirebase();
    await authInstance.authStateReady();
    return authInstance.currentUser ? authInstance.currentUser.getIdToken(forceRefresh) : null;
}

/**
 * Signs out after the session was rejected even with a fresh token; the
 * protected routes then send the user to the sign-in page.
 */
export async function endExpiredSession() {
    if (auth?.currentUser) await signOut(auth);
}

export const getAuthInstance = () => auth;
export const getDbInstance = () => db;
