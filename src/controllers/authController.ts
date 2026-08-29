import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { dbGet, dbRun, dbAll, VAULT_DIR } from '../db/database.js';
import { hashPassword, verifyPassword, generateToken, hashPin, AuthenticatedRequest } from '../middleware/auth.js';
import { sendPasswordResetOtp, sendSupportInquiry } from '../services/emailService.js';
import fs from 'fs';
import path from 'path';

export async function register(req: Request, res: Response): Promise<void> {
  try {
    const { email, password, fullName } = req.body;

    if (!email || !password || !fullName) {
      res.status(400).json({ error: 'Email, password, and full name are required' });
      return;
    }

    if (typeof email !== 'string' || !email.includes('@')) {
      res.status(400).json({ error: 'Valid email address is required' });
      return;
    }

    if (typeof password !== 'string' || password.length < 6) {
      res.status(400).json({ error: 'Password must be at least 6 characters long' });
      return;
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Check if user already exists
    const existing = await dbGet<{ id: string }>('SELECT id FROM users WHERE email = ?', [normalizedEmail]);
    if (existing) {
      res.status(409).json({ error: 'An account with this email already exists' });
      return;
    }

    const userId = uuidv4();
    const profileId = uuidv4();
    const familyGroupId = uuidv4();
    const familyMemberId = uuidv4();
    const subscriptionId = uuidv4();
    const notifPrefId = uuidv4();

    const { hash, salt } = await hashPassword(password);

    // Insert user
    await dbRun(
      'INSERT INTO users (id, email, password_hash, salt) VALUES (?, ?, ?, ?)',
      [userId, normalizedEmail, hash, salt]
    );

    // Insert profile
    await dbRun(
      'INSERT INTO profiles (id, user_id, full_name) VALUES (?, ?, ?)',
      [profileId, userId, fullName.trim()]
    );

    // Insert default family group & owner member
    await dbRun(
      'INSERT INTO family_groups (id, name, created_by_user_id) VALUES (?, ?, ?)',
      [familyGroupId, `${fullName.trim()}'s Family`, userId]
    );

    await dbRun(
      'INSERT INTO family_members (id, family_group_id, user_id, name, relationship, role, avatar_color) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [familyMemberId, familyGroupId, userId, fullName.trim(), 'Primary Account Holder', 'OWNER', '#4f46e5']
    );

    // Insert default free subscription
    await dbRun(
      'INSERT INTO subscriptions (id, user_id, plan_id, status) VALUES (?, ?, ?, ?)',
      [subscriptionId, userId, 'FREE', 'ACTIVE']
    );

    // Insert default notification preferences
    await dbRun(
      'INSERT INTO notification_preferences (id, user_id) VALUES (?, ?)',
      [notifPrefId, userId]
    );

    // Record activity
    await dbRun(
      'INSERT INTO activity_history (id, user_id, action_type, description) VALUES (?, ?, ?, ?)',
      [uuidv4(), userId, 'CREATED', 'Document Vault account created']
    );

    const token = generateToken({ id: userId, email: normalizedEmail, fullName: fullName.trim() });

    res.status(201).json({
      message: 'Account created successfully',
      token,
      user: {
        id: userId,
        email: normalizedEmail,
        fullName: fullName.trim(),
        avatarUrl: null,
        appLockEnabled: false,
        biometricEnabled: false,
        planId: 'FREE',
        familyGroupId,
        familyMemberId
      }
    });
  } catch (error: any) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Failed to create account', details: error.message });
  }
}

export async function login(req: Request, res: Response): Promise<void> {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }

    const normalizedEmail = email.toLowerCase().trim();
    const user = await dbGet<{ id: string; email: string; password_hash: string; salt: string; is_admin?: number }>(
      'SELECT id, email, password_hash, salt, is_admin FROM users WHERE email = ?',
      [normalizedEmail]
    );

    if (!user) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const isValid = await verifyPassword(password, user.password_hash);
    if (!isValid) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const profile = await dbGet<{
      full_name: string;
      avatar_url: string | null;
      phone: string | null;
      timezone: string;
      app_lock_enabled: number;
      app_lock_pin_hash: string | null;
      biometric_enabled: number;
    }>('SELECT full_name, avatar_url, phone, timezone, app_lock_enabled, app_lock_pin_hash, biometric_enabled FROM profiles WHERE user_id = ?', [user.id]);

    const subscription = await dbGet<{ plan_id: string; status: string; current_period_end: string | null }>(
      'SELECT plan_id, status, current_period_end FROM subscriptions WHERE user_id = ?',
      [user.id]
    );

    const familyMember = await dbGet<{ id: string; family_group_id: string }>(
      'SELECT id, family_group_id FROM family_members WHERE user_id = ?',
      [user.id]
    );

    const isAdmin = Boolean(
      (user.is_admin && (normalizedEmail === 'docuvault.app.help@gmail.com' || normalizedEmail === 'admin@docuvault.app')) ||
      normalizedEmail === 'docuvault.app.help@gmail.com' ||
      normalizedEmail === 'admin@docuvault.app'
    );

    const token = generateToken({
      id: user.id,
      email: user.email,
      fullName: profile?.full_name || 'User',
      isAdmin
    });

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        email: user.email,
        fullName: profile?.full_name || 'User',
        avatarUrl: profile?.avatar_url || null,
        phone: profile?.phone || null,
        timezone: profile?.timezone || 'UTC',
        appLockEnabled: Boolean(profile?.app_lock_enabled),
        hasPinSet: Boolean(profile?.app_lock_pin_hash),
        biometricEnabled: Boolean(profile?.biometric_enabled),
        planId: subscription?.plan_id || 'FREE',
        subscriptionStatus: subscription?.status || 'ACTIVE',
        currentPeriodEnd: subscription?.current_period_end || null,
        familyGroupId: familyMember?.family_group_id || null,
        familyMemberId: familyMember?.id || null,
        isAdmin
      }
    });
  } catch (error: any) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed', details: error.message });
  }
}

