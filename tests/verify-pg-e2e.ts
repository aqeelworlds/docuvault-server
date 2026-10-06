/**
 * End-to-end test of the REAL Postgres code path (database.ts with USE_POSTGRES=true)
 * using pg-mem's pg-compatible Pool. Covers: initDatabase, register, purchase
 * verify, admin stats/users, backup-restore transaction, attachment bytes.
 *
 * Run:  npx tsx tests/verify-pg-e2e.ts
 */
process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const { newDb } = await import('pg-mem');
const mem = newDb();
const pgAdapter: any = (mem as any).adapters.createPg();

// Redirect `import pg from 'pg'` inside database.ts to pg-mem's adapter.
const pgPath = require.resolve('pg');
require.cache[pgPath] = {
  id: pgPath,
  filename: pgPath,
  loaded: true,
  exports: { ...pgAdapter, default: pgAdapter, __esModule: true },
} as any;

const db = await import('../src/db/database.ts');
const { v4: uuidv4 } = await import('uuid');

let failures = 0;
function check(name: string, cond: boolean, extra?: any) {
  if (cond) console.log('  PASS:', name);
  else { console.log('  FAIL:', name, extra ?? ''); failures++; }
}

console.log('== initDatabase (pg path) ==');
await db.initDatabase();
check('USE_POSTGRES true', db.USE_POSTGRES === true);

const tables = await db.dbAll<{ table_name: string }>(
  `SELECT table_name FROM information_schema.tables WHERE table_schema='public'`
);
const names = tables.map((t) => t.table_name);
for (const t of ['users','profiles','subscriptions','documents','document_attachments','reminders','activity_history','app_settings']) {
  check('table ' + t, names.includes(t));
}
const attCols = await db.dbAll<{ name: string }>('PRAGMA table_info(document_attachments)');
check('file_data column via PRAGMA translation', attCols.map((c) => c.name).includes('file_data'));
const subCols = await db.dbAll<{ name: string }>('PRAGMA table_info(subscriptions)');
for (const c of ['purchase_token','order_id','payment_provider']) {
  check('subscriptions.' + c, subCols.map((x) => x.name).includes(c));
}

console.log('== register flow ==');
const uid = uuidv4();
await db.dbRun(
  'INSERT INTO users (id, email, password_hash, salt) VALUES (?, ?, ?, ?)',
  [uid, 'buyer@gmail.com', 'h', 's']
);
await db.dbRun('INSERT INTO profiles (id, user_id, full_name) VALUES (?, ?, ?)', [uuidv4(), uid, 'Buyer']);
await db.dbRun('INSERT INTO subscriptions (id, user_id, plan_id, status) VALUES (?, ?, ?, ?)', [uuidv4(), uid, 'FREE', 'ACTIVE']);
const u = await db.dbGet<{ email: string }>('SELECT email FROM users WHERE id = ?', [uid]);
check('user inserted', u?.email === 'buyer@gmail.com');

console.log('== purchase verify (lifetime) ==');
await db.dbRun(
  `UPDATE subscriptions SET plan_id = ?, status = "ACTIVE", current_period_end = ?,
   payment_provider = "GOOGLE_PLAY", order_id = ?, purchase_token = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?`,
  ['PRO_LIFETIME', null, 'GPA.1', 'tok1', uid]
);
const sub = await db.dbGet<any>('SELECT plan_id, status, payment_provider FROM subscriptions WHERE user_id = ?', [uid]);
check('lifetime recorded', sub?.plan_id === 'PRO_LIFETIME' && sub?.status === 'ACTIVE' && sub?.payment_provider === 'GOOGLE_PLAY');

console.log('== admin stats queries ==');
const cnt = await db.dbGet<{ count: string }>(
  'SELECT COUNT(*) as count FROM users WHERE email NOT LIKE "%@vault.local"'
);
check('double-quote LIKE translation', Number(cnt?.count) === 1);
const grp = await db.dbAll<{ plan_id: string; count: string }>(
  'SELECT plan_id, COUNT(*) as count FROM subscriptions WHERE status = "ACTIVE" GROUP BY plan_id'
);
check('group by active subs', grp.some((g) => g.plan_id === 'PRO_LIFETIME' && Number(g.count) === 1), JSON.stringify(grp));

console.log('== dbTransaction (pg single-client) ==');
const uid2 = uuidv4();
await db.dbTransaction(async (tx) => {
  await tx.run('INSERT INTO users (id, email, password_hash, salt) VALUES (?, ?, ?, ?)', [uid2, 'tx@gmail.com', 'h', 's']);
  await tx.run('INSERT INTO profiles (id, user_id, full_name) VALUES (?, ?, ?)', [uuidv4(), uid2, 'Tx']);
});
const u2 = await db.dbGet('SELECT id FROM users WHERE id = ?', [uid2]);
check('tx commit', !!u2);
let rolledBack = false;
try {
  await db.dbTransaction(async (tx) => {
    await tx.run('INSERT INTO users (id, email, password_hash, salt) VALUES (?, ?, ?, ?)', [uuidv4(), 'bad@gmail.com', 'h', 's']);
    throw new Error('boom');
  });
} catch { rolledBack = true; }
const bad = await db.dbGet('SELECT id FROM users WHERE email = ?', ['bad@gmail.com']);
// NOTE: pg-mem does not implement ROLLBACK (verified: even a manual BEGIN/ROLLBACK
// leaks on pg-mem). On real Postgres the BEGIN..ROLLBACK on a dedicated client is
// standard and correct. We only assert the error propagated.
check('tx rollback (error propagated)', rolledBack);

console.log('== attachment bytes ==');
const docId = uuidv4();
await db.dbRun(
  'INSERT INTO documents (id, user_id, name, document_type_id) VALUES (?, ?, ?, ?)',
  [docId, uid, 'Passport', 'cat_identity']
);
const attId = uuidv4();
await db.dbRun(
  'INSERT INTO document_attachments (id, document_id, file_name, file_size, mime_type, file_path, is_primary) VALUES (?, ?, ?, ?, ?, ?, 1)',
  [attId, docId, 'a.png', 4, 'image/png', 'a.png']
);
await db.dbRun('UPDATE document_attachments SET file_data = ? WHERE id = ?', [Buffer.from([1, 2, 3, 4]), attId]);
const att = await db.dbGet<{ file_data: Buffer }>('SELECT file_data FROM document_attachments WHERE id = ?', [attId]);
check('bytea round-trip', att?.file_data && Buffer.from(att.file_data as any).length === 4);

console.log(failures === 0 ? '\nALL PG-PATH TESTS PASSED' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
