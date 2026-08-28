import { Router } from 'express';
import {
  register,
  login,
  getMe,
  updateProfile,
  setupAppLock,
  verifyAppLock,
  updateNotificationPreferences,
  deleteAccount,
  forgotPassword,
  verifyResetCode,
  resetPassword,
  submitContactSupport
} from '../controllers/authController.js';
import {
  getDocuments,
  getDocumentById,
  createDocument,
  updateDocument,
  archiveDocument,
  unarchiveDocument,
  renewDocument,
  deleteDocument
} from '../controllers/documentController.js';
import {
  viewAttachment,
  downloadAttachment,
  deleteAttachment
} from '../controllers/attachmentController.js';
import {
  getFamilyGroup,
  updateFamilyGroupName,
  addFamilyMember,
  updateFamilyMember,
  deleteFamilyMember,
  inviteFamilyMember,
  getPendingInvitations,
  acceptInvitation,
  rejectInvitation,
  cancelInvitation,
  leaveFamily,
  deleteFamilyGroup,
  shareDocumentWithMember,
  unshareDocumentFromMember,
  joinFamilyByCode
} from '../controllers/familyController.js';
import {
  getReminders,
  toggleReminder,
  createCustomReminder,
  deleteReminder
} from '../controllers/reminderController.js';
import {
  getCategories,
  createCustomCategory
} from '../controllers/categoryController.js';
import {
  getSubscription,
  upgradeSubscription,
  verifyGooglePlayPurchase,
  restorePurchases
} from '../controllers/subscriptionController.js';
import { exportVaultData, syncVaultData, importVaultData } from '../controllers/backupController.js';
import {
  getAdminStats,
  getAllUsers,
  updateUserSubscription,
  resetUserPassword,
  updateUserProfile,
  deleteUserByAdmin,
  exportFullSystemBackup,
  downloadDatabaseFile,
  restoreFullSystemBackup,
  getAdSettings,
  updateAdSettings
} from '../controllers/adminController.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import {
  requireDocumentView,
  requireDocumentEdit,
  requireDocumentOwner
} from '../middleware/authorization.js';
import { uploadAttachment } from '../middleware/upload.js';

const router = Router();

// --- AUTHENTICATION & PROFILE ---
router.post('/auth/register', register);
router.post('/auth/login', login);
router.post('/auth/forgot-password', forgotPassword);
router.post('/auth/verify-reset-code', verifyResetCode);
router.post('/auth/reset-password', resetPassword);
router.get('/auth/me', authenticateToken as any, getMe as any);
router.put('/auth/profile', authenticateToken as any, updateProfile as any);
router.post('/auth/app-lock', authenticateToken as any, setupAppLock as any);
router.post('/auth/app-lock/setup', authenticateToken as any, setupAppLock as any);
router.post('/auth/app-lock/verify', authenticateToken as any, verifyAppLock as any);
router.put('/auth/notifications', authenticateToken as any, updateNotificationPreferences as any);
router.delete('/auth/account', authenticateToken as any, deleteAccount as any);

// --- DOCUMENTS ---
router.get('/documents', authenticateToken as any, getDocuments as any);
router.get('/documents/:id', authenticateToken as any, requireDocumentView as any, getDocumentById as any);
router.post('/documents', authenticateToken as any, uploadAttachment.single('attachment') as any, createDocument as any);
router.put('/documents/:id', authenticateToken as any, requireDocumentEdit as any, uploadAttachment.single('attachment') as any, updateDocument as any);
router.post('/documents/:id/archive', authenticateToken as any, requireDocumentEdit as any, archiveDocument as any);
router.post('/documents/:id/unarchive', authenticateToken as any, requireDocumentEdit as any, unarchiveDocument as any);
router.post('/documents/:id/renew', authenticateToken as any, requireDocumentEdit as any, uploadAttachment.single('attachment') as any, renewDocument as any);
router.delete('/documents/:id', authenticateToken as any, requireDocumentOwner as any, deleteDocument as any);

// --- ATTACHMENTS (SECURE PRIVATE STREAMING) ---
router.get('/attachments/:id/view', authenticateToken as any, viewAttachment as any);
router.get('/attachments/:id/download', authenticateToken as any, downloadAttachment as any);
router.delete('/attachments/:id', authenticateToken as any, deleteAttachment as any);

