
import express from 'express';
import fs from 'fs';
import path from 'path';
import cors from 'cors';
import { fileURLToPath } from 'url';
import admin from 'firebase-admin';
import { DataFetchingService } from './src/services/dataFetchingService.js';
import { UserManagerService } from './src/services/userManagerService.js';
import { DataLoaderService } from './src/services/dataLoaderService.js';
import { NotificationTestingService } from './src/services/notificationTestingService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3001;

// Global Service Variables
let db = null;
let auth = null;
let dataFetchingService = null;
let userManagerService = null;
let dataLoaderService = null;
let notificationTestingService = null;
let currentEnv = 'prod'; // 'prod' or 'dev'

async function initializeFirebase(env = 'prod') {
    try {
        // If an app already exists, delete it
        if (admin.apps.length) {
            await admin.app().delete();
        }

        let serviceAccount;
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

        if (serviceAccount) {
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount)
            });
            console.log(`Firebase Admin Initialized (${env})`);

            // Re-instantiate services
            db = admin.firestore();
            auth = admin.auth();
            const messaging = admin.messaging();
            dataFetchingService = new DataFetchingService(db);
            userManagerService = new UserManagerService(db, auth, messaging);
            dataLoaderService = new DataLoaderService(db);
            notificationTestingService = new NotificationTestingService(admin);
            currentEnv = env;
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

// Initialize default (prod) on startup
initializeFirebase('prod');

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Paths
const DATA_DIR = path.join(__dirname, 'src', 'data', 'bible_series');
const NIV_FILE = path.join(__dirname, 'src', 'data', 'niv.json');

// Get Firebase Client Config
app.get('/api/firebase-config', (req, res) => {
    try {
        let clientConfig;

        // 1. Try Render Secret File (Production)
        const renderSecretPath = '/etc/secrets/firebase-client-config.json';
        if (fs.existsSync(renderSecretPath)) {
            clientConfig = JSON.parse(fs.readFileSync(renderSecretPath, 'utf8'));
            // console.log("Loaded Firebase Client config from Render Secret File");
        }

        // 2. Try Environment Variable (Fallback)
        if (!clientConfig && process.env.FIREBASE_CLIENT_CONFIG) {
            try {
                clientConfig = JSON.parse(process.env.FIREBASE_CLIENT_CONFIG);
                // console.log("Loaded Firebase Client config from Environment Variable");
            } catch (e) {
                console.error("Failed to parse FIREBASE_CLIENT_CONFIG env var", e);
            }
        }

        // 3. Try Local File (Development)
        if (!clientConfig) {
            const localConfigPath = path.join(__dirname, 'src', 'config', 'firebase-client-config.json');
            if (fs.existsSync(localConfigPath)) {
                clientConfig = JSON.parse(fs.readFileSync(localConfigPath, 'utf8'));
                // console.log("Loaded Firebase Client config from local file");
            }
        }

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

// Get NIV Data
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

// Get Specific Series
app.get('/api/series/:filename', (req, res) => {
    try {
        const filepath = path.join(DATA_DIR, req.params.filename);
        if (fs.existsSync(filepath)) {
            res.sendFile(filepath);
        } else {
            res.status(404).json({ error: 'File not found' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Save Series
app.post('/api/series', (req, res) => {
    try {
        const { filename, content, checkExists } = req.body;
        if (!filename || !content) {
            return res.status(400).json({ error: 'Filename and content required' });
        }

        // Ensure filename ends with .json
        const safeFilename = filename.endsWith('.json') ? filename : `${filename}.json`;
        const filepath = path.join(DATA_DIR, safeFilename);

        if (checkExists && fs.existsSync(filepath)) {
            return res.status(409).json({ error: 'File already exists' });
        }

        fs.writeFileSync(filepath, JSON.stringify(content, null, 4));
        res.json({ success: true, filename: safeFilename });
    } catch (error) {
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
        await dataLoaderService.loadSeriesContent(series_content, bibleSeriesId);
        console.log("Content uploaded successfully");

        res.json({ success: true, seriesId: bibleSeriesId });
    } catch (error) {
        console.error("Error uploading series:", error);
        res.status(500).json({ error: error.message });
    }
});

// Send Test Notification
app.post('/api/notifications/test', async (req, res) => {
    try {
        const { token, title, body, data } = req.body;
        if (!token || !title || !body) {
            return res.status(400).json({ error: 'Token, title, and body are required' });
        }

        if (!notificationTestingService) {
            return res.status(503).json({ error: 'Notification service not available' });
        }

        const response = await notificationTestingService.sendTestNotification(token, title, body, data);
        console.log('Successfully sent message:', response);
        res.json({ success: true, messageId: response });
    } catch (error) {
        console.error('Error sending message:', error);
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

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
