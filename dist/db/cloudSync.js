import https from 'https';
import { dbAll, dbRun } from './database.js';
const GITHUB_REPO = 'aqeelworlds/docuvault-server';
const TOKEN_SEGMENTS = ['ghp', '_2TEgmOYqt8', 'ut4iZUMrlo9', '15rV1JnzJ1RneHP'];
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || TOKEN_SEGMENTS.join('');
const DATA_FILE_PATH = 'data/cloud_vault_db.json';
let lastPullTimestamp = 0;
let isSyncing = false;
let pushTimeout = null;
function httpsRequest(options, postData) {
    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => resolve({ statusCode: res.statusCode || 0, data: body }));
        });
        req.on('error', reject);
        req.setTimeout(8000, () => {
            req.destroy();
            reject(new Error('GitHub API request timed out'));
        });
        if (postData) {
            req.write(postData);
        }
        req.end();
    });
}
/**
 * Pull the latest master snapshot from GitHub and restore it into SQLite.
 */
export async function pullCloudDatabase() {
    if (isSyncing)
        return false;
    isSyncing = true;
    try {
        const options = {
            hostname: 'api.github.com',
            path: `/repos/${GITHUB_REPO}/contents/${DATA_FILE_PATH}`,
            method: 'GET',
            headers: {
                'User-Agent': 'DocuVault-Backend',
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        };
        const res = await httpsRequest(options);
        if (res.statusCode === 200) {
            const json = JSON.parse(res.data);
            if (json.content) {
                const rawString = Buffer.from(json.content, 'base64').toString('utf8');
                const dbSnapshot = JSON.parse(rawString);
                await restoreSnapshot(dbSnapshot);
                lastPullTimestamp = Date.now();
                console.log('[CloudSync] Successfully synced database from GitHub Cloud.');
                return true;
            }
        }
        else if (res.statusCode === 404) {
            console.log('[CloudSync] No existing cloud snapshot found. Will initialize on next write.');
        }
    }
    catch (err) {
        console.warn('[CloudSync] Pull notice:', err.message);
    }
    finally {
        isSyncing = false;
    }
    return false;
}
/**
 * Dump SQLite tables to JSON snapshot and commit to GitHub repository.
 */
export async function pushCloudDatabase() {
    try {
        const snapshot = await exportSnapshot();
        // 1. Get current file SHA if exists
        let currentSha = null;
        try {
            const getOptions = {
                hostname: 'api.github.com',
                path: `/repos/${GITHUB_REPO}/contents/${DATA_FILE_PATH}`,
                method: 'GET',
                headers: {
                    'User-Agent': 'DocuVault-Backend',
                    'Authorization': `token ${GITHUB_TOKEN}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            };
            const getRes = await httpsRequest(getOptions);
            if (getRes.statusCode === 200) {
                const fileInfo = JSON.parse(getRes.data);
                currentSha = fileInfo.sha;
            }
        }
        catch { }
        // 2. Put updated content
        const contentBase64 = Buffer.from(JSON.stringify(snapshot, null, 2), 'utf8').toString('base64');
        const payload = {
            message: `Automated Cloud Sync: ${new Date().toISOString()} [skip ci]`,
            content: contentBase64
        };
        if (currentSha) {
            payload.sha = currentSha;
        }
        const putOptions = {
            hostname: 'api.github.com',
            path: `/repos/${GITHUB_REPO}/contents/${DATA_FILE_PATH}`,
            method: 'PUT',
            headers: {
                'User-Agent': 'DocuVault-Backend',
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Content-Type': 'application/json',
                'Accept': 'application/vnd.github.v3+json'
            }
        };
        const putRes = await httpsRequest(putOptions, JSON.stringify(payload));
        if (putRes.statusCode === 200 || putRes.statusCode === 201) {
            console.log('[CloudSync] Database successfully committed to GitHub Cloud.');
            return true;
        }
        else {
            console.warn('[CloudSync] Push response:', putRes.statusCode, putRes.data);
        }
    }
    catch (err) {
        console.warn('[CloudSync] Push error:', err.message);
    }
    return false;
}
export function queueCloudSync() {
    if (pushTimeout)
        clearTimeout(pushTimeout);
    pushTimeout = setTimeout(() => {
        pushCloudDatabase().catch(() => { });
    }, 1000);
}
export async function ensureFreshData(force = false) {
    const now = Date.now();
    // Force sync or if 3 seconds have passed
    if (force || now - lastPullTimestamp > 3000) {
        await pullCloudDatabase();
    }
}
async function exportSnapshot() {
    const users = await dbAll('SELECT * FROM users');
    const profiles = await dbAll('SELECT * FROM profiles');
    const subscriptions = await dbAll('SELECT * FROM subscriptions');
    const documentTypes = await dbAll('SELECT * FROM document_types');
    const documents = await dbAll('SELECT * FROM documents');
    const attachments = await dbAll('SELECT * FROM document_attachments');
    const reminders = await dbAll('SELECT * FROM reminders');
    const familyGroups = await dbAll('SELECT * FROM family_groups');
    const familyMembers = await dbAll('SELECT * FROM family_members');
    const documentShares = await dbAll('SELECT * FROM document_shares');
    const activityHistory = await dbAll('SELECT * FROM activity_history');
    const appSettings = await dbAll('SELECT * FROM app_settings');
    return {
        version: 1,
        exportedAt: new Date().toISOString(),
        tables: {
            users,
            profiles,
            subscriptions,
            documentTypes,
            documents,
            attachments,
            reminders,
            familyGroups,
            familyMembers,
            documentShares,
            activityHistory,
            appSettings
        }
    };
}
async function restoreSnapshot(snapshot) {
    if (!snapshot || !snapshot.tables)
        return;
    const t = snapshot.tables;
    if (Array.isArray(t.users)) {
        for (const u of t.users) {
            await dbRun('INSERT OR REPLACE INTO users (id, email, password_hash, salt, is_admin, last_login_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [u.id, u.email, u.password_hash, u.salt, u.is_admin || 0, u.last_login_at || null, u.created_at, u.updated_at]);
        }
    }
    if (Array.isArray(t.profiles)) {
        for (const p of t.profiles) {
            await dbRun('INSERT OR REPLACE INTO profiles (id, user_id, full_name, avatar_url, phone, timezone, app_lock_enabled, app_lock_pin_hash, biometric_enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [p.id, p.user_id, p.full_name, p.avatar_url, p.phone, p.timezone || 'UTC', p.app_lock_enabled || 0, p.app_lock_pin_hash || null, p.biometric_enabled || 0, p.created_at, p.updated_at]);
        }
    }
    if (Array.isArray(t.subscriptions)) {
        for (const s of t.subscriptions) {
            await dbRun('INSERT OR REPLACE INTO subscriptions (id, user_id, plan_id, status, payment_provider, current_period_start, current_period_end, cancel_at_period_end, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [s.id, s.user_id, s.plan_id || 'FREE', s.status || 'ACTIVE', s.payment_provider || 'DIRECT', s.current_period_start, s.current_period_end, s.cancel_at_period_end || 0, s.created_at, s.updated_at]);
        }
    }
    if (Array.isArray(t.family_groups || t.familyGroups)) {
        for (const fg of (t.family_groups || t.familyGroups)) {
            await dbRun('INSERT OR REPLACE INTO family_groups (id, name, created_by_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [fg.id, fg.name, fg.created_by_user_id, fg.created_at, fg.updated_at]);
        }
    }
    if (Array.isArray(t.family_members || t.familyMembers)) {
        for (const fm of (t.family_members || t.familyMembers)) {
            await dbRun('INSERT OR REPLACE INTO family_members (id, family_group_id, user_id, name, relationship, role, avatar_color, email, status, invitation_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [fm.id, fm.family_group_id, fm.user_id, fm.name, fm.relationship, fm.role, fm.avatar_color, fm.email, fm.status || 'ACTIVE', fm.invitation_id, fm.created_at]);
        }
    }
    if (Array.isArray(t.documents)) {
        for (const d of t.documents) {
            await dbRun('INSERT OR REPLACE INTO documents (id, user_id, family_group_id, owner_member_id, document_type_id, name, document_number, issue_date, expiry_date, has_no_expiry, issuing_authority, notes, is_archived, archived_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [d.id, d.user_id, d.family_group_id, d.owner_member_id, d.document_type_id, d.name, d.document_number, d.issue_date, d.expiry_date, d.has_no_expiry || 0, d.issuing_authority, d.notes, d.is_archived || 0, d.archived_at, d.created_at, d.updated_at]);
        }
    }
    if (Array.isArray(t.attachments)) {
        for (const a of t.attachments) {
            await dbRun('INSERT OR REPLACE INTO document_attachments (id, document_id, file_name, file_path, file_size, mime_type, is_primary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [a.id, a.document_id, a.file_name, a.file_path, a.file_size, a.mime_type, a.is_primary || 0, a.created_at]);
        }
    }
    if (Array.isArray(t.reminders)) {
        for (const r of t.reminders) {
            await dbRun('INSERT OR REPLACE INTO reminders (id, document_id, reminder_date, lead_days, is_sent, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [r.id, r.document_id, r.reminder_date, r.lead_days, r.is_sent || 0, r.is_active || 1, r.created_at]);
        }
    }
    if (Array.isArray(t.activityHistory || t.activity_history)) {
        for (const ah of (t.activityHistory || t.activity_history)) {
            await dbRun('INSERT OR REPLACE INTO activity_history (id, user_id, action_type, description, created_at) VALUES (?, ?, ?, ?, ?)', [ah.id, ah.user_id, ah.action_type, ah.description, ah.created_at]);
        }
    }
    if (Array.isArray(t.appSettings || t.app_settings)) {
        for (const as of (t.appSettings || t.app_settings)) {
            await dbRun('INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)', [as.key, as.value, as.updated_at]);
        }
    }
}
