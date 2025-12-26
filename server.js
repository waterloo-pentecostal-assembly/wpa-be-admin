import express from 'express';
import fs from 'fs';
import path from 'path';
import cors from 'cors';
import { fileURLToPath } from 'url';
import admin from 'firebase-admin';
import { DataFetchingService } from './src/services/dataFetchingService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3001;

// Initialize Firebase Admin
try {
    let serviceAccount;

    // 1. Try Environment Variable (Production/Render)
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        try {
            serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
            console.log("Loaded Firebase credentials from Environment Variable");
        } catch (e) {
            console.error("Failed to parse FIREBASE_SERVICE_ACCOUNT env var", e);
        }
    }

    // 2. Try Local File (Development)
    if (!serviceAccount) {
        const serviceAccountPath = path.join(__dirname, 'src', 'config', 'service-account.json');
        if (fs.existsSync(serviceAccountPath)) {
            serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
            console.log("Loaded Firebase credentials from local file");
        }
    }

    if (serviceAccount) {
        if (!admin.apps.length) {
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount)
            });
            console.log("Firebase Admin Initialized");
        }
    } else {
        console.warn("No Firebase credentials found (File or Env). Stats API will fail.");
    }
} catch (error) {
    console.error("Failed to initialize Firebase Admin:", error);
}

const db = admin.apps.length ? admin.firestore() : null;
const dataFetchingService = db ? new DataFetchingService(db) : null;

app.use(cors());
app.use(express.json());

// Paths
const DATA_DIR = path.join(__dirname, 'src', 'data', 'bible_series');
const NIV_FILE = path.join(__dirname, 'src', 'data', 'niv.json');

// Stats Endpoint
app.get('/api/stats', async (req, res) => {
    if (!dataFetchingService || !db) {
        return res.status(503).json({ error: 'Database service not confirmed available' });
    }

    try {
        const [prayerRequestsSnapshot, testimoniesSnapshot, progressData] = await Promise.all([
            db.collection('prayer_requests').get(),
            db.collection('testimonies').get(),
            dataFetchingService.getProgressData()
        ]);
        res.json({
            prayerRequests: prayerRequestsSnapshot.size,
            testimonies: testimoniesSnapshot.size,
            progress: progressData
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
        const { filename, content } = req.body;
        if (!filename || !content) {
            return res.status(400).json({ error: 'Filename and content required' });
        }

        // Ensure filename ends with .json
        const safeFilename = filename.endsWith('.json') ? filename : `${filename}.json`;
        const filepath = path.join(DATA_DIR, safeFilename);

        fs.writeFileSync(filepath, JSON.stringify(content, null, 4));
        res.json({ success: true, filename: safeFilename });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Serve Static Files (UI)
const DIST_DIR = path.join(__dirname, 'dist');
if (fs.existsSync(DIST_DIR)) {
    app.use(express.static(DIST_DIR));

    // Handle SPA Routing - Return index.html for all non-API routes
    app.get('*', (req, res) => {
        res.sendFile(path.join(DIST_DIR, 'index.html'));
    });
}

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
