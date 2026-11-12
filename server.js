
import express from 'express';
import fs from 'fs';
import path from 'path';
import cors from 'cors';
import { fileURLToPath } from 'url';
import admin from 'firebase-admin';
import { DataFetchingService } from './src/services/dataFetchingService.js';
import { UserManagerService } from './src/services/userManagerService.js';
import { UserAdminService, createImageSigner } from './src/services/userAdminService.js';
import { createAuthEmailSender } from './src/services/authEmailService.js';
import { DataLoaderService } from './src/services/dataLoaderService.js';
import { NotificationHubService } from './src/services/notificationHubService.js';
import { generateSeriesFromOutline, populateBibleVerses } from './src/services/bibleSeriesGeneratorService.js';
import { loadBibleService } from './src/services/bibleService.js';
import { createBibleRouter } from './src/routes/bibleRoutes.js';
import { DraftService } from './src/services/draftService.js';
import { StorageService } from './src/services/storageService.js';
import { PublishService } from './src/services/publishService.js';
import { PublishedSeriesService } from './src/services/publishedSeries.js';
import { createRecompiler } from './src/services/seriesBaseline.js';
import { createDraftRouter, createOembedRouter, createPublishedRouter, createStorageRouter } from './src/routes/seriesBuilderRoutes.js';
import { createUserRouter } from './src/routes/userRoutes.js';
import { createRequireAdmin, protectApi } from './src/routes/apiAuth.js';
import { createNotificationRouter } from './src/routes/notificationRoutes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Global Service Variables
let db = null;
let auth = null;
let dataFetchingService = null;
let userManagerService = null;
let userAdminService = null;
let currentProjectId = null;
let dataLoaderService = null;
let notificationHubService = null;
let storageService = null;
let publishedSeriesService = null;
let currentEnv = 'prod'; // 'prod' or 'dev'

// Series builder drafts are kept per environment, in that environment's own
// Firestore: the env switcher changes which drafts are listed, and a draft is
// moved across with "Copy to prod/dev". Each env has its own named Firebase
// app so draft storage survives the default app being recreated on a switch.
const draftStores = {}; // env -> { service: DraftService, projectId, app }

function loadServiceAccount(env) {
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
        const serviceAccountPath = path.join(__dirname, 'src', 'config', filename);
        if (fs.existsSync(serviceAccountPath)) {
            serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
            console.log(`Loaded Firebase ${env} credentials from local file: ${filename}`);
        }
    }
    return serviceAccount;
}

/**
 * The Firebase web (client) config: Render Secret File, then the
 * FIREBASE_CLIENT_CONFIG env var, then src/config/firebase-client-config.json.
 * Throws if a config file can't be parsed.
 */
function loadClientConfig() {
    const renderSecretPath = '/etc/secrets/firebase-client-config.json';
    if (fs.existsSync(renderSecretPath)) return JSON.parse(fs.readFileSync(renderSecretPath, 'utf8'));
    if (process.env.FIREBASE_CLIENT_CONFIG) {
        try {
            return JSON.parse(process.env.FIREBASE_CLIENT_CONFIG);
        } catch (e) {
            console.error("Failed to parse FIREBASE_CLIENT_CONFIG env var", e);
        }
    }
    const localConfigPath = path.join(__dirname, 'src', 'config', 'firebase-client-config.json');
    if (fs.existsSync(localConfigPath)) return JSON.parse(fs.readFileSync(localConfigPath, 'utf8'));
    return null;
}

const webApiKeyVar = (env) => (env === 'dev' ? 'FIREBASE_WEB_API_KEY_DEV' : 'FIREBASE_WEB_API_KEY');

/**
 * The web API key Firebase Authentication emails are sent with (a service
 * account has none): FIREBASE_WEB_API_KEY / FIREBASE_WEB_API_KEY_DEV, else
 * the client config's apiKey when it is for this environment's project.
 */
function loadWebApiKey(env, projectId) {
    if (process.env[webApiKeyVar(env)]) return process.env[webApiKeyVar(env)];
    try {
        const clientConfig = loadClientConfig();
        if (clientConfig?.apiKey && clientConfig.projectId === projectId) return clientConfig.apiKey;
    } catch (error) {
        console.error('Could not read the Firebase client config for its API key:', error.message);
    }
    return null;
}

// Cover images go to the project's default bucket (<project>.appspot.com,
// matching existing image_gs_location values) unless overridden.
function storageBucketFor(env, serviceAccount) {
    const override = env === 'dev' ? process.env.FIREBASE_STORAGE_BUCKET_DEV : process.env.FIREBASE_STORAGE_BUCKET;
    return override || `${serviceAccount.project_id}.appspot.com`;
}

