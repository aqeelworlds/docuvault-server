import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * DATABASE STRATEGY
 * -----------------
 * If DATABASE_URL is set (e.g. Supabase / Neon Postgres), PostgreSQL is used as the
 * single persistent source of truth. This is REQUIRED on serverless hosts (Vercel),
 * where the local filesystem (and therefore SQLite) is ephemeral and wiped constantly.
 *
 * If DATABASE_URL is NOT set, the code falls back to local SQLite (dev / legacy mode).
 */

export const USE_POSTGRES = !!process.env.DATABASE_URL;

// ---------------------------------------------------------------------------
// Postgres plumbing
// ---------------------------------------------------------------------------
import pg from 'pg';

const { Pool } = pg;
let pgPool: pg.Pool | null = null;

function getPgPool(): pg.Pool {
  if (!pgPool) {
    pgPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      // Supabase / Neon require SSL; keep it lenient for managed hosts.
      ssl: { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
    pgPool.on('error', (err) => console.error('[DocuVault DB] pg pool error:', err.message));
  }
  return pgPool;
}

/**
 * Translate SQLite-flavoured SQL to Postgres:
 *  - `?` placeholders  -> `$1, $2, ...` (outside string literals)
 *  - `"literal"`       -> `'literal'`   (this codebase never uses " for identifiers)
 *  - DATETIME          -> TIMESTAMP
 *
 * Exported for automated tests.
 */
export function toPostgres(sql: string): string {
  let out = '';
  let i = 0;
  let idx = 1;
  let quote: string | null = null;
  while (i < sql.length) {
    const c = sql[i];
    if (quote) {
      if (c === quote) {
        // '' inside a string is an escaped quote: keep both chars as-is.
        if (sql[i + 1] === quote) {
          out += c + sql[i + 1];
          i += 2;
          continue;
        }
        // Closing quote: convert a double-quoted string literal to single quotes.
        out += quote === '"' ? "'" : quote;
        quote = null;
        i++;
        continue;
      }
      out += c;
      i++;
      continue;
    }
    if (c === "'") {
      out += c;
      quote = "'";
      i++;
      continue;
    }
    if (c === '"') {
      out += "'";
      quote = '"';
      i++;
      continue;
    }
    if (c === '?') {
      out += '$' + idx++;
      i++;
      continue;
    }
    out += c;
    i++;
  }
  out = out.replace(/\bDATETIME\b/gi, 'TIMESTAMP');
  return out;
}

function isPragmaTableInfo(sql: string): string | null {
  const m = /^\s*PRAGMA\s+table_info\s*\(\s*["'`\[]?(\w+)["'`\]]?\s*\)\s*;?\s*$/i.exec(sql);
  return m ? m[1] : null;
}

function isPragmaNoop(sql: string): boolean {
  return /^\s*PRAGMA\s/i.test(sql);
}

// ---------------------------------------------------------------------------
// SQLite plumbing (legacy / local dev)
// ---------------------------------------------------------------------------
const BUNDLED_STORAGE_DIR = path.resolve(__dirname, '../../storage');

const isBundledWritable = () => {
  try {
    const testFile = path.resolve(BUNDLED_STORAGE_DIR, '.w_test_' + Date.now());
    fs.writeFileSync(testFile, '1');
    fs.unlinkSync(testFile);
    return true;
  } catch {
    return false;
  }
};

const isServerless = !isBundledWritable();

export const STORAGE_DIR = isServerless
  ? path.resolve(os.tmpdir(), 'docuvault_data')
  : BUNDLED_STORAGE_DIR;

export const VAULT_DIR = path.resolve(STORAGE_DIR, 'vault');
export const DB_PATH = path.resolve(STORAGE_DIR, 'document_vault.db');

// Ensure directories exist with full read-write permissions
try {
  if (!fs.existsSync(STORAGE_DIR)) {
    fs.mkdirSync(STORAGE_DIR, { recursive: true, mode: 0o777 });
  }
  if (!fs.existsSync(VAULT_DIR)) {
    fs.mkdirSync(VAULT_DIR, { recursive: true, mode: 0o777 });
  }
} catch (e) {
  console.warn('[DocuVault DB] Error ensuring storage directories:', e);
}

let dbInstance: sqlite3.Database | null = null;

export function getDb(): sqlite3.Database {
  if (!dbInstance) {
    dbInstance = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
      if (err) {
        console.error('[DocuVault DB] Failed to open SQLite database at', DB_PATH, err);
      } else {
        dbInstance?.run('PRAGMA journal_mode = MEMORY');
        dbInstance?.run('PRAGMA temp_store = MEMORY');
        dbInstance?.run('PRAGMA synchronous = OFF');
        console.log('[DocuVault DB] Successfully connected to SQLite at', DB_PATH);
      }
    });
  }
  return dbInstance;
}

// ---------------------------------------------------------------------------
// Unified query API (works with Postgres or SQLite)
// ---------------------------------------------------------------------------

// Promise wrapper for db.run
export function dbRun(sql: string, params: any[] = []): Promise<{ lastID: number; changes: number }> {
  if (USE_POSTGRES) {
    if (isPragmaNoop(sql)) return Promise.resolve({ lastID: 0, changes: 0 });
    const pgSql = toPostgres(sql);
    return getPgPool()
      .query(pgSql, params)
      .then((res) => ({ lastID: 0, changes: res.rowCount ?? 0 }))
      .catch((err) => {
        console.error('[DocuVault DB] pg dbRun failed:', err.message, '| SQL:', pgSql.slice(0, 160));
        throw err;
      });
  }
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
  if (USE_POSTGRES) {
    const table = isPragmaTableInfo(sql);
    const pgSql = table
      ? `SELECT column_name AS name FROM information_schema.columns WHERE table_name = '${table}'`
      : toPostgres(sql);
    const pgParams = table ? [] : params;
    return getPgPool()
      .query(pgSql, pgParams)
      .then((res) => (res.rows[0] ? (res.rows[0] as T) : null))
      .catch((err) => {
        console.error('[DocuVault DB] pg dbGet failed:', err.message, '| SQL:', pgSql.slice(0, 160));
        throw err;
      });
  }
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
  if (USE_POSTGRES) {
    const table = isPragmaTableInfo(sql);
    const pgSql = table
      ? `SELECT column_name AS name FROM information_schema.columns WHERE table_name = '${table}'`
      : toPostgres(sql);
    const pgParams = table ? [] : params;
    return getPgPool()
      .query(pgSql, pgParams)
      .then((res) => (res.rows || []) as T[])
      .catch((err) => {
        console.error('[DocuVault DB] pg dbAll failed:', err.message, '| SQL:', pgSql.slice(0, 160));
        throw err;
      });
  }
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
  if (USE_POSTGRES) {
    if (isPragmaNoop(sql)) return Promise.resolve();
    const pgSql = toPostgres(sql);
    return getPgPool()
      .query(pgSql)
      .then(() => undefined)
      .catch((err) => {
        console.error('[DocuVault DB] pg dbExec failed:', err.message);
        throw err;
      });
  }
  const db = getDb();
  return new Promise((resolve, reject) => {
    db.exec(sql, (err: Error | null) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

export interface TxClient {
  run: (sql: string, params?: any[]) => Promise<{ lastID: number; changes: number }>;
  get: <T = any>(sql: string, params?: any[]) => Promise<T | null>;
  all: <T = any>(sql: string, params?: any[]) => Promise<T[]>;
}

/**
 * Run a function inside a real database transaction.
 * On Postgres this checks out ONE pooled client for the whole transaction
 * (BEGIN/COMMIT across separate pool.query calls would silently break).
 */
export async function dbTransaction<T>(fn: (tx: TxClient) => Promise<T>): Promise<T> {
  if (USE_POSTGRES) {
    const client = await getPgPool().connect();
    try {
      await client.query('BEGIN');
      const tx: TxClient = {
        run: async (sql, params = []) => {
          const res = await client.query(toPostgres(sql), params);
          return { lastID: 0, changes: res.rowCount ?? 0 };
        },
        get: async <T = any>(sql: string, params: any[] = []): Promise<T | null> => {
          const res = await client.query(toPostgres(sql), params);
          return res.rows[0] ? (res.rows[0] as T) : null;
        },
        all: async <T = any>(sql: string, params: any[] = []): Promise<T[]> => {
          const res = await client.query(toPostgres(sql), params);
          return (res.rows || []) as T[];
        },
      };
      const result = await fn(tx);
      await client.query('COMMIT');
      return result;
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch {}
      throw e;
    } finally {
      client.release();
    }
  }
  await dbRun('BEGIN TRANSACTION');
  try {
    const result = await fn({ run: dbRun, get: dbGet, all: dbAll });
    await dbRun('COMMIT');
    return result;
  } catch (e) {
    try {
      await dbRun('ROLLBACK');
    } catch {}
    throw e;
  }
}

export async function initDatabase(): Promise<void> {
  if (!USE_POSTGRES) {
    const db = getDb();
    // Enable foreign keys
    await dbRun('PRAGMA foreign_keys = ON');
    void db;
  }

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

  // Safe migration for columns added after initial release.
  // (PRAGMA table_info is transparently translated for Postgres.)
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
    if (!subColNames.includes('order_id')) {
      await dbRun('ALTER TABLE subscriptions ADD COLUMN order_id TEXT');
    }
    if (!subColNames.includes('purchase_token')) {
      await dbRun('ALTER TABLE subscriptions ADD COLUMN purchase_token TEXT');
    }
    if (!subColNames.includes('current_period_start')) {
      await dbRun('ALTER TABLE subscriptions ADD COLUMN current_period_start TEXT');
    }
    if (!subColNames.includes('cancel_at_period_end')) {
      await dbRun('ALTER TABLE subscriptions ADD COLUMN cancel_at_period_end INTEGER DEFAULT 0');
    }

    const invInfo = await dbAll<{ name: string }>('PRAGMA table_info(family_invitations)');
    const invColNames = invInfo.map(c => c.name);
    if (!invColNames.includes('invite_code')) {
      await dbRun('ALTER TABLE family_invitations ADD COLUMN invite_code TEXT');
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

    // Persistent attachment bytes: keeps uploaded files safe even when the
    // serverless filesystem is wiped (Vercel /tmp is ephemeral).
    const attInfo = await dbAll<{ name: string }>('PRAGMA table_info(document_attachments)');
    const attColNames = attInfo.map(c => c.name);
    if (!attColNames.includes('file_data')) {
      await dbRun(USE_POSTGRES
        ? 'ALTER TABLE document_attachments ADD COLUMN file_data BYTEA'
        : 'ALTER TABLE document_attachments ADD COLUMN file_data BLOB');
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

  console.log(`✅ Document Vault database initialized (${USE_POSTGRES ? 'PostgreSQL' : 'SQLite'}) with full schema and seed categories.`);
}
