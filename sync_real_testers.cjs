const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');
const bcrypt = require('bcryptjs');

const dbPath = path.resolve(__dirname, 'storage', 'document_vault.db');
const db = new sqlite3.Database(dbPath);

const testers = [
  { email: 'aqeelworld38@gmail.com', name: 'Aqeel World' },
  { email: 'quantumx.pk@gmail.com', name: 'QuantumX Tester' },
  { email: 'tayybatabassam@gmail.com', name: 'Tayyba Tabassam' },
  { email: 'adeelpay38@gmail.com', name: 'Adeel Pay' },
  { email: 'adeelworld38@gmail.com', name: 'Adeel World' },
  { email: 'connectwithaqeel@gmail.com', name: 'Connect With Aqeel' },
  { email: 'hassanmunib120@gmail.com', name: 'Hassan Munib' },
  { email: 'makramkarsal@gmail.com', name: 'M Akram Karsal' },
  { email: 'qaisaraqeel1995@gmail.com', name: 'Qaisar Aqeel' },
  { email: 'qaisaraqeel2@gmail.com', name: 'Qaisar Aqeel 2' },
  { email: 'sa574354@gmail.com', name: 'SA Tester' },
  { email: 'samreenzahra38383@gmail.com', name: 'Samreen Zahra' },
  { email: 'tayyba3838@gmail.com', name: 'Tayyba 38' },
  { email: 'docuvault.app.help@gmail.com', name: 'Master Administrator', isAdmin: 1 },
  { email: 'admin@docuvault.app', name: 'DocuVault Admin', isAdmin: 1 }
];

async function run() {
  const salt = await bcrypt.genSalt(10);
  const defaultHash = await bcrypt.hash('UserPass2026!', salt);

  const allowedEmails = testers.map(t => t.email.toLowerCase());
  const placeholders = allowedEmails.map(() => '?').join(',');

  db.serialize(() => {
    // 1. Delete all dummy/test users from SQLite
    db.run(`DELETE FROM users WHERE LOWER(email) NOT IN (${placeholders})`, allowedEmails, function(err) {
      if (err) console.error('Delete users err:', err);
      else console.log('Cleaned dummy users from SQLite! Changes:', this.changes);
    });

    // 2. Clean orphaned tables
    db.run('DELETE FROM profiles WHERE user_id NOT IN (SELECT id FROM users)');
    db.run('DELETE FROM subscriptions WHERE user_id NOT IN (SELECT id FROM users)');
    db.run('DELETE FROM documents WHERE user_id NOT IN (SELECT id FROM users)');
    db.run('DELETE FROM document_attachments WHERE document_id NOT IN (SELECT id FROM documents)');
    db.run('DELETE FROM reminders WHERE document_id NOT IN (SELECT id FROM documents)');
    db.run('DELETE FROM family_members WHERE user_id NOT IN (SELECT id FROM users)');
    db.run('DELETE FROM family_groups WHERE created_by_user_id NOT IN (SELECT id FROM users)');

    // 3. Upsert each real tester into SQLite
    testers.forEach((t, index) => {
      const email = t.email.toLowerCase();
      db.get('SELECT id FROM users WHERE LOWER(email) = ?', [email], (err, row) => {
        const userId = row ? row.id : 'usr_real_' + (index + 1);
        const now = new Date().toISOString();

        db.run(
          'INSERT OR REPLACE INTO users (id, email, password_hash, salt, is_admin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [userId, email, defaultHash, salt, t.isAdmin ? 1 : 0, now, now]
        );

        db.run(
          'INSERT OR REPLACE INTO profiles (id, user_id, full_name, timezone, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
          ['prof_' + userId, userId, t.name, 'UTC', now, now]
        );

        db.run(
          'INSERT OR REPLACE INTO subscriptions (id, user_id, plan_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
          ['sub_' + userId, userId, 'FREE', 'ACTIVE', now, now]
        );
      });
    });

    // 4. Export clean snapshot to cloud_vault_db.json
    setTimeout(() => {
      db.all('SELECT * FROM users', (err, users) => {
        db.all('SELECT * FROM profiles', (err2, profiles) => {
          db.all('SELECT * FROM subscriptions', (err3, subscriptions) => {
            const snapshot = {
              version: 1,
              exportedAt: new Date().toISOString(),
              tables: {
                users,
                profiles,
                subscriptions,
                documentTypes: [],
                documents: [],
                attachments: [],
                reminders: [],
                familyGroups: [],
                familyMembers: [],
                documentPermissions: [],
                activityHistory: [
                  {
                    id: 'act_init_prod',
                    user_id: users[0]?.id || 'usr_admin',
                    action_type: 'SYSTEM',
                    description: 'DocuVault Production System Initialized with 13 Real Testers',
                    created_at: new Date().toISOString()
                  }
                ],
                appSettings: [
                  {
                    id: 'app_update_1',
                    key: 'app_version_update',
                    value: JSON.stringify({
                      latestVersionCode: 42,
                      latestVersionName: '4.1.0',
                      title: 'DocuVault Update Available! 🚀',
                      message: 'New update available on Google Play with real-time cloud sync, free family sharing, and PDF previews.',
                      releaseNotes: [
                        'Real-time multi-device cloud synchronization',
                        'Family Vault free 2-member allowance',
                        'Enhanced document download & sharing',
                        'Smoother PDF & document previews'
                      ],
                      forceUpdate: false,
                      playStoreUrl: 'https://play.google.com/store/apps/details?id=com.docuvault.expirymanager'
                    })
                  }
                ]
              }
            };

            const jsonPath = path.resolve(__dirname, 'data', 'cloud_vault_db.json');
            fs.writeFileSync(jsonPath, JSON.stringify(snapshot, null, 2), 'utf8');
            console.log(`Saved pristine snapshot to ${jsonPath} with ${users.length} users!`);
            console.log('User emails:', users.map(u => u.email));
            db.close();
          });
        });
      });
    }, 2000);
  });
}

run();