function initializeDraftStorage() {
    for (const env of ['prod', 'dev']) {
        const serviceAccount = loadServiceAccount(env);
        if (!serviceAccount) continue;
        try {
            const app = admin.initializeApp({ credential: admin.credential.cert(serviceAccount) }, `series-drafts-${env}`);
            const service = new DraftService(app.firestore(), { env });
            draftStores[env] = { service, projectId: serviceAccount.project_id, app };
            console.log(`Series builder ${env} drafts stored in ${serviceAccount.project_id}`);
            // Drafts written before the snake_case keys are rewritten once; they
            // are readable either way, so this runs in the background.
            service.migrateKeys()
                .then((count) => count && console.log(`Migrated ${count} ${env} drafts to snake_case keys`))
                .catch((error) => console.error(`Could not migrate ${env} draft keys:`, error));
        } catch (error) {
            console.error(`Failed to initialize ${env} draft storage:`, error);
        }
    }
    if (!Object.keys(draftStores).length) {
        console.warn('No Firebase credentials found for draft storage. The series builder will keep drafts in the browser only.');
    }
}

async function initializeFirebase(env = 'prod') {
    try {
        // If an app already exists, delete it
        if (admin.apps.some((a) => a.name === '[DEFAULT]')) {
            await admin.app().delete();
            storageService = null;
            publishedSeriesService = null;
            userAdminService = null;
            notificationHubService = null;
        }

        const serviceAccount = loadServiceAccount(env);

        if (serviceAccount) {
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount),
                storageBucket: storageBucketFor(env, serviceAccount)
            });
            console.log(`Firebase Admin Initialized (${env})`);

            // Re-instantiate services
            db = admin.firestore();
            auth = admin.auth();
            const messaging = admin.messaging();
            dataFetchingService = new DataFetchingService(db);
            userManagerService = new UserManagerService(db, auth, messaging);
            const webApiKey = loadWebApiKey(env, serviceAccount.project_id);
            if (!webApiKey) console.warn(`No web API key for ${env}: the User Manager can't send Firebase emails (set ${webApiKeyVar(env)}).`);
            userAdminService = new UserAdminService(db, auth, messaging, {
                signImage: createImageSigner(admin.storage()),
                storage: admin.storage(),
                emailSender: webApiKey ? createAuthEmailSender({ apiKey: webApiKey, auth }) : null,
                emailSetupHint: `Set ${webApiKeyVar(env)} to the ${serviceAccount.project_id} project's web API key (Firebase console → Project settings → General).`,
            });
            dataLoaderService = new DataLoaderService(db);
            publishedSeriesService = new PublishedSeriesService(db, { recompile: createRecompiler(bibleService) });
            const directoryOf = userAdminService;
            notificationHubService = new NotificationHubService(db, messaging, {
                loadDirectory: (options) => directoryOf.loadDirectory(options),
                serverTimestamp: () => admin.firestore.FieldValue.serverTimestamp(),
            });
            storageService = new StorageService(admin.storage().bucket());
            currentEnv = env;
            currentProjectId = serviceAccount.project_id;
            return true;
        } else {
            console.warn(`No Firebase credentials found for ${env}. Stats API will fail.`);
            return false;
        }
    } catch (error) {
        console.error("Failed to initialize Firebase Admin:", error);
        return false;
    }
}

// Paths
const DATA_DIR = path.join(__dirname, 'src', 'data', 'bible_series');
const NIV_FILE = path.join(__dirname, 'src', 'data', 'niv.json');

// Load the NIV Bible once for the Bible API (see /api/bible/niv below).
// A missing or unreadable file must not stop the rest of the server:
// the Bible endpoints report 503 while everything else keeps working.
let bibleService = null;
try {
    bibleService = loadBibleService(NIV_FILE);
    console.log(`NIV Bible data loaded (${bibleService.getBooks().books.length} books)`);
} catch (error) {
    console.warn(`NIV Bible data not available from ${NIV_FILE}: ${error.message}`);
}

// Initialize default (prod) on startup (after the Bible data, which updates use)
initializeFirebase('prod');
initializeDraftStorage();

// Cross-origin calls are refused unless CORS_ORIGINS lists the origin
// (comma-separated). The console's UI is served from this server (and through
// Vite's proxy in development), so it needs none.
const corsOrigins = (process.env.CORS_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean);
if (corsOrigins.length) app.use(cors({ origin: corsOrigins }));