export async function getMe(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;

    const user = await dbGet<{ id: string; email: string }>('SELECT id, email FROM users WHERE id = ?', [userId]);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const profile = await dbGet<{
      full_name: string;
      avatar_url: string | null;
      phone: string | null;
      timezone: string;
      app_lock_enabled: number;
      app_lock_pin_hash: string | null;
      biometric_enabled: number;
    }>('SELECT full_name, avatar_url, phone, timezone, app_lock_enabled, app_lock_pin_hash, biometric_enabled FROM profiles WHERE user_id = ?', [userId]);

    const subscription = await dbGet<{ plan_id: string; status: string; current_period_end: string | null }>(
      'SELECT plan_id, status, current_period_end FROM subscriptions WHERE user_id = ?',
      [userId]
    );

    const familyMember = await dbGet<{ id: string; family_group_id: string; role: string }>(
      'SELECT id, family_group_id, role FROM family_members WHERE user_id = ?',
      [userId]
    );

    const notifPref = await dbGet<{ in_app_enabled: number; browser_push_enabled: number; default_lead_days: string }>(
      'SELECT in_app_enabled, browser_push_enabled, default_lead_days FROM notification_preferences WHERE user_id = ?',
      [userId]
    );

    // Count user documents
    const docCountRow = await dbGet<{ count: number }>('SELECT COUNT(*) as count FROM documents WHERE user_id = ?', [userId]);
    const documentCount = docCountRow?.count || 0;

    const rawPlanId = subscription?.plan_id || 'FREE';
    const isLifetime = rawPlanId === 'PRO_LIFETIME' || rawPlanId === 'vault_pro_lifetime';
    let subStatus = subscription?.status || 'ACTIVE';

    if (rawPlanId !== 'FREE' && !isLifetime && subscription?.current_period_end) {
      if (new Date(subscription.current_period_end).getTime() < Date.now()) {
        subStatus = 'EXPIRED';
      }
    }

    const isPro = rawPlanId !== 'FREE' && subStatus === 'ACTIVE';

    res.json({
      user: {
        id: user.id,
        email: user.email,
        fullName: profile?.full_name || 'User',
        avatarUrl: profile?.avatar_url || null,
        phone: profile?.phone || null,
        timezone: profile?.timezone || 'UTC',
        appLockEnabled: Boolean(profile?.app_lock_enabled),
        hasPinSet: Boolean(profile?.app_lock_pin_hash),
        biometricEnabled: Boolean(profile?.biometric_enabled),
        planId: rawPlanId,
        subscriptionStatus: subStatus,
        isLifetime,
        isPro,
        isAdmin: Boolean(req.user?.isAdmin),
        currentPeriodEnd: isLifetime ? null : (subscription?.current_period_end || null),
        familyGroupId: familyMember?.family_group_id || null,
        familyMemberId: familyMember?.id || null,
        familyRole: familyMember?.role || 'MEMBER',
        documentCount,
        documentLimit: isPro ? Infinity : 5,
        notificationPreferences: {
          inAppEnabled: Boolean(notifPref?.in_app_enabled ?? 1),
          browserPushEnabled: Boolean(notifPref?.browser_push_enabled ?? 1),
          defaultLeadDays: notifPref ? JSON.parse(notifPref.default_lead_days || '[90,60,30,14,7,1]') : [90, 60, 30, 14, 7, 1]
        }
      }
    });
  } catch (error: any) {
    console.error('getMe error:', error);
    res.status(500).json({ error: 'Failed to fetch user profile', details: error.message });
  }
}

