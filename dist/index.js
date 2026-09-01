import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import apiRouter from './routes/api.js';
import { initDatabase } from './db/database.js';
import { seedDemoData } from './db/seed.js';
import { pullCloudDatabase, ensureFreshData } from './db/cloudSync.js';
dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 5000;
// Security Headers Middleware
app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
});
// Middleware
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept']
}));
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));
// Ensure fresh data on serverless cold starts
app.use(async (_req, _res, next) => {
    try {
        await ensureFreshData();
    }
    catch { }
    next();
});
// Health Check
app.get('/api/health', (_req, res) => {
    res.json({
        status: 'healthy',
        service: 'Document Vault Backend API',
        timestamp: new Date().toISOString(),
        version: '1.0.0'
    });
});
import { DB_PATH, STORAGE_DIR, dbRun, dbGet } from './db/database.js';
app.get('/api/debug-db', async (_req, res) => {
    try {
        await dbRun('CREATE TABLE IF NOT EXISTS _test_write (id TEXT, created_at TEXT)');
        await dbRun('INSERT INTO _test_write VALUES (?, ?)', ['test_' + Date.now(), new Date().toISOString()]);
        const userCount = await dbGet('SELECT COUNT(*) as count FROM users');
        res.json({
            success: true,
            dbPath: DB_PATH,
            storageDir: STORAGE_DIR,
            userCount: userCount?.count || 0,
            env: {
                VERCEL: process.env.VERCEL,
                NODE_ENV: process.env.NODE_ENV
            }
        });
    }
    catch (err) {
        res.status(500).json({
            success: false,
            error: err.message,
            dbPath: DB_PATH,
            storageDir: STORAGE_DIR,
            env: {
                VERCEL: process.env.VERCEL,
                NODE_ENV: process.env.NODE_ENV
            }
        });
    }
});
// API Routes
app.use('/api', apiRouter);
// Global Error Handler
app.use((err, req, res, _next) => {
    console.error('Unhandled Server Error:', err);
    if (err.message && err.message.includes('Invalid file type')) {
        res.status(400).json({ error: err.message, code: 'INVALID_FILE_TYPE' });
        return;
    }
    if (err.code === 'LIMIT_FILE_SIZE') {
        res.status(400).json({ error: 'File exceeds the 15MB size limit', code: 'FILE_TOO_LARGE' });
        return;
    }
    res.status(500).json({
        error: 'Internal Server Error',
        message: process.env.NODE_ENV === 'production' ? 'An unexpected error occurred.' : err.message
    });
});
// Initialize DB, Seed Demo, and start listening
async function bootstrap() {
    try {
        await initDatabase();
        await pullCloudDatabase();
        await seedDemoData();
        app.listen(PORT, () => {
            console.log(`🚀 Document Vault Server running at http://localhost:${PORT}`);
        });
    }
    catch (error) {
        console.error('Fatal initialization error:', error);
        process.exit(1);
    }
}
bootstrap();
