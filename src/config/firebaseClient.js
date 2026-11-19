// The Firebase web (client) config and web API keys. Neither is secret: the
// browser receives the client config, and the web API key only identifies the
// project to Firebase Authentication's REST API (used to send Auth emails and
// for the CLI scripts' admin sign-in).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * The Firebase web (client) config the console signs in with: Render Secret
 * File, then the FIREBASE_CLIENT_CONFIG env var, then
 * src/config/firebase-client-config.json. Throws if a config file can't be parsed.
 */
export function loadClientConfig() {
    return loadClientConfigFor('prod');
}

/**
 * The Firebase web (client) config for one environment's project. prod is the
 * console's (see loadClientConfig); dev reads firebase-client-config-dev.json
 * (Render Secret File or src/config/) or FIREBASE_CLIENT_CONFIG_DEV.
 * Throws if a config file can't be parsed.
 */
export function loadClientConfigFor(env) {
    const dev = env === 'dev';
    const filename = dev ? 'firebase-client-config-dev.json' : 'firebase-client-config.json';
    const envVar = dev ? 'FIREBASE_CLIENT_CONFIG_DEV' : 'FIREBASE_CLIENT_CONFIG';
    const renderSecretPath = `/etc/secrets/${filename}`;
    if (fs.existsSync(renderSecretPath)) return JSON.parse(fs.readFileSync(renderSecretPath, 'utf8'));
    if (process.env[envVar]) {
        try {
            return JSON.parse(process.env[envVar]);
        } catch (e) {
            console.error(`Failed to parse ${envVar} env var`, e);
        }
    }
    const localConfigPath = path.join(__dirname, filename);
    if (fs.existsSync(localConfigPath)) return JSON.parse(fs.readFileSync(localConfigPath, 'utf8'));
    return null;
}

export const webApiKeyVar = (env) => (env === 'dev' ? 'FIREBASE_WEB_API_KEY_DEV' : 'FIREBASE_WEB_API_KEY');

/**
 * The web API key for a project (a service account has none):
 * FIREBASE_WEB_API_KEY / FIREBASE_WEB_API_KEY_DEV, else the apiKey in that
 * environment's client config (firebase-client-config.json /
 * firebase-client-config-dev.json) when it is for `projectId` (or projectId
 * is unknown).
 */
export function loadWebApiKey(env, projectId) {
    if (process.env[webApiKeyVar(env)]) return process.env[webApiKeyVar(env)];
    try {
        const clientConfig = loadClientConfigFor(env);
        if (clientConfig?.apiKey && (!projectId || clientConfig.projectId === projectId)) return clientConfig.apiKey;
    } catch (error) {
        console.error('Could not read the Firebase client config for its API key:', error.message);
    }
    return null;
}
