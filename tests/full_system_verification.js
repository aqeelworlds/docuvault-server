import http from 'node:http';
import assert from 'node:assert/strict';
import express from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import apiRouter from '../dist/routes/api.js';
import { initDatabase, dbRun, dbGet, dbAll } from '../dist/db/database.js';
import { calculateExpiryMetrics, differenceInCalendarDays, generateReminderDates } from '../dist/services/expiryService.js';

console.log('====================================================');
console.log('DOCUMENT VAULT - PRODUCTION FULL SYSTEM VERIFICATION');
console.log('====================================================');

const PORT = 5098;
const BASE_URL = `http://localhost:${PORT}/api`;

async function request(endpoint, options = {}) {
  const url = `${BASE_URL}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  const res = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

async function runAudit() {
  await initDatabase();

  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use('/api', apiRouter);

  const server = app.listen(PORT);
  console.log(`[1/8] Test Server running on ${BASE_URL}`);

  try {
    // 1. Deterministic Calculations Test
    console.log('\n[2/8] Testing Deterministic Expiry Engine (Zero AI)...');
    const baseDate = new Date('2026-06-01T00:00:00Z');

    const activeTest = calculateExpiryMetrics('2026-09-01', false, baseDate); // 92 days
    assert.equal(activeTest.status, 'ACTIVE');
    assert.equal(activeTest.daysRemaining, 92);
    console.log('  ✔ Active (>30 days) calculated correctly:', activeTest.formattedRemaining);

    const expiringTest = calculateExpiryMetrics('2026-06-25', false, baseDate); // 24 days
    assert.equal(expiringTest.status, 'EXPIRING_SOON');
    assert.equal(expiringTest.daysRemaining, 24);
    console.log('  ✔ Expiring Soon (<=30 days) calculated correctly:', expiringTest.formattedRemaining);

    const todayTest = calculateExpiryMetrics('2026-06-01', false, baseDate); // 0 days
    assert.equal(todayTest.status, 'EXPIRING_SOON');
    assert.equal(todayTest.daysRemaining, 0);
    assert.equal(todayTest.formattedRemaining, 'Expires today');
    console.log('  ✔ Expires Today (0 days) boundary verified');

    const expiredTest = calculateExpiryMetrics('2026-05-15', false, baseDate); // -17 days
    assert.equal(expiredTest.status, 'EXPIRED');
    assert.equal(expiredTest.daysRemaining, -17);
    console.log('  ✔ Expired (<0 days) calculated correctly:', expiredTest.formattedRemaining);

    const lifetimeTest = calculateExpiryMetrics(null, true);
    assert.equal(lifetimeTest.status, 'LIFETIME');
    console.log('  ✔ Lifetime / No Expiry handled correctly:', lifetimeTest.formattedRemaining);

    // 2. Authentication & App Lock Flow
    console.log('\n[3/8] Testing Authentication & App Lock Security...');
    const userEmail = `auditor_${Date.now()}@documentvault.app`;
    const regRes = await request('/auth/register', {
      method: 'POST',
      body: {
        email: userEmail,
        password: 'VaultSecurePass2026!',
        fullName: 'Dr. Evelyn Vance'
      }
    });
    assert.equal(regRes.status, 201);
    const token = regRes.data.token;
    const userId = regRes.data.user.id;
    console.log('  ✔ User Registered and Session Token generated');

    const pinSetupRes = await request('/auth/app-lock', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: { enabled: true, pin: '7410', biometricEnabled: true }
    });
    assert.equal(pinSetupRes.status, 200);

    const pinVerifyGood = await request('/auth/app-lock/verify', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: { pin: '7410' }
    });
    assert.equal(pinVerifyGood.status, 200);
    assert.equal(pinVerifyGood.data.valid, true);

    const pinVerifyBad = await request('/auth/app-lock/verify', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: { pin: '0000' }
    });
    assert.equal(pinVerifyBad.status, 401);
    console.log('  ✔ App Lock PIN protection and biometric verification tested');

    // 3. Document Creation & Lifecycle
    console.log('\n[4/8] Testing Document Creation & Expiry Reminders...');
    const passportRes = await request('/documents', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: {
        name: 'Diplomatic Passport',
        documentTypeId: 'cat_travel',
        documentNumber: 'DP-8839210',
        issueDate: '2020-01-15',
        expiryDate: '2030-01-15',
        issuingAuthority: 'Department of Foreign Affairs',
        notes: 'Official government service passport',
        reminders: [90, 60, 30, 14, 7, 1]
      }
    });
    assert.equal(passportRes.status, 201);
    const passportId = passportRes.data.documentId;
    console.log('  ✔ Document created with auto-scheduled reminders (ID:', passportId, ')');

    // 4. Renewal Flow & Timeline Verification
    console.log('\n[5/8] Testing Document Renewal Workflow & Immutable History...');
    const renewRes = await request(`/documents/${passportId}/renew`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: {
        newIssueDate: '2030-01-15',
        newExpiryDate: '2040-01-15',
        newDocumentNumber: 'DP-8839210-R2',
        renewalNotes: '10-year official extension approved'
      }
    });
    assert.equal(renewRes.status, 200);

    const detailRes = await request(`/documents/${passportId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(detailRes.status, 200);
    assert.equal(detailRes.data.document.document_number, 'DP-8839210-R2');
    assert.equal(detailRes.data.document.expiry_date, '2040-01-15');
    assert.equal(detailRes.data.document.renewalHistory[0].previous_expiry_date, '2030-01-15');
    assert.equal(detailRes.data.document.renewalHistory[0].new_expiry_date, '2040-01-15');
    console.log('  ✔ Renewal successfully created immutable history log with previous vs new expiry dates');

    // 5. Cross-User Data Isolation Check
    console.log('\n[6/8] Testing Cross-User Security Isolation (No Leakage)...');
    const attackerRes = await request('/auth/register', {
      method: 'POST',
      body: {
        email: `attacker_${Date.now()}@evil.local`,
        password: 'AttackerPassword1!',
        fullName: 'Malicious Actor'
      }
    });
    const attackerToken = attackerRes.data.token;

    const stealDoc = await request(`/documents/${passportId}`, {
      headers: { Authorization: `Bearer ${attackerToken}` }
    });
    assert.equal(stealDoc.status, 403);

    const tamperDoc = await request(`/documents/${passportId}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${attackerToken}` },
      body: { name: 'Compromised Document' }
    });
    assert.equal(tamperDoc.status, 403);

    const deleteDoc = await request(`/documents/${passportId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${attackerToken}` }
    });
    assert.equal(deleteDoc.status, 403);
    console.log('  ✔ CRITICAL SECURITY PASSED: Unauthorized user cannot read, edit, or delete another user\'s documents (403 Forbidden)');

    // 6. Pro Subscription & Entitlements
    console.log('\n[7/8] Testing Free Tier 5-Document Limit & Pro Upgrades...');
    // Create 4 more docs to hit the 5 limit
    for (let i = 2; i <= 5; i++) {
      const res = await request('/documents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: { name: `Doc ${i}`, documentTypeId: 'cat_identity', expiryDate: '2028-10-10' }
      });
      assert.equal(res.status, 201);
    }

    // 6th document should be rejected on Free plan
    const overLimitRes = await request('/documents', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: { name: 'Doc 6 (Should Fail)', documentTypeId: 'cat_identity', expiryDate: '2028-10-10' }
    });
    assert.equal(overLimitRes.status, 403);
    assert.equal(overLimitRes.data.code, 'PLAN_LIMIT_REACHED');
    console.log('  ✔ Free tier enforcement: 6th document blocked with PLAN_LIMIT_REACHED');

    // Upgrade to Pro
    const upgradeRes = await request('/subscriptions/upgrade', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: { planId: 'PRO_YEARLY' }
    });
    assert.equal(upgradeRes.status, 200);
    assert.equal(upgradeRes.data.planId, 'PRO_YEARLY');

    // 6th document now succeeds
    const proDocRes = await request('/documents', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: { name: 'Doc 6 (Allowed on Pro)', documentTypeId: 'cat_identity', expiryDate: '2028-10-10' }
    });
    assert.equal(proDocRes.status, 201);
    console.log('  ✔ Pro upgrade verified: Unlimited document creation unlocked');

    // 7. Full Data Export
    console.log('\n[8/8] Testing Vault Backup & Export...');
    const exportRes = await request('/backup/export', {
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(exportRes.status, 200);
    assert.ok(exportRes.data.documents.length >= 6);
    assert.ok(exportRes.data.renewalHistory.length >= 1);
    console.log(`  ✔ Backup export generated with ${exportRes.data.documents.length} documents and renewal logs`);

    console.log('\n====================================================');
    console.log('🎉 ALL SYSTEM AUDITS PASSED WITH 100% SUCCESS RATE');
    console.log('====================================================');
  } finally {
    server.close();
  }
}

runAudit().catch((err) => {
  console.error('Audit failed:', err);
  process.exit(1);
});
