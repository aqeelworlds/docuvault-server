import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import { dbGet, dbRun, dbAll, DB_PATH } from '../db/database.js';
import { hashPassword } from '../middleware/auth.js';
import { ensureFreshData, syncToCloudNow } from '../db/cloudSync.js';
/**
 * Overview statistics for Admin Dashboard.
 */
export async function getAdminStats(req, res) {
    try {
        await ensureFreshData(true);
        const totalUsersRow = await dbGet('SELECT COUNT(*) as count FROM users WHERE email NOT LIKE "%@vault.local" AND email NOT LIKE "%@evil.local" AND email NOT LIKE "%@example.com"');
        const totalDocsRow = await dbGet('SELECT COUNT(*) as count FROM documents WHERE is_archived = 0 AND user_id IN (SELECT id FROM users WHERE email NOT LIKE "%@vault.local" AND email NOT LIKE "%@evil.local" AND email NOT LIKE "%@example.com")');
        const totalArchivedRow = await dbGet('SELECT COUNT(*) as count FROM documents WHERE is_archived = 1 AND user_id IN (SELECT id FROM users WHERE email NOT LIKE "%@vault.local" AND email NOT LIKE "%@evil.local" AND email NOT LIKE "%@example.com")');
        const totalRemindersRow = await dbGet('SELECT COUNT(*) as count FROM reminders WHERE is_active = 1 AND user_id IN (SELECT id FROM users WHERE email NOT LIKE "%@vault.local" AND email NOT LIKE "%@evil.local" AND email NOT LIKE "%@example.com")');
        const totalFamiliesRow = await dbGet('SELECT COUNT(*) as count FROM family_groups WHERE created_by_user_id IN (SELECT id FROM users WHERE email NOT LIKE "%@vault.local" AND email NOT LIKE "%@evil.local" AND email NOT LIKE "%@example.com")');
        const subCounts = await dbAll('SELECT plan_id, COUNT(*) as count FROM subscriptions WHERE status = "ACTIVE" AND user_id IN (SELECT id FROM users WHERE email NOT LIKE "%@vault.local" AND email NOT LIKE "%@evil.local" AND email NOT LIKE "%@example.com") GROUP BY plan_id');
        let freeCount = 0;
        let monthlyCount = 0;
        let yearlyCount = 0;
        let lifetimeCount = 0;
        subCounts.forEach(sc => {
            if (sc.plan_id === 'FREE')
                freeCount += sc.count;
            else if (sc.plan_id === 'PRO_MONTHLY' || sc.plan_id === 'vault_pro_monthly')
                monthlyCount += sc.count;
            else if (sc.plan_id === 'PRO_YEARLY' || sc.plan_id === 'vault_pro_yearly')
                yearlyCount += sc.count;
            else if (sc.plan_id === 'PRO_LIFETIME' || sc.plan_id === 'vault_pro_lifetime')
                lifetimeCount += sc.count;
        });
        const storageRow = await dbGet('SELECT COUNT(*) as count, COALESCE(SUM(file_size), 0) as total_bytes FROM document_attachments');
        const recentActivity = await dbAll(`SELECT ah.*, p.full_name as user_name, u.email as user_email
       FROM activity_history ah
       JOIN users u ON ah.user_id = u.id
       LEFT JOIN profiles p ON u.id = p.user_id
       ORDER BY ah.created_at DESC
       LIMIT 12`);
        const adSettingsRow = await dbGet('SELECT value FROM app_settings WHERE key = "ads_monetization"');
        const adSettings = adSettingsRow?.value ? JSON.parse(adSettingsRow.value) : { adsEnabled: true };
        const estimatedDailyImpressions = freeCount * Math.max(1, Math.round((totalDocsRow?.count || 1) / Math.max(1, totalUsersRow?.count || 1) * 3));
        const estimatedMonthlyAdRevenue = ((estimatedDailyImpressions * 30 / 1000) * 2.8).toFixed(2);
        res.json({
            metrics: {
                totalUsers: totalUsersRow?.count || 0,
                totalDocuments: totalDocsRow?.count || 0,
                totalArchived: totalArchivedRow?.count || 0,
                totalReminders: totalRemindersRow?.count || 0,
                totalFamilies: totalFamiliesRow?.count || 0,
                totalStorageBytes: storageRow?.total_bytes || 0,
                totalAttachments: storageRow?.count || 0,
                subscriptions: {
                    free: freeCount,
                    proMonthly: monthlyCount,
                    proYearly: yearlyCount,
                    proLifetime: lifetimeCount,
                    totalPaid: monthlyCount + yearlyCount + lifetimeCount
                },
                adMonetization: {
                    adsEnabled: Boolean(adSettings.adsEnabled),
                    adProvider: adSettings.adProvider || 'AdMob',
                    adSupportedFreeUsers: freeCount,
                    adFreeProUsers: monthlyCount + yearlyCount + lifetimeCount,
                    estimatedDailyImpressions,
                    estimatedMonthlyRevenue: `$${estimatedMonthlyAdRevenue}`
                }
            },
            recentActivity
        });
    }
    catch (error) {
        console.error('getAdminStats error:', error);
        res.status(500).json({ error: 'Failed to retrieve admin stats', details: error.message });
    }
}
/**
 * List all registered users with detailed metrics for Admin User Management.
 */