export async function updateProfile(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;
    const { fullName, phone, timezone, avatarUrl } = req.body;

    if (!fullName || typeof fullName !== 'string') {
      res.status(400).json({ error: 'Full name is required' });
      return;
    }

    await dbRun(
      'UPDATE profiles SET full_name = ?, phone = ?, timezone = ?, avatar_url = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
      [fullName.trim(), phone || null, timezone || 'UTC', avatarUrl || null, userId]
    );

    // Also update family member name if owner
    await dbRun(
      'UPDATE family_members SET name = ? WHERE user_id = ? AND role = "OWNER"',
      [fullName.trim(), userId]
    );

    res.json({ message: 'Profile updated successfully' });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to update profile', details: error.message });
  }
}

export async function setupAppLock(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;
    const { enabled, pin, biometricEnabled } = req.body;

    if (enabled && pin) {
      if (typeof pin !== 'string' || (pin.length !== 4 && pin.length !== 6) || !/^\d+$/.test(pin)) {
        res.status(400).json({ error: 'PIN must be a 4-digit or 6-digit number' });
        return;
      }

      const pinHash = hashPin(pin, userId);
      await dbRun(
        'UPDATE profiles SET app_lock_enabled = 1, app_lock_pin_hash = ?, biometric_enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
        [pinHash, biometricEnabled ? 1 : 0, userId]
      );
      res.json({ message: 'App Lock enabled successfully', appLockEnabled: true });
    } else if (!enabled) {
      await dbRun(
        'UPDATE profiles SET app_lock_enabled = 0, app_lock_pin_hash = NULL, biometric_enabled = 0, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
        [userId]
      );
      res.json({ message: 'App Lock disabled', appLockEnabled: false });
    } else {
      res.status(400).json({ error: 'PIN is required to enable App Lock' });
    }
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to configure App Lock', details: error.message });
  }
}

export async function verifyAppLock(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;
    const { pin } = req.body;

    if (!pin) {
      res.status(400).json({ error: 'PIN is required' });
      return;
    }

    const profile = await dbGet<{ app_lock_pin_hash: string | null }>(
      'SELECT app_lock_pin_hash FROM profiles WHERE user_id = ?',
      [userId]
    );

    if (!profile || !profile.app_lock_pin_hash) {
      res.status(400).json({ error: 'App Lock is not configured' });
      return;
    }

    const inputHash = hashPin(pin, userId);
    if (inputHash === profile.app_lock_pin_hash) {
      res.json({ valid: true, message: 'App Lock verified' });
    } else {
      res.status(401).json({ valid: false, error: 'Incorrect PIN' });
    }
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to verify PIN', details: error.message });
  }
}

export async function updateNotificationPreferences(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;
    const { inAppEnabled, browserPushEnabled, defaultLeadDays } = req.body;

    const leadDaysJson = Array.isArray(defaultLeadDays) ? JSON.stringify(defaultLeadDays) : '[90, 60, 30, 14, 7, 1]';

    await dbRun(
      'UPDATE notification_preferences SET in_app_enabled = ?, browser_push_enabled = ?, default_lead_days = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
      [inAppEnabled ? 1 : 0, browserPushEnabled ? 1 : 0, leadDaysJson, userId]
    );

    res.json({ message: 'Notification preferences updated' });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to update preferences', details: error.message });
  }
}

export async function deleteAccount(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;

    // Get all user document attachments to remove files from storage disk
    const attachments = await dbAll<{ file_path: string }>(
      `SELECT a.file_path FROM document_attachments a
       JOIN documents d ON a.document_id = d.id
       WHERE d.user_id = ?`,
      [userId]
    );

    for (const att of attachments) {
      const fullPath = path.resolve(VAULT_DIR, att.file_path);
      if (fs.existsSync(fullPath)) {
        try { fs.unlinkSync(fullPath); } catch {}
      }
    }

    // Delete user from DB (foreign keys cascade to all profiles, documents, reminders, permissions, etc.)
    await dbRun('DELETE FROM users WHERE id = ?', [userId]);

    res.json({ message: 'Account and all associated documents permanently deleted' });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to delete account', details: error.message });
  }
}