// Every /api route needs a signed-in admin's Firebase ID token, verified by
// whichever project issued it, except the few the console loads before
// signing in (see PUBLIC_API_ROUTES in src/routes/apiAuth.js). This must stay
// above every /api route.
const requireAdmin = createRequireAdmin((projectId) => {
    const store = Object.values(draftStores).find((s) => s.projectId === projectId);
    return store ? { auth: store.app.auth(), firestore: store.app.firestore() } : null;
});
app.use('/api', protectApi(requireAdmin));
// Bodies are only parsed once the caller is known to be an admin.
app.use(express.json({ limit: '50mb' }));

// Get Firebase Client Config (the project the console signs in to)
app.get('/api/firebase-config', (req, res) => {
    try {
        const clientConfig = loadClientConfig();
        if (clientConfig) {
            res.json(clientConfig);
        } else {
            res.status(404).json({ error: 'Firebase Client Configuration not found' });
        }
    } catch (error) {
        console.error("Error fetching firebase config:", error);
        res.status(500).json({ error: error.message });
    }
});

// Stats Endpoint
app.get('/api/stats', async (req, res) => {
    if (!dataFetchingService || !db) {
        return res.status(503).json({ error: 'Database service not confirmed available' });
    }

    try {
        const { from } = req.query;

        const [prayerRequestsCount, testimoniesCount, progressData, totalUsersCount] = await Promise.all([
            dataFetchingService.getPrayerRequestCount(from),
            dataFetchingService.getTestimonyCount(from),
            dataFetchingService.getProgressData(),
            userManagerService.getAllUsersAfterDate(from ? new Date(from) : new Date(0))
        ]);

        // Fetch current series data
        let currentSeriesStats = null;
        try {
            const currentSeries = await dataFetchingService.getCurrentSeries();
            if (currentSeries) {
                const engagementMap = await dataFetchingService.getEngagementCountByType(currentSeries.id);
                // Convert Map to Object for JSON serialization
                const engagement = Object.fromEntries(engagementMap);
                currentSeriesStats = {
                    ...currentSeries,
                    engagement
                };
            }
        } catch (error) {
            console.error("Error fetching current series stats:", error);
        }

        res.json({
            prayerRequests: prayerRequestsCount,
            testimonies: testimoniesCount,
            totalUsers: totalUsersCount,
            progress: progressData,
            currentSeries: currentSeriesStats
        });
    } catch (error) {
        console.error('Error in /api/stats:', error);
        res.status(500).json({ error: error.message });
    }
});

// NIV Bible API — granular access to niv.json for the UI:
//   GET /api/bible/niv/books
//   GET /api/bible/niv/books/:book/chapters
//   GET /api/bible/niv/books/:book/chapters/:chapter/verses
//   GET /api/bible/niv/passage?ref=Romans%204%3A1-6
app.use('/api/bible/niv', createBibleRouter(bibleService));

// Series builder: drafts (autosave), publishing/updating series, cover
// image upload, song link titles
const publishService = new PublishService({
    getDrafts: () => draftStores[currentEnv]?.service ?? null,
    getLoader: () => dataLoaderService,
    getPublished: () => publishedSeriesService,
    getEnv: () => currentEnv,
});
app.use('/api/drafts', createDraftRouter(
    () => ({ service: draftStores[currentEnv]?.service ?? null, projectId: draftStores[currentEnv]?.projectId ?? null, env: currentEnv }),
    publishService,
    (env) => draftStores[env]?.service ?? null,
));
app.use('/api/published', createPublishedRouter(() => ({ service: publishedSeriesService, env: currentEnv })));
app.use('/api/storage', createStorageRouter(() => ({ service: storageService, env: currentEnv })));
app.use('/api/oembed', createOembedRouter());

// User Manager: Firebase Auth accounts + Firestore profiles of the selected
// environment. (requireAdmin here is a no-op after the /api-wide check; it
// keeps these routes protected if they are ever mounted elsewhere.)
app.use('/api/users', requireAdmin, createUserRouter(() => ({ service: userAdminService, projectId: currentProjectId, env: currentEnv })));

// Notification Hub: ad hoc push notifications to tokens, users or groups
// (e.g. users behind on the current series). Admins only, like /api/users.
app.use('/api/notifications', requireAdmin, createNotificationRouter(() => ({ service: notificationHubService, projectId: currentProjectId, env: currentEnv })));