export async function getAllUsers(req, res) {
    try {
        await ensureFreshData(true);
        const q = (req.query.q || '').toLowerCase().trim();
        const planFilter = req.query.plan;
        let sql = `
      SELECT
        u.id, u.email, u.is_admin, u.created_at,
        p.full_name, p.phone, p.timezone, p.app_lock_enabled,
        s.plan_id, s.status as subscription_status, s.current_period_end, s.payment_provider,
        fg.name as family_name,
        (SELECT COUNT(*) FROM documents WHERE user_id = u.id AND is_archived = 0) as document_count
      FROM users u
      LEFT JOIN profiles p ON u.id = p.user_id
      LEFT JOIN subscriptions s ON u.id = s.user_id
      LEFT JOIN family_members fm ON (fm.user_id = u.id AND fm.role = 'OWNER')
      LEFT JOIN family_groups fg ON fm.family_group_id = fg.id
      WHERE u.email NOT LIKE "%@vault.local" AND u.email NOT LIKE "%@evil.local" AND u.email NOT LIKE "%@example.com"
    `;
        const params = [];
        if (q) {
            sql += ` AND (LOWER(u.email) LIKE ? OR LOWER(COALESCE(p.full_name, '')) LIKE ? OR LOWER(COALESCE(p.phone, '')) LIKE ?)`;
            params.push(`%${q}%`, `%${q}%`, `%${q}%`);
        }
        if (planFilter && planFilter !== 'all') {
            if (planFilter === 'PRO') {
                sql += ` AND s.plan_id != 'FREE' AND s.status = 'ACTIVE'`;
            }
            else {
                sql += ` AND s.plan_id = ?`;
                params.push(planFilter);
            }
        }
        sql += ` ORDER BY u.created_at DESC LIMIT 100`;
        const users = await dbAll(sql, params);
        res.json({
            users: users.map(u => ({
                id: u.id,
                email: u.email,
                fullName: u.full_name || 'Unnamed User',
                phone: u.phone || null,
                timezone: u.timezone || 'UTC',
                isAdmin: Boolean(u.is_admin),
                createdAt: u.created_at,
                planId: u.plan_id || 'FREE',
                subscriptionStatus: u.subscription_status || 'ACTIVE',
                isLifetime: u.plan_id === 'PRO_LIFETIME' || u.plan_id === 'vault_pro_lifetime',
                currentPeriodEnd: u.current_period_end || null,
                paymentProvider: u.payment_provider || 'DIRECT',
                familyName: u.family_name || null,
                documentCount: u.document_count || 0
            }))
        });
    }
    catch (error) {
        console.error('getAllUsers error:', error);
        res.status(500).json({ error: 'Failed to retrieve users', details: error.message });
    }
}
/**
 * Admin action: change user subscription plan and entitlement.
 */
