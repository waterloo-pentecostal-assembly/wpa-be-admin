import './src/config/loadEnv.js'; // first: .env must be loaded before anything reads process.env

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
import { createApiBibleService } from './src/config/apiBible.js';
import { loadServiceAccount } from './src/config/serviceAccount.js';
import { loadClientConfig, loadWebApiKey, webApiKeyVar } from './src/config/firebaseClient.js';
import { bibleAuthFor, createBibleProxyAdminRouter, createBibleRouter } from './src/routes/bibleRoutes.js';
import { DraftService } from './src/services/draftService.js';
import { StorageService } from './src/services/storageService.js';
import { PublishService } from './src/services/publishService.js';
import { PublishedSeriesService } from './src/services/publishedSeries.js';
import { SeriesCopyService } from './src/services/seriesCopy.js';
import { createRecompiler } from './src/services/seriesBaseline.js';
import { createDraftRouter, createOembedRouter, createPublishedRouter, createStorageRouter } from './src/routes/seriesBuilderRoutes.js';
import { createUserRouter } from './src/routes/userRoutes.js';
import { createRequireAdmin, protectApi } from './src/routes/apiAuth.js';
import { createNotificationRouter } from './src/routes/notificationRoutes.js';
import { createMaintenanceRouter } from './src/routes/maintenanceRoutes.js';
import { DataDeletingService } from './src/services/dataDeletingService.js';
import { FeaturedContentService } from './src/services/featuredContent.js';
import { createFeaturedRouter } from './src/routes/featuredRoutes.js';

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
let dataDeletingService = null;
let storageService = null;
let publishedSeriesService = null;
let featuredContentService = null;
let currentEnv = 'prod'; // 'prod' or 'dev'

// Series builder drafts are kept per environment, in that environment's own
// Firestore: the env switcher changes which drafts are listed, and a draft is
// copied from prod to dev with "Copy to dev" (never into prod). Each env has its own named Firebase
// app so draft storage survives the default app being recreated on a switch.
const draftStores = {}; // env -> { service: DraftService, projectId, app, bucket }

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
            draftStores[env] = { service, projectId: serviceAccount.project_id, app, bucket: storageBucketFor(env, serviceAccount) };
            console.log(`Series builder ${env} drafts stored in ${serviceAccount.project_id}`);
            // Drafts written before the snake_case keys are rewritten once; they
            // are readable either way, so this runs in the background.
            service.migrateKeys()
                .then((count) => count && console.log(`Migrated ${count} ${env} drafts to snake_case keys`))
                .catch((error) => console.error(`Could not migrate ${env} draft keys:`, error))
                // Deleting a draft used to only mark it deleted; remove those leftovers.
                .then(() => service.purgeDeleted())
                .then((count) => count && console.log(`Removed ${count} ${env} drafts that had been deleted in the builder`))
                .catch((error) => console.error(`Could not remove deleted ${env} drafts:`, error));
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
            dataDeletingService = null;
            featuredContentService = null;
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
            dataDeletingService = new DataDeletingService(db);
            featuredContentService = new FeaturedContentService(db, {
                serverTimestamp: () => admin.firestore.FieldValue.serverTimestamp(),
                timestamp: (millis) => admin.firestore.Timestamp.fromMillis(millis),
            });
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

// Scripture comes from API.Bible through our Bible proxy (BIBLE_API_BASE_URL;
// see src/config/apiBible.js). The console holds no API.Bible key: each call
// is made with the ID token of the admin whose request it serves.
const { service: bibleService, config: bibleConfig } = createApiBibleService();
{
    const allowed = bibleConfig.bibleIds.length ? bibleConfig.bibleIds.join(', ') : 'any Bible the proxy serves';
    const pacing = bibleConfig.rateLimit
        ? `at most ${bibleConfig.rateLimit.requests} requests per ${bibleConfig.rateLimit.perMs / 1000}s`
        : 'no request pacing';
    console.log(`Scripture from the Bible proxy at ${bibleConfig.baseUrl}: default ${bibleService.defaultBibleId ?? '(none)'}; translations: ${allowed}; ${pacing}`);
    if (!bibleService.defaultBibleId) console.warn('No default Bible set (API_BIBLE_DEFAULT_BIBLE_ID); series must pick a translation');
}

// Initialize default (prod) on startup (after the Bible service, which updates use)
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

// Bible API backed by API.Bible via the Bible proxy, called with the
// requesting admin's ID token (`:bibleId` is a translation ID or "default"):
//   GET  /api/bible/translations
//   GET  /api/bible/:bibleId/books
//   GET  /api/bible/:bibleId/books/:book/chapters
//   GET  /api/bible/:bibleId/books/:book/chapters/:chapter/verses
//   GET  /api/bible/:bibleId/passage?ref=Romans%204%3A1-6
//   POST /api/bible/:bibleId/passages
app.use('/api/bible', createBibleRouter(bibleService));
// The Bible proxy's admin endpoints (stats, whoami, routes, cache purge).
app.use('/api/bible-proxy', createBibleProxyAdminRouter(bibleService));

// Copying a series or draft from prod to dev (for testing) reads and writes
// through the per-env apps, whichever environment is selected.
const seriesCopier = new SeriesCopyService({
    getFirestore: (env) => draftStores[env]?.app.firestore() ?? null,
    getBucket: (env) => (draftStores[env] ? draftStores[env].app.storage().bucket(draftStores[env].bucket) : null),
});

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
    { copyImage: (gs, from, to) => seriesCopier.copyImage(gs, from, to) },
));
app.use('/api/published', createPublishedRouter(() => ({ service: publishedSeriesService, env: currentEnv }), seriesCopier));
app.use('/api/storage', createStorageRouter(() => ({ service: storageService, env: currentEnv })));
app.use('/api/oembed', createOembedRouter());

// User Manager: Firebase Auth accounts + Firestore profiles of the selected
// environment. (requireAdmin here is a no-op after the /api-wide check; it
// keeps these routes protected if they are ever mounted elsewhere.)
app.use('/api/users', requireAdmin, createUserRouter(() => ({ service: userAdminService, projectId: currentProjectId, env: currentEnv })));

// Notification Hub: ad hoc push notifications to tokens, users or groups
// (e.g. users behind on the current series). Admins only, like /api/users.
app.use('/api/notifications', requireAdmin, createNotificationRouter(() => ({ service: notificationHubService, projectId: currentProjectId, env: currentEnv })));

// Maintenance: delete old prayer requests and testimonies in the selected
// environment. Admins only, like /api/users.
app.use('/api/maintenance', requireAdmin, createMaintenanceRouter(() => ({ service: dataDeletingService, env: currentEnv })));

// Featured content on the app's home screen: verses and pastor's encouragements.
app.use('/api/featured', requireAdmin, createFeaturedRouter(() => ({ service: featuredContentService, env: currentEnv })));

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
        const { outlineText, startYear, apiKey, bibleId } = req.body;
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

        // 2. Populate verse texts from API.Bible (via the Bible proxy, as this admin)
        console.log("Populating verse texts from the Bible proxy...");
        try {
            generatedData.series_content = await populateBibleVerses(
                generatedData.series_content,
                bibleService.withAuth(bibleAuthFor(req)),
                { bibleId: bibleId || 'default' },
            );
            console.log("Verse texts populated successfully.");
        } catch (err) {
            console.error("Error populating verses from the Bible proxy:", err);
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
