// Has Firebase Authentication send its own emails (the templates set up in
// the Firebase console, the same ones the app sends). The Admin SDK can only
// generate action links, so this uses the Identity Toolkit REST API with the
// project's web API key, like the client SDKs do.
//
// A password reset email needs only the address. A verification email must
// be requested with the user's own ID token, so the server signs in as the
// user with a one-off custom token first. That sign-in updates the user's
// "last sign-in" time; the session it creates is discarded.

const IDENTITY_TOOLKIT = 'https://identitytoolkit.googleapis.com/v1';

export class AuthEmailError extends Error {
    constructor(message, status = 502) {
        super(message);
        this.name = 'AuthEmailError';
        this.status = status;
    }
}

// Identity Toolkit error codes (the start of error.message) worth explaining.
const ERRORS = {
    TOO_MANY_ATTEMPTS_TRY_LATER: [429, 'Firebase is limiting emails to this account right now; try again later or copy a link instead'],
    USER_DISABLED: [409, 'This account is deactivated; reactivate it before sending emails'],
    EMAIL_NOT_FOUND: [404, 'Firebase has no account with this email'],
    USER_NOT_FOUND: [404, 'Firebase has no account with this user ID'],
    CREDENTIAL_MISMATCH: [500, "The web API key for this environment belongs to a different Firebase project"],
    INVALID_CUSTOM_TOKEN: [500, "The web API key for this environment belongs to a different Firebase project"],
};

/** @param {string} message Identity Toolkit's error.message, e.g. "TOO_MANY_ATTEMPTS_TRY_LATER : ..." */
function explain(message) {
    const code = message.split(/[\s:]/)[0];
    if (ERRORS[code]) return new AuthEmailError(ERRORS[code][1], ERRORS[code][0]);
    if (/API key not valid|API_KEY_INVALID/i.test(message)) return new AuthEmailError('The web API key for this environment is not valid', 500);
    return new AuthEmailError(`Firebase could not send the email (${message})`);
}

/**
 * @param {{ apiKey: string, auth: import('firebase-admin').auth.Auth, fetch?: typeof fetch }} options
 */
export function createAuthEmailSender({ apiKey, auth, fetch: fetchImpl = globalThis.fetch }) {
    async function call(method, body) {
        let res;
        try {
            res = await fetchImpl(`${IDENTITY_TOOLKIT}/accounts:${method}?key=${encodeURIComponent(apiKey)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
        } catch (error) {
            throw new AuthEmailError(`Could not reach Firebase: ${error.message}`);
        }
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw explain(String(data?.error?.message || res.status));
        return data;
    }

    return {
        /** Sends Firebase's password reset email to `email`. */
        async sendPasswordResetEmail(email) {
            await call('sendOobCode', { requestType: 'PASSWORD_RESET', email });
        },

        /** Sends Firebase's email verification email to the user `uid`. */
        async sendVerificationEmail(uid) {
            const customToken = await auth.createCustomToken(uid);
            const { idToken } = await call('signInWithCustomToken', { token: customToken, returnSecureToken: true });
            await call('sendOobCode', { requestType: 'VERIFY_EMAIL', idToken });
        },
    };
}