export async function updateUserSubscription(req, res) {
    try {
        const targetUserId = req.params.id;
        const { planId, status } = req.body;
        const validPlans = ['FREE', 'PRO_MONTHLY', 'PRO_YEARLY', 'PRO_LIFETIME'];
        if (!planId || !validPlans.includes(planId)) {
            res.status(400).json({ error: 'Valid planId is required (FREE, PRO_MONTHLY, PRO_YEARLY, PRO_LIFETIME)' });
            return;
        }
        const subStatus = status || 'ACTIVE';
        let periodEnd = null;
        if (planId === 'PRO_MONTHLY') {
            periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
        }
        else if (planId === 'PRO_YEARLY') {
            periodEnd = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
        }
        else if (planId === 'PRO_LIFETIME') {
            periodEnd = null; // Lifetime never expires
        }
        const existing = await dbGet('SELECT id FROM subscriptions WHERE user_id = ?', [targetUserId]);
        if (existing) {
            await dbRun('UPDATE subscriptions SET plan_id = ?, status = ?, current_period_end = ?, payment_provider = "ADMIN_OVERRIDE", updated_at = CURRENT_TIMESTAMP WHERE user_id = ?', [planId, subStatus, periodEnd, targetUserId]);
        }
        else {
            await dbRun('INSERT INTO subscriptions (id, user_id, plan_id, status, current_period_end, payment_provider) VALUES (?, ?, ?, ?, ?, "ADMIN_OVERRIDE")', [uuidv4(), targetUserId, planId, subStatus, periodEnd]);
        }
        await dbRun('INSERT INTO activity_history (id, user_id, action_type, description) VALUES (?, ?, ?, ?)', [uuidv4(), targetUserId, 'UPDATED', `Admin updated plan to ${planId} (${subStatus})`]);
        try {
            await syncToCloudNow();
        }
        catch { }
        res.json({
            message: `User subscription updated to ${planId} successfully`,
            planId,
            status: subStatus,
            currentPeriodEnd: periodEnd
        });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to update user subscription', details: error.message });
    }
}
/**
 * Admin action: reset user's password directly.
 */
export async function resetUserPassword(req, res) {
    try {
        const targetUserId = req.params.id;
        const { newPassword } = req.body;
        if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 6) {
            res.status(400).json({ error: 'New password must be at least 6 characters long' });
            return;
        }
        const { hash, salt } = await hashPassword(newPassword);
        await dbRun('UPDATE users SET password_hash = ?, salt = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [hash, salt, targetUserId]);
        try {
            await syncToCloudNow();
        }
        catch { }
        res.json({ message: 'User password reset successfully' });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to reset password', details: error.message });
    }
}
/**
 * Admin action: update user profile information.
 */
export async function updateUserProfile(req, res) {
    try {
        const targetUserId = req.params.id;
        const { fullName, phone, timezone, isAdmin } = req.body;
        if (fullName !== undefined) {
            await dbRun('UPDATE profiles SET full_name = ? WHERE user_id = ?', [fullName.trim(), targetUserId]);
        }
        if (phone !== undefined) {
            await dbRun('UPDATE profiles SET phone = ? WHERE user_id = ?', [phone ? phone.trim() : null, targetUserId]);
        }
        if (timezone !== undefined) {
            await dbRun('UPDATE profiles SET timezone = ? WHERE user_id = ?', [timezone, targetUserId]);
        }
        if (isAdmin !== undefined) {
            await dbRun('UPDATE users SET is_admin = ? WHERE id = ?', [isAdmin ? 1 : 0, targetUserId]);
        }
        try {
            await syncToCloudNow();
        }
        catch { }
        res.json({ message: 'User profile updated successfully by admin' });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to update user profile', details: error.message });
    }
}
/**
 * Admin action: delete user and wipe associated vault data.
 */
export async function deleteUserByAdmin(req, res) {
    try {
        const targetUserId = req.params.id;
        const callerId = req.user.id;
        if (targetUserId === callerId) {
            res.status(400).json({ error: 'You cannot delete your own admin account from the Admin Panel' });
            return;
        }
        await dbRun('DELETE FROM users WHERE id = ?', [targetUserId]);
        try {
            await syncToCloudNow();
        }
        catch { }
        res.json({ message: 'User and all associated data permanently deleted by admin' });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to delete user', details: error.message });
    }
}
/**
 * Admin action: Export complete snapshot of all users and database records (Disaster Recovery JSON).
 */
