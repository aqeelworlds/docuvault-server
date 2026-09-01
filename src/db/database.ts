import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STORAGE_DIR = path.resolve(__dirname, '../../storage');
const VAULT_DIR = path.resolve(STORAGE_DIR, 'vault');
const DB_PATH = path.resolve(STORAGE_DIR, 'document_vault.db');

// Ensure directories exist
if (!fs.existsSync(STORAGE_DIR)) {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
}
if (!fs.existsSync(VAULT_DIR)) {
  fs.mkdirSync(VAULT_DIR, { recursive: true });
}

let dbInstance: sqlite3.Database | null = null;

export function getDb(): sqlite3.Database {
  if (!dbInstance) {
    dbInstance = new sqlite3.Database(DB_PATH);
  }
  return dbInstance;
}

// Promise wrapper for db.run
export function dbRun(sql: string, params: any[] = []): Promise<{ lastID: number; changes: number }> {
  const db = getDb();
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (this: sqlite3.RunResult, err: Error | null) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

// Promise wrapper for db.get
export function dbGet<T = any>(sql: string, params: any[] = []): Promise<T | null> {
  const db = getDb();
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err: Error | null, row: any) => {
      if (err) return reject(err);
      resolve(row ? (row as T) : null);
    });
  });
}

// Promise wrapper for db.all
export function dbAll<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  const db = getDb();
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err: Error | null, rows: any[]) => {
      if (err) return reject(err);
      resolve((rows || []) as T[]);
    });
  });
}

