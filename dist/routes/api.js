import { Router } from 'express';
import { register, login, getMe, updateProfile, setupAppLock, verifyAppLock, updateNotificationPreferences, deleteAccount, forgotPassword, verifyResetCode, resetPassword, submitContactSupport } from '../controllers/authController.js';
import { getDocuments, getDocumentById, createDocument, updateDocument, archiveDocument, unarchiveDocument, renewDocument, deleteDocument } from '../controllers/documentController.js';
import { viewAttachment, downloadAttachment, deleteAttachment } from '../controllers/attachmentController.js';
import { getFamilyGroup, updateFamilyGroupName, addFamilyMember, updateFamilyMember, deleteFamilyMember, inviteFamilyMember, getPendingInvitations, acceptInvitation, rejectInvitation, cancelInvitation, leaveFamily, deleteFamilyGroup, shareDocumentWithMember, unshareDocumentFromMember, joinFamilyByCode } from '../controllers/familyController.js';
import { getReminders, toggleReminder, createCustomReminder, deleteReminder } from '../controllers/reminderController.js';
import { getCategories, createCustomCategory } from '../controllers/categoryController.js';
import { getSubscription, upgradeSubscription, verifyGooglePlayPurchase, restorePurchases } from '../controllers/subscriptionController.js';
import { exportVaultData, syncVaultData, importVaultData } from '../controllers/backupController.js';
import { getAdminStats, getAllUsers, updateUserSubscription, resetUserPassword, updateUserProfile, deleteUserByAdmin, exportFullSystemBackup, downloadDatabaseFile, restoreFullSystemBackup, getAdSettings, updateAdSettings } from '../controllers/adminController.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { requireDocumentView, requireDocumentEdit, requireDocumentOwner } from '../middleware/authorization.js';
import { uploadAttachment } from '../middleware/upload.js';
const router = Router();
import { DB_PATH, STORAGE_DIR, dbRun, dbGet } from '../db/database.js';
router.get('/health', (_req, res) => {
    res.json({
        status: 'healthy',
        service: 'Document Vault Backend API',
        timestamp: new Date().toISOString(),
        version: '1.0.0'
    });
});
router.get('/debug-db', async (_req, res) => {
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
// --- AUTHENTICATION & PROFILE ---
router.post('/auth/register', register);
router.post('/auth/login', login);
router.post('/auth/forgot-password', forgotPassword);
router.post('/auth/verify-reset-code', verifyResetCode);
router.post('/auth/reset-password', resetPassword);
router.get('/auth/me', authenticateToken, getMe);
router.put('/auth/profile', authenticateToken, updateProfile);
router.post('/auth/app-lock', authenticateToken, setupAppLock);
router.post('/auth/app-lock/setup', authenticateToken, setupAppLock);
router.post('/auth/app-lock/verify', authenticateToken, verifyAppLock);
router.put('/auth/notifications', authenticateToken, updateNotificationPreferences);
router.delete('/auth/account', authenticateToken, deleteAccount);
// --- DOCUMENTS ---
router.get('/documents', authenticateToken, getDocuments);
router.get('/documents/:id', authenticateToken, requireDocumentView, getDocumentById);
router.post('/documents', authenticateToken, uploadAttachment.single('attachment'), createDocument);
router.put('/documents/:id', authenticateToken, requireDocumentEdit, uploadAttachment.single('attachment'), updateDocument);
router.post('/documents/:id/archive', authenticateToken, requireDocumentEdit, archiveDocument);
router.post('/documents/:id/unarchive', authenticateToken, requireDocumentEdit, unarchiveDocument);
router.post('/documents/:id/renew', authenticateToken, requireDocumentEdit, uploadAttachment.single('attachment'), renewDocument);
router.delete('/documents/:id', authenticateToken, requireDocumentOwner, deleteDocument);
// --- ATTACHMENTS (SECURE PRIVATE STREAMING) ---
router.get('/attachments/:id/view', authenticateToken, viewAttachment);
router.get('/attachments/:id/download', authenticateToken, downloadAttachment);
router.delete('/attachments/:id', authenticateToken, deleteAttachment);
// --- FAMILY & SHARING ---
router.get('/family', authenticateToken, getFamilyGroup);
router.put('/family/name', authenticateToken, updateFamilyGroupName);
router.delete('/family', authenticateToken, deleteFamilyGroup);
router.post('/family/leave', authenticateToken, leaveFamily);
router.post('/family/members', authenticateToken, addFamilyMember);
router.put('/family/members/:id', authenticateToken, updateFamilyMember);
router.delete('/family/members/:id', authenticateToken, deleteFamilyMember);
router.post('/family/invite', authenticateToken, inviteFamilyMember);
router.post('/family/join-by-code', authenticateToken, joinFamilyByCode);
router.get('/family/invitations/pending', authenticateToken, getPendingInvitations);
router.post('/family/invitations/:id/accept', authenticateToken, acceptInvitation);
router.post('/family/invitations/:id/reject', authenticateToken, rejectInvitation);
router.delete('/family/invitations/:id', authenticateToken, cancelInvitation);
router.post('/family/share', authenticateToken, shareDocumentWithMember);
router.post('/family/unshare', authenticateToken, unshareDocumentFromMember);
// --- REMINDERS & NOTIFICATIONS ---
router.get('/reminders', authenticateToken, getReminders);
router.put('/reminders/:id/toggle', authenticateToken, toggleReminder);
router.post('/reminders/custom', authenticateToken, createCustomReminder);
router.delete('/reminders/:id', authenticateToken, deleteReminder);
// --- CATEGORIES ---
router.get('/categories', authenticateToken, getCategories);
router.post('/categories', authenticateToken, createCustomCategory);
// --- SUBSCRIPTIONS & ENTITLEMENTS ---
router.get('/subscriptions', authenticateToken, getSubscription);
router.post('/subscriptions/upgrade', authenticateToken, upgradeSubscription);
router.post('/subscriptions/verify-purchase', authenticateToken, verifyGooglePlayPurchase);
router.post('/subscriptions/restore', authenticateToken, restorePurchases);
// --- DATA BACKUP & EXPORT ---
router.get('/backup/export', authenticateToken, exportVaultData);
router.post('/backup/sync', authenticateToken, syncVaultData);
router.post('/backup/import', authenticateToken, importVaultData);
// --- ADMIN CONTROL PANEL ---
router.get('/admin/stats', authenticateToken, requireAdmin, getAdminStats);
router.get('/admin/users', authenticateToken, requireAdmin, getAllUsers);
router.put('/admin/users/:id/subscription', authenticateToken, requireAdmin, updateUserSubscription);
router.put('/admin/users/:id/reset-password', authenticateToken, requireAdmin, resetUserPassword);
router.put('/admin/users/:id/profile', authenticateToken, requireAdmin, updateUserProfile);
router.delete('/admin/users/:id', authenticateToken, requireAdmin, deleteUserByAdmin);
router.get('/admin/backup/export', authenticateToken, requireAdmin, exportFullSystemBackup);
router.get('/admin/backup/db-file', authenticateToken, requireAdmin, downloadDatabaseFile);
router.post('/admin/backup/restore', authenticateToken, requireAdmin, restoreFullSystemBackup);
router.get('/admin/settings/ads', authenticateToken, requireAdmin, getAdSettings);
router.put('/admin/settings/ads', authenticateToken, requireAdmin, updateAdSettings);
// --- PUBLIC / APP SETTINGS ---
router.get('/settings/ads', getAdSettings);
// --- SUPPORT & HELP INQUIRY ---
router.post('/support/contact', submitContactSupport);
export default router;