export async function forgotPassword(req: Request, res: Response): Promise<void> {
  try {
    const { email } = req.body;

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      res.status(400).json({ error: 'Valid email address is required' });
      return;
    }

    const normalizedEmail = email.toLowerCase().trim();
    const user = await dbGet<{ id: string; email: string }>('SELECT id, email FROM users WHERE email = ?', [normalizedEmail]);

    if (!user) {
      res.status(404).json({ error: 'No Document Vault account found with this email address' });
      return;
    }

    // Invalidate previous active reset codes for this email
    await dbRun('UPDATE password_resets SET used = 1 WHERE email = ? AND used = 0', [normalizedEmail]);

    // Generate 6-digit verification code & token
    const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
    const resetToken = uuidv4();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 minutes validity

    await dbRun(
      `INSERT INTO password_resets (id, user_id, email, reset_code, token, used, expires_at)
       VALUES (?, ?, ?, ?, ?, 0, ?)`,
      [uuidv4(), user.id, normalizedEmail, resetCode, resetToken, expiresAt]
    );

    // Record activity
    await dbRun(
      'INSERT INTO activity_history (id, user_id, action_type, description) VALUES (?, ?, ?, ?)',
      [uuidv4(), user.id, 'UPDATED', `Password reset code requested for ${normalizedEmail}`]
    );

    // Send real email via SMTP / nodemailer
    await sendPasswordResetOtp(normalizedEmail, resetCode);

    res.json({
      message: `Password reset code sent to ${normalizedEmail}. Please check your email inbox.`,
      email: normalizedEmail,
      resetCode,
      expiresInMinutes: 15
    });
  } catch (error: any) {
    console.error('forgotPassword error:', error);
    res.status(500).json({ error: 'Failed to process password reset request', details: error.message });
  }
}

export async function verifyResetCode(req: Request, res: Response): Promise<void> {
  try {
    const { email, resetCode } = req.body;

    if (!email || !resetCode) {
      res.status(400).json({ error: 'Email and 6-digit reset code are required' });
      return;
    }

    const normalizedEmail = email.toLowerCase().trim();
    const resetRecord = await dbGet<{ id: string; token: string; expires_at: string; used: number }>(
      'SELECT id, token, expires_at, used FROM password_resets WHERE email = ? AND reset_code = ? AND used = 0 ORDER BY created_at DESC LIMIT 1',
      [normalizedEmail, resetCode.trim()]
    );

    if (!resetRecord) {
      res.status(400).json({ error: 'Invalid or already used reset code' });
      return;
    }

    if (new Date(resetRecord.expires_at).getTime() < Date.now()) {
      res.status(400).json({ error: 'Reset code has expired. Please request a new code.' });
      return;
    }

    res.json({ valid: true, message: 'Reset code verified successfully', token: resetRecord.token });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to verify reset code', details: error.message });
  }
}

export async function resetPassword(req: Request, res: Response): Promise<void> {
  try {
    const { email, resetCode, newPassword } = req.body;

    if (!email || !resetCode || !newPassword) {
      res.status(400).json({ error: 'Email, reset code, and new password are required' });
      return;
    }

    if (typeof newPassword !== 'string' || newPassword.length < 6) {
      res.status(400).json({ error: 'New password must be at least 6 characters long' });
      return;
    }

    const normalizedEmail = email.toLowerCase().trim();
    const resetRecord = await dbGet<{ id: string; user_id: string; expires_at: string; used: number }>(
      'SELECT id, user_id, expires_at, used FROM password_resets WHERE email = ? AND reset_code = ? AND used = 0 ORDER BY created_at DESC LIMIT 1',
      [normalizedEmail, resetCode.trim()]
    );

    if (!resetRecord) {
      res.status(400).json({ error: 'Invalid or expired password reset code' });
      return;
    }

    if (new Date(resetRecord.expires_at).getTime() < Date.now()) {
      res.status(400).json({ error: 'This reset code has expired. Please request a new one.' });
      return;
    }

    const { hash, salt } = await hashPassword(newPassword);

    // Update password in users table
    await dbRun(
      'UPDATE users SET password_hash = ?, salt = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [hash, salt, resetRecord.user_id]
    );

    // Mark reset code as used
    await dbRun('UPDATE password_resets SET used = 1 WHERE id = ?', [resetRecord.id]);

    // Record activity
    await dbRun(
      'INSERT INTO activity_history (id, user_id, action_type, description) VALUES (?, ?, ?, ?)',
      [uuidv4(), resetRecord.user_id, 'UPDATED', 'Account password was successfully reset']
    );

    res.json({ message: 'Password reset successful! You can now log in with your new password.' });
  } catch (error: any) {
    console.error('resetPassword error:', error);
    res.status(500).json({ error: 'Failed to reset password', details: error.message });
  }
}

export async function submitContactSupport(req: Request, res: Response): Promise<void> {
  try {
    const { name, email, message } = req.body;
    if (!name || !email || !message) {
      res.status(400).json({ error: 'Name, email, and message are required' });
      return;
    }

    await sendSupportInquiry(name.trim(), email.trim(), message.trim());
    res.json({
      success: true,
      message: 'Your message has been sent directly to the support team. We will get back to you shortly!'
    });
  } catch (error: any) {
    console.error('submitContactSupport error:', error);
    res.status(500).json({ error: 'Failed to send support request', details: error.message });
  }
}

