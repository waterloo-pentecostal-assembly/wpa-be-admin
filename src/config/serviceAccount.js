// Firebase Admin credentials for the prod or dev project, from (in order) a
// Render Secret File, an environment variable, or a local file in this
// directory (service-account.json / service-account-dev.json).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * @param {'prod'|'dev'} env
 * @returns {object|null} parsed service account JSON, or null when none is found
 */
export function loadServiceAccount(env) {
    let serviceAccount = null;
    const filename = env === 'dev' ? 'service-account-dev.json' : 'service-account.json';

    // 1. Try Render Secret File (Production)
    const renderSecretPath = `/etc/secrets/${filename}`;
    if (fs.existsSync(renderSecretPath)) {
        try {
            serviceAccount = JSON.parse(fs.readFileSync(renderSecretPath, 'utf8'));
            console.log(`Loaded Firebase ${env} credentials from Render Secret File`);
        } catch (e) {
            console.error("Failed to parse Render Secret File", e);
        }
    }

    // 2. Try Environment Variable (Fallback)
    const envVarName = env === 'dev' ? 'FIREBASE_SERVICE_ACCOUNT_DEV' : 'FIREBASE_SERVICE_ACCOUNT';
    if (!serviceAccount && process.env[envVarName]) {
        try {
            serviceAccount = JSON.parse(process.env[envVarName]);
            console.log(`Loaded Firebase ${env} credentials from Environment Variable`);
        } catch (e) {
            console.error(`Failed to parse ${envVarName} env var`, e);
        }
    }

    // 3. Try Local File (Development)
    if (!serviceAccount) {
        const serviceAccountPath = path.join(__dirname, filename);
        if (fs.existsSync(serviceAccountPath)) {
            serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
            console.log(`Loaded Firebase ${env} credentials from local file: ${filename}`);
        }
    }
    return serviceAccount;
}
