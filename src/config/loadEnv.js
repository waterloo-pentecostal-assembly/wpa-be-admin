// Loads a local `.env` file (git-ignored) into process.env for development.
// Import this first, before anything reads process.env. Variables already set
// in the environment win over the file, and a missing file is fine: on Render
// the settings come from the dashboard.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ENV_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.env');

if (fs.existsSync(ENV_FILE)) {
    if (typeof process.loadEnvFile === 'function') {
        process.loadEnvFile(ENV_FILE);
    } else {
        console.warn(`Not loading ${ENV_FILE}: this Node version (${process.version}) has no process.loadEnvFile; set the variables in the environment`);
    }
}