// Get NIV Data (full file; kept for compatibility, prefer /api/bible/niv above)
app.get('/api/niv', (req, res) => {
    try {
        if (fs.existsSync(NIV_FILE)) {
            res.sendFile(NIV_FILE);
        } else {
            res.status(404).json({ error: 'NIV file not found' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// List Series
app.get('/api/series', (req, res) => {
    try {
        if (!fs.existsSync(DATA_DIR)) {
            return res.json([]);
        }
        const files = fs.readdirSync(DATA_DIR).filter(file => file.endsWith('.json'));
        res.json(files);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get Specific Series (read-only; used to import a repo file into a draft)
app.get('/api/series/:filename', (req, res) => {
    try {
        // basename() keeps the lookup inside DATA_DIR (e.g. "..%2Fserver.js")
        const filename = path.basename(req.params.filename);
        const filepath = path.join(DATA_DIR, filename);
        if (filename.endsWith('.json') && fs.existsSync(filepath)) {
            res.sendFile(filepath);
        } else {
            res.status(404).json({ error: 'File not found' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Generate Series from Outline (AI Agent)
app.post('/api/series/generate-from-outline', async (req, res) => {
    try {
        const { outlineText, startYear, apiKey } = req.body;
        if (!outlineText) {
            return res.status(400).json({ error: 'Outline text is required' });
        }

        // Determine API key
        const resolvedApiKey = apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
        if (!resolvedApiKey) {
            return res.status(400).json({ 
                error: 'Gemini API key is required. Please provide it in the request or set GEMINI_API_KEY/GOOGLE_API_KEY in the server environment.' 
            });
        }

        const year = startYear || new Date().getFullYear();

        // 1. Generate structured series from outline using Gemini
        console.log("Calling Gemini to parse outline...");
        const generatedData = await generateSeriesFromOutline(outlineText, year, resolvedApiKey);
        console.log("Gemini parse successful.");

        // 2. Load niv.json and populate actual verses if it exists
        if (fs.existsSync(NIV_FILE)) {
            console.log("NIV Bible data found. Populating verse texts...");
            try {
                const nivData = JSON.parse(fs.readFileSync(NIV_FILE, 'utf8'));
                generatedData.series_content = populateBibleVerses(generatedData.series_content, nivData);
                console.log("Verse texts populated successfully.");
            } catch (err) {
                console.error("Error populating verses from NIV data:", err);
            }
        } else {
            console.warn("NIV file not found at " + NIV_FILE + ". Skipping verse text population.");
        }

        res.json({ success: true, data: generatedData });
    } catch (error) {
        console.error("Error in /api/series/generate-from-outline:", error);
        res.status(500).json({ error: error.message });
    }
});

// Upload Series to Firebase
app.post('/api/series/upload', async (req, res) => {
    if (!dataLoaderService) {
        return res.status(503).json({ error: 'Database service not available' });
    }

    try {
        const { bible_series, series_content } = req.body;

        if (!bible_series || !series_content) {
            return res.status(400).json({ error: 'bible_series and series_content are required' });
        }

        console.log("Uploading series:", bible_series.title);
        const bibleSeriesId = await dataLoaderService.loadBibleSeries(bible_series);
        console.log("Series uploaded with ID:", bibleSeriesId);

        console.log("Uploading content for series:", bibleSeriesId);
        const report = await dataLoaderService.loadSeriesContent(series_content, bibleSeriesId);
        console.log(`Content uploaded: ${report.written}/${report.total} entries`);

        res.json({ success: true, seriesId: bibleSeriesId, env: currentEnv, ...report });
    } catch (error) {
        console.error("Error uploading series:", error);
        res.status(500).json({ error: error.message });
    }
});

// Environment Switching Endpoints
app.get('/api/env/current', (req, res) => {
    res.json({ env: currentEnv });
});

app.post('/api/env/switch', async (req, res) => {
    const { env } = req.body;
    if (env !== 'prod' && env !== 'dev') {
        return res.status(400).json({ error: 'Invalid environment. Must be "prod" or "dev".' });
    }

    const success = await initializeFirebase(env);
    if (success) {
        res.json({ success: true, env: currentEnv });
    } else {
        res.status(500).json({ error: 'Failed to switch environment' });
    }
});

// Unknown API paths are a 404, not the UI's index.html below (which would
// reach the client as a 200 it can't parse).
app.use('/api', (req, res) => {
    res.status(404).json({ error: `No API endpoint ${req.method} ${req.originalUrl}; restart the server if it was just added` });
});

// Serve Static Files (UI)
const DIST_DIR = path.join(__dirname, 'dist');
if (fs.existsSync(DIST_DIR)) {
    app.use(express.static(DIST_DIR));

    // Handle SPA Routing - Return index.html for all non-API routes
    // Express 5 requires strict path syntax. Use (.*) or just a regex for catch-all.
    app.get(/(.*)/, (req, res) => {
        res.sendFile(path.join(DIST_DIR, 'index.html'));
    });
}

app.listen(PORT, (err) => {
    if (err) {
        console.error(`Failed to start server on port ${PORT}: ${err.message}`);
        process.exit(1);
    }
    console.log(`Server running on http://localhost:${PORT}`);
});