// Promise wrapper for db.exec
export function dbExec(sql: string): Promise<void> {
  const db = getDb();
  return new Promise((resolve, reject) => {
    db.exec(sql, (err: Error | null) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

export async function initDatabase(): Promise<void> {
  const db = getDb();

  // Enable foreign keys
  await dbRun('PRAGMA foreign_keys = ON');

  const schema = `
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      is_admin INTEGER DEFAULT 0,
      last_login_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      user_id TEXT UNIQUE NOT NULL,
      full_name TEXT NOT NULL,
      avatar_url TEXT,
      phone TEXT,
      timezone TEXT DEFAULT 'UTC',
      app_lock_enabled INTEGER DEFAULT 0,
      app_lock_pin_hash TEXT,
      biometric_enabled INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS document_types (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      icon TEXT NOT NULL,
      color TEXT DEFAULT '#4f46e5',
      is_custom INTEGER DEFAULT 0,
      user_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS family_groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_by_user_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS family_members (
      id TEXT PRIMARY KEY,
      family_group_id TEXT NOT NULL,
      user_id TEXT,
      name TEXT NOT NULL,
      relationship TEXT NOT NULL,
      role TEXT DEFAULT 'MEMBER', -- 'OWNER', 'ADMIN', 'MEMBER'
      avatar_color TEXT DEFAULT '#3b82f6',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (family_group_id) REFERENCES family_groups(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      family_group_id TEXT,
      owner_member_id TEXT,
      name TEXT NOT NULL,
      document_type_id TEXT NOT NULL,
      document_number TEXT,
      issue_date TEXT,
      expiry_date TEXT,
      has_no_expiry INTEGER DEFAULT 0,
      issuing_authority TEXT,
      notes TEXT,
      is_archived INTEGER DEFAULT 0,
      archived_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (family_group_id) REFERENCES family_groups(id) ON DELETE SET NULL,
      FOREIGN KEY (owner_member_id) REFERENCES family_members(id) ON DELETE SET NULL,
      FOREIGN KEY (document_type_id) REFERENCES document_types(id)
    );

    CREATE TABLE IF NOT EXISTS document_attachments (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      mime_type TEXT NOT NULL,
      file_path TEXT NOT NULL,
      is_primary INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS document_permissions (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      shared_with_member_id TEXT NOT NULL,
      permission_level TEXT NOT NULL, -- 'VIEW', 'EDIT'
      granted_by_user_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
      FOREIGN KEY (shared_with_member_id) REFERENCES family_members(id) ON DELETE CASCADE,
      FOREIGN KEY (granted_by_user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(document_id, shared_with_member_id)
    );

    CREATE TABLE IF NOT EXISTS reminders (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      lead_days INTEGER NOT NULL, -- 90, 60, 30, 14, 7, 1, or custom
      reminder_date TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      is_triggered INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS renewal_history (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      previous_expiry_date TEXT,
      new_expiry_date TEXT,
      previous_doc_number TEXT,
      new_doc_number TEXT,
      renewed_by_user_id TEXT NOT NULL,
      renewal_notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
      FOREIGN KEY (renewed_by_user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS activity_history (
      id TEXT PRIMARY KEY,
      document_id TEXT,
      user_id TEXT NOT NULL,
      action_type TEXT NOT NULL, -- 'CREATED', 'UPDATED', 'RENEWED', 'ATTACHMENT_ADDED', 'SHARED', 'REMINDER_TRIGGERED'
      description TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      id TEXT PRIMARY KEY,
      user_id TEXT UNIQUE NOT NULL,
      plan_id TEXT DEFAULT 'FREE', -- 'FREE', 'PRO_MONTHLY', 'PRO_YEARLY', 'PRO_LIFETIME'
      status TEXT DEFAULT 'ACTIVE', -- 'ACTIVE', 'EXPIRED', 'TRIAL'
      payment_provider TEXT DEFAULT 'DIRECT',
      current_period_start TEXT,
      current_period_end TEXT,
      cancel_at_period_end INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS notification_preferences (
      id TEXT PRIMARY KEY,
      user_id TEXT UNIQUE NOT NULL,
      in_app_enabled INTEGER DEFAULT 1,
      browser_push_enabled INTEGER DEFAULT 1,
      default_lead_days TEXT DEFAULT '[90, 60, 30, 14, 7, 1]',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS family_invitations (
      id TEXT PRIMARY KEY,
      family_group_id TEXT NOT NULL,
      invited_by_user_id TEXT NOT NULL,
      invitee_email TEXT NOT NULL,
      invitee_user_id TEXT,
      invite_code TEXT,
      relationship TEXT DEFAULT 'Other',
      role TEXT DEFAULT 'MEMBER',
      status TEXT DEFAULT 'PENDING', -- 'PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED'
      expires_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (family_group_id) REFERENCES family_groups(id) ON DELETE CASCADE,
      FOREIGN KEY (invited_by_user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (invitee_user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS password_resets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      email TEXT NOT NULL,
      reset_code TEXT NOT NULL,
      token TEXT NOT NULL,
      used INTEGER DEFAULT 0,
      expires_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_documents_user_id ON documents(user_id);
    CREATE INDEX IF NOT EXISTS idx_documents_expiry_date ON documents(expiry_date);
    CREATE INDEX IF NOT EXISTS idx_reminders_date ON reminders(reminder_date, is_active);
    CREATE INDEX IF NOT EXISTS idx_doc_permissions ON document_permissions(document_id, shared_with_member_id);
    CREATE INDEX IF NOT EXISTS idx_family_invitations_email ON family_invitations(invitee_email, status);
    CREATE INDEX IF NOT EXISTS idx_password_resets_email ON password_resets(email, reset_code, used);
    CREATE INDEX IF NOT EXISTS idx_activity_history_user ON activity_history(user_id, created_at);
  `;

  await dbExec(schema);

  // Initialize Default Ad Monetization Settings
  try {
    const existingAdSettings = await dbGet('SELECT value FROM app_settings WHERE key = "ads_monetization"');
    if (!existingAdSettings) {
      const defaultAds = {
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
      };
      await dbRun('INSERT INTO app_settings (key, value) VALUES ("ads_monetization", ?)', [JSON.stringify(defaultAds)]);
    }
  } catch (e) {
    console.warn('Ad settings init warning:', e);
  }

  // Safe migration for is_archived and archived_at
  try {
    const tableInfo = await dbAll<{ name: string }>('PRAGMA table_info(documents)');
    const colNames = tableInfo.map(c => c.name);
    if (!colNames.includes('is_archived')) {
      await dbRun('ALTER TABLE documents ADD COLUMN is_archived INTEGER DEFAULT 0');
    }
    if (!colNames.includes('archived_at')) {
      await dbRun('ALTER TABLE documents ADD COLUMN archived_at DATETIME');
    }

    const subInfo = await dbAll<{ name: string }>('PRAGMA table_info(subscriptions)');
    const subColNames = subInfo.map(c => c.name);
    if (!subColNames.includes('payment_provider')) {
      await dbRun('ALTER TABLE subscriptions ADD COLUMN payment_provider TEXT DEFAULT "DIRECT"');
    }

    const invInfo = await dbAll<{ name: string }>('PRAGMA table_info(family_invitations)');
    const invColNames = invInfo.map(c => c.name);
    if (!invColNames.includes('invite_code')) {
      await dbRun('ALTER TABLE family_invitations ADD COLUMN invite_code TEXT');
    }
    if (!subColNames.includes('order_id')) {
      await dbRun('ALTER TABLE subscriptions ADD COLUMN order_id TEXT');
    }
    if (!subColNames.includes('purchase_token')) {
      await dbRun('ALTER TABLE subscriptions ADD COLUMN purchase_token TEXT');
    }

    const fmInfo = await dbAll<{ name: string }>('PRAGMA table_info(family_members)');
    const fmColNames = fmInfo.map(c => c.name);
    if (!fmColNames.includes('email')) {
      await dbRun('ALTER TABLE family_members ADD COLUMN email TEXT');
    }
    if (!fmColNames.includes('status')) {
      await dbRun('ALTER TABLE family_members ADD COLUMN status TEXT DEFAULT "ACTIVE"');
    }
    if (!fmColNames.includes('invitation_id')) {
      await dbRun('ALTER TABLE family_members ADD COLUMN invitation_id TEXT');
    }

    const userInfo = await dbAll<{ name: string }>('PRAGMA table_info(users)');
    const userColNames = userInfo.map(c => c.name);
    if (!userColNames.includes('is_admin')) {
      await dbRun('ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0');
    }
    if (!userColNames.includes('last_login_at')) {
      await dbRun('ALTER TABLE users ADD COLUMN last_login_at DATETIME');
    }

    if (!subColNames.includes('current_period_start')) {
      await dbRun('ALTER TABLE subscriptions ADD COLUMN current_period_start TEXT');
    }
    if (!subColNames.includes('cancel_at_period_end')) {
      await dbRun('ALTER TABLE subscriptions ADD COLUMN cancel_at_period_end INTEGER DEFAULT 0');
    }

    // Grant admin role ONLY to official docuvault.app.help@gmail.com
    await dbRun('UPDATE users SET is_admin = 0');
    await dbRun(
      'UPDATE users SET is_admin = 1 WHERE email IN ("docuvault.app.help@gmail.com", "admin@docuvault.app")'
    );
  } catch (migErr) {
    console.error('Migration check notice:', migErr);
  }

  // Seed built-in document categories
  const builtInCategories = [
    { id: 'cat_identity', name: 'Identity', slug: 'identity', icon: 'ShieldCheck', color: '#3b82f6' },
    { id: 'cat_travel', name: 'Travel & Visa', slug: 'travel', icon: 'Plane', color: '#06b6d4' },
    { id: 'cat_driving', name: 'Driving License', slug: 'driving', icon: 'Car', color: '#10b981' },
    { id: 'cat_vehicle', name: 'Vehicle Registration', slug: 'vehicle', icon: 'Truck', color: '#f59e0b' },
    { id: 'cat_insurance', name: 'Insurance', slug: 'insurance', icon: 'HeartPulse', color: '#ec4899' },
    { id: 'cat_health', name: 'Health & Medical', slug: 'health', icon: 'Activity', color: '#ef4444' },
    { id: 'cat_education', name: 'Education & Degree', slug: 'education', icon: 'GraduationCap', color: '#8b5cf6' },
    { id: 'cat_employment', name: 'Employment & Work', slug: 'employment', icon: 'Briefcase', color: '#6366f1' },
    { id: 'cat_property', name: 'Property & Rental', slug: 'property', icon: 'Home', color: '#14b8a6' },
    { id: 'cat_finance', name: 'Finance & Banking', slug: 'finance', icon: 'CreditCard', color: '#84cc16' },
    { id: 'cat_warranty', name: 'Warranty & Purchase', slug: 'warranty', icon: 'Award', color: '#f97316' },
    { id: 'cat_membership', name: 'Membership & Club', slug: 'membership', icon: 'Users', color: '#a855f7' },
    { id: 'cat_other', name: 'Other Documents', slug: 'other', icon: 'FileText', color: '#64748b' }
  ];

  for (const cat of builtInCategories) {
    const existing = await dbGet('SELECT id FROM document_types WHERE id = ?', [cat.id]);
    if (!existing) {
      await dbRun(
        'INSERT INTO document_types (id, name, slug, icon, color, is_custom, user_id) VALUES (?, ?, ?, ?, ?, 0, NULL)',
        [cat.id, cat.name, cat.slug, cat.icon, cat.color]
      );
    }
  }

  console.log('✅ Document Vault SQLite database initialized with full schema and seed categories.');
}
export { STORAGE_DIR, VAULT_DIR, DB_PATH };