// --- FAMILY & SHARING ---
router.get('/family', authenticateToken as any, getFamilyGroup as any);
router.put('/family/name', authenticateToken as any, updateFamilyGroupName as any);
router.delete('/family', authenticateToken as any, deleteFamilyGroup as any);
router.post('/family/leave', authenticateToken as any, leaveFamily as any);
router.post('/family/members', authenticateToken as any, addFamilyMember as any);
router.put('/family/members/:id', authenticateToken as any, updateFamilyMember as any);
router.delete('/family/members/:id', authenticateToken as any, deleteFamilyMember as any);
router.post('/family/invite', authenticateToken as any, inviteFamilyMember as any);
router.post('/family/join-by-code', authenticateToken as any, joinFamilyByCode as any);
router.get('/family/invitations/pending', authenticateToken as any, getPendingInvitations as any);
router.post('/family/invitations/:id/accept', authenticateToken as any, acceptInvitation as any);
router.post('/family/invitations/:id/reject', authenticateToken as any, rejectInvitation as any);
router.delete('/family/invitations/:id', authenticateToken as any, cancelInvitation as any);
router.post('/family/share', authenticateToken as any, shareDocumentWithMember as any);
router.post('/family/unshare', authenticateToken as any, unshareDocumentFromMember as any);

// --- REMINDERS & NOTIFICATIONS ---
router.get('/reminders', authenticateToken as any, getReminders as any);
router.put('/reminders/:id/toggle', authenticateToken as any, toggleReminder as any);
router.post('/reminders/custom', authenticateToken as any, createCustomReminder as any);
router.delete('/reminders/:id', authenticateToken as any, deleteReminder as any);

// --- CATEGORIES ---
router.get('/categories', authenticateToken as any, getCategories as any);
router.post('/categories', authenticateToken as any, createCustomCategory as any);

// --- SUBSCRIPTIONS & ENTITLEMENTS ---
router.get('/subscriptions', authenticateToken as any, getSubscription as any);
router.post('/subscriptions/upgrade', authenticateToken as any, upgradeSubscription as any);
router.post('/subscriptions/verify-purchase', authenticateToken as any, verifyGooglePlayPurchase as any);
router.post('/subscriptions/restore', authenticateToken as any, restorePurchases as any);

// --- DATA BACKUP & EXPORT ---
router.get('/backup/export', authenticateToken as any, exportVaultData as any);
router.post('/backup/sync', authenticateToken as any, syncVaultData as any);
router.post('/backup/import', authenticateToken as any, importVaultData as any);

// --- ADMIN CONTROL PANEL ---
router.get('/admin/stats', authenticateToken as any, requireAdmin as any, getAdminStats as any);
router.get('/admin/users', authenticateToken as any, requireAdmin as any, getAllUsers as any);
router.put('/admin/users/:id/subscription', authenticateToken as any, requireAdmin as any, updateUserSubscription as any);
router.put('/admin/users/:id/reset-password', authenticateToken as any, requireAdmin as any, resetUserPassword as any);
router.put('/admin/users/:id/profile', authenticateToken as any, requireAdmin as any, updateUserProfile as any);
router.delete('/admin/users/:id', authenticateToken as any, requireAdmin as any, deleteUserByAdmin as any);
router.get('/admin/backup/export', authenticateToken as any, requireAdmin as any, exportFullSystemBackup as any);
router.get('/admin/backup/db-file', authenticateToken as any, requireAdmin as any, downloadDatabaseFile as any);
router.post('/admin/backup/restore', authenticateToken as any, requireAdmin as any, restoreFullSystemBackup as any);
router.get('/admin/settings/ads', authenticateToken as any, requireAdmin as any, getAdSettings as any);
router.put('/admin/settings/ads', authenticateToken as any, requireAdmin as any, updateAdSettings as any);

// --- PUBLIC / APP SETTINGS ---
router.get('/settings/ads', getAdSettings as any);

// --- SUPPORT & HELP INQUIRY ---
router.post('/support/contact', submitContactSupport as any);

export default router;