export async function exportFullSystemBackup(req, res) {
    try {
        const users = await dbAll('SELECT id, email, password_hash, salt, is_admin, created_at, updated_at FROM users');
        const profiles = await dbAll('SELECT * FROM profiles');
        const categories = await dbAll('SELECT * FROM document_types');
        const documents = await dbAll('SELECT * FROM documents');
        const attachments = await dbAll('SELECT id, document_id, file_name, file_size, mime_type, created_at FROM document_attachments');
        const familyGroups = await dbAll('SELECT * FROM family_groups');
        const familyMembers = await dbAll('SELECT * FROM family_members');
        const familyInvitations = await dbAll('SELECT * FROM family_invitations');
        const permissions = await dbAll('SELECT * FROM document_permissions');
        const subscriptions = await dbAll('SELECT * FROM subscriptions');
        const reminders = await dbAll('SELECT * FROM reminders');
        const renewalHistory = await dbAll('SELECT * FROM renewal_history');
        const activityHistory = await dbAll('SELECT * FROM activity_history');
        const backupPayload = {
            system: 'Document Vault Master Backup',
            exportVersion: '2.0',
            exportedAt: new Date().toISOString(),
            exportedBy: req.user.email,
            counts: {
                users: users.length,
                documents: documents.length,
                categories: categories.length,
                attachments: attachments.length,
                familyGroups: familyGroups.length,
                subscriptions: subscriptions.length
            },
            data: {
                users,
                profiles,
                categories,
                documents,
                attachments,
                familyGroups,
                familyMembers,
                familyInvitations,
                permissions,
                subscriptions,
                reminders,
                renewalHistory,
                activityHistory
            }
        };
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="document_vault_full_backup_${new Date().toISOString().split('T')[0]}.json"`);
        res.json(backupPayload);
    }
    catch (error) {
        console.error('exportFullSystemBackup error:', error);
        res.status(500).json({ error: 'Failed to export full system backup', details: error.message });
    }
}
/**
 * Admin action: Direct download of SQLite database file (.db).
 */
export async function downloadDatabaseFile(req, res) {
    try {
        if (!fs.existsSync(DB_PATH)) {
            res.status(404).json({ error: 'Database file not found on server' });
            return;
        }
        res.setHeader('Content-Type', 'application/x-sqlite3');
        res.setHeader('Content-Disposition', `attachment; filename="document_vault_${new Date().toISOString().split('T')[0]}.db"`);
        const fileStream = fs.createReadStream(DB_PATH);
        fileStream.pipe(res);
    }
    catch (error) {
        console.error('downloadDatabaseFile error:', error);
        res.status(500).json({ error: 'Failed to download database file', details: error.message });
    }
}
/**
 * Admin action: Restore complete database from a JSON snapshot.
 */
export async function restoreFullSystemBackup(req, res) {
    try {
        const { backup } = req.body;
        if (!backup || !backup.data || !backup.data.users) {
            res.status(400).json({ error: 'Invalid backup file format. Missing data or users array.' });
            return;
        }
        const { users = [], profiles = [], categories = [], documents = [], familyGroups = [], familyMembers = [], familyInvitations = [], permissions = [], subscriptions = [], reminders = [], renewalHistory = [], activityHistory = [] } = backup.data;
        let restoredUsers = 0;
        let restoredDocs = 0;
        let restoredSubs = 0;
        await dbRun('BEGIN TRANSACTION');
        try {
            // Restore Users
            for (const u of users) {
                if (!u.id || !u.email)
                    continue;
                await dbRun(`INSERT INTO users (id, email, password_hash, salt, is_admin, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             email = excluded.email,
             password_hash = excluded.password_hash,
             salt = excluded.salt,
             is_admin = excluded.is_admin`, [
                    u.id,
                    u.email,
                    u.password_hash || '',
                    u.salt ?? null,
                    u.is_admin ? 1 : 0,
                    u.created_at || new Date().toISOString(),
                    u.updated_at || new Date().toISOString()
                ]);
                restoredUsers++;
            }
            // Restore Profiles
            for (const p of profiles) {
                if (!p.user_id)
                    continue;
                await dbRun(`INSERT INTO profiles (id, user_id, full_name, avatar_url, phone, timezone, app_lock_enabled, app_lock_pin_hash, biometric_enabled, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id) DO UPDATE SET
             full_name = excluded.full_name,
             avatar_url = excluded.avatar_url,
             phone = excluded.phone,
             timezone = excluded.timezone,
             app_lock_enabled = excluded.app_lock_enabled,
             app_lock_pin_hash = excluded.app_lock_pin_hash,
             biometric_enabled = excluded.biometric_enabled`, [
                    p.id || uuidv4(),
                    p.user_id,
                    p.full_name ?? null,
                    p.avatar_url ?? null,
                    p.phone ?? null,
                    p.timezone ?? 'UTC',
                    p.app_lock_enabled ? 1 : 0,
                    p.app_lock_pin_hash ?? null,
                    p.biometric_enabled ? 1 : 0,
                    p.created_at || new Date().toISOString(),
                    p.updated_at || new Date().toISOString()
                ]);
            }
            // Restore Categories
            for (const cat of categories) {
                if (!cat.id)
                    continue;
                const isCustomVal = cat.is_custom !== undefined ? (cat.is_custom ? 1 : 0) : (cat.is_system ? 0 : 1);
                await dbRun(`INSERT INTO document_types (id, user_id, name, slug, icon, color, is_custom, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO NOTHING`, [
                    cat.id,
                    cat.user_id ?? null,
                    cat.name || 'Category',
                    cat.slug || cat.id,
                    cat.icon || 'FileText',
                    cat.color || '#3b82f6',
                    isCustomVal,
                    cat.created_at || new Date().toISOString()
                ]);
            }
            // Restore Family Groups
            for (const fg of familyGroups) {
                if (!fg.id)
                    continue;
                await dbRun(`INSERT INTO family_groups (id, name, created_by_user_id, created_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET name = excluded.name`, [
                    fg.id,
                    fg.name || 'Family Vault',
                    fg.created_by_user_id,
                    fg.created_at || new Date().toISOString()
                ]);
            }
            // Restore Family Members
            for (const fm of familyMembers) {
                if (!fm.id || !fm.family_group_id)
                    continue;
                await dbRun(`INSERT INTO family_members (id, family_group_id, user_id, name, email, relationship, role, avatar_color, status, invitation_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             name = excluded.name,
             email = excluded.email,
             relationship = excluded.relationship,
             role = excluded.role,
             status = excluded.status`, [
                    fm.id,
                    fm.family_group_id,
                    fm.user_id ?? null,
                    fm.name || 'Family Member',
                    fm.email ?? null,
                    fm.relationship ?? 'Other',
                    fm.role ?? 'MEMBER',
                    fm.avatar_color ?? '#3b82f6',
                    fm.status ?? 'ACTIVE',
                    fm.invitation_id ?? null,
                    fm.created_at || new Date().toISOString()
                ]);
            }
            // Restore Documents
            for (const doc of documents) {
                if (!doc.id || !doc.user_id)
                    continue;
                await dbRun(`INSERT INTO documents (
            id, user_id, family_group_id, owner_member_id, name, document_type_id,
            document_number, issue_date, expiry_date, has_no_expiry, issuing_authority,
            notes, is_archived, archived_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            document_type_id = excluded.document_type_id,
            document_number = excluded.document_number,
            expiry_date = excluded.expiry_date,
            has_no_expiry = excluded.has_no_expiry,
            notes = excluded.notes,
            is_archived = excluded.is_archived`, [
                    doc.id,
                    doc.user_id,
                    doc.family_group_id ?? null,
                    doc.owner_member_id ?? null,
                    doc.name || 'Restored Document',
                    doc.document_type_id || 'cat_other',
                    doc.document_number ?? null,
                    doc.issue_date ?? null,
                    doc.expiry_date ?? null,
                    doc.has_no_expiry ? 1 : 0,
                    doc.issuing_authority ?? null,
                    doc.notes ?? null,
                    doc.is_archived ? 1 : 0,
                    doc.archived_at ?? null,
                    doc.created_at || new Date().toISOString(),
                    doc.updated_at || new Date().toISOString()
                ]);
                restoredDocs++;
            }
            // Restore Subscriptions
            for (const sub of subscriptions) {
                if (!sub.user_id)
                    continue;
                await dbRun(`INSERT INTO subscriptions (id, user_id, plan_id, status, current_period_end, payment_provider, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id) DO UPDATE SET
             plan_id = excluded.plan_id,
             status = excluded.status,
             current_period_end = excluded.current_period_end,
             payment_provider = excluded.payment_provider`, [
                    sub.id || uuidv4(),
                    sub.user_id,
                    sub.plan_id || 'FREE',
                    sub.status || 'ACTIVE',
                    sub.current_period_end ?? null,
                    sub.payment_provider || 'DIRECT',
                    sub.created_at || new Date().toISOString(),
                    sub.updated_at || new Date().toISOString()
                ]);
                restoredSubs++;
            }
            // Restore Reminders
            for (const r of reminders) {
                if (!r.id || !r.document_id || !r.user_id)
                    continue;
                await dbRun(`INSERT INTO reminders (id, document_id, user_id, lead_days, reminder_date, is_active, is_triggered, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO NOTHING`, [
                    r.id,
                    r.document_id,
                    r.user_id,
                    r.lead_days || 30,
                    r.reminder_date || new Date().toISOString(),
                    r.is_active ? 1 : 0,
                    r.is_triggered ? 1 : 0,
                    r.created_at || new Date().toISOString()
                ]);
            }
            // Restore Permissions
            for (const p of permissions) {
                if (!p.id || !p.document_id || !p.shared_with_member_id)
                    continue;
                await dbRun(`INSERT INTO document_permissions (id, document_id, shared_with_member_id, permission_level, granted_by_user_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO NOTHING`, [
                    p.id,
                    p.document_id,
                    p.shared_with_member_id,
                    p.permission_level || 'VIEW',
                    p.granted_by_user_id,
                    p.created_at || new Date().toISOString()
                ]);
            }
            await dbRun('COMMIT');
            res.json({
                success: true,
                message: `System restored successfully! Restored ${restoredUsers} users, ${restoredDocs} documents, and ${restoredSubs} subscriptions.`,
                restoredUsers,
                restoredDocs,
                restoredSubs
            });
        }
        catch (innerErr) {
            await dbRun('ROLLBACK');
            throw innerErr;
        }
    }
    catch (error) {
        console.error('restoreFullSystemBackup error:', error);
        res.status(500).json({ error: 'Failed to restore system backup', details: error.message });
    }
}
/**
 * Get Ad Monetization Settings (Public & User Facing)
 */
export async function getAdSettings(req, res) {
    try {
        const row = await dbGet('SELECT value FROM app_settings WHERE key = "ads_monetization"');
        if (!row) {
            res.json({
                adsEnabled: true,
                adProvider: 'AdMob',
                bannerAdsEnabled: true,
                interstitialAdsEnabled: true,
                interstitialFrequency: 3,
                admobAppId: 'ca-app-pub-3940256099942544~3347511713',
                admobBannerId: 'ca-app-pub-3940256099942544/6300978111',
                admobInterstitialId: 'ca-app-pub-3940256099942544/1033173712',
                customBannerText: 'Upgrade to DocuVault Pro — 100% Ad-Free, Unlimited Docs & Family Sharing',
                customBannerActionUrl: '/subscription'
            });
            return;
        }
        res.json(JSON.parse(row.value));
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to fetch ad settings', details: error.message });
    }
}
/**
 * Update Ad Monetization Settings (Admin Only)
 */
export async function updateAdSettings(req, res) {
    try {
        const settings = req.body;
        await dbRun(`INSERT INTO app_settings (key, value, updated_at) VALUES ('ads_monetization', ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`, [JSON.stringify(settings)]);
        res.json({ success: true, message: 'Ad monetization settings updated successfully', settings });
    }
    catch (error) {
        console.error('updateAdSettings error:', error);
        res.status(500).json({ error: 'Failed to update ad settings', details: error.message });
    }
}
