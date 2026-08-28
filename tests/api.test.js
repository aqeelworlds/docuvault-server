import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import apiRouter from '../dist/routes/api.js';
import { initDatabase, dbRun, dbGet } from '../dist/db/database.js';
import { calculateExpiryMetrics, generateReminderDates, differenceInCalendarDays } from '../dist/services/expiryService.js';

let server;
let baseUrl;
const TEST_PORT = 5099;

before(async () => {
  await initDatabase();

  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use('/api', apiRouter);

  await new Promise((resolve) => {
    server = app.listen(TEST_PORT, () => {
      baseUrl = `http://localhost:${TEST_PORT}/api`;
      resolve();
    });
  });
});

after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
});

async function apiRequest(endpoint, options = {}) {
  const url = `${baseUrl}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  const response = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  return { status: response.status, data };
}

describe('1. Deterministic Expiry & Date Engine (No AI)', () => {
  test('Calculates ACTIVE status for document with >30 days remaining', () => {
    const today = new Date('2026-06-01T00:00:00Z');
    const expiry = '2026-08-15'; // 75 days later
    const metrics = calculateExpiryMetrics(expiry, false, today);

    assert.equal(metrics.status, 'ACTIVE');
    assert.equal(metrics.daysRemaining, 75);
    assert.equal(metrics.isExpired, false);
    assert.equal(metrics.isExpiringSoon, false);
  });

  test('Calculates EXPIRING_SOON status for document with <=30 days remaining', () => {
    const today = new Date('2026-06-01T00:00:00Z');
    const expiry = '2026-06-29'; // 28 days later
    const metrics = calculateExpiryMetrics(expiry, false, today);

    assert.equal(metrics.status, 'EXPIRING_SOON');
    assert.equal(metrics.daysRemaining, 28);
    assert.equal(metrics.isExpired, false);
    assert.equal(metrics.isExpiringSoon, true);
    assert.equal(metrics.formattedRemaining, 'Expires in 28 days');
  });

  test('Calculates EXPIRING_SOON for 0 days (Expires today)', () => {
    const today = new Date('2026-06-01T00:00:00Z');
    const expiry = '2026-06-01';
    const metrics = calculateExpiryMetrics(expiry, false, today);

    assert.equal(metrics.status, 'EXPIRING_SOON');
    assert.equal(metrics.daysRemaining, 0);
    assert.equal(metrics.formattedRemaining, 'Expires today');
    assert.equal(metrics.urgencyLevel, 'urgent');
  });

  test('Calculates EXPIRED status for past dates', () => {
    const today = new Date('2026-06-01T00:00:00Z');
    const expiry = '2026-05-20'; // 12 days ago
    const metrics = calculateExpiryMetrics(expiry, false, today);

    assert.equal(metrics.status, 'EXPIRED');
    assert.equal(metrics.daysRemaining, -12);
    assert.equal(metrics.isExpired, true);
    assert.equal(metrics.formattedRemaining, 'Expired 12 days ago');
  });

  test('Calculates LIFETIME status when hasNoExpiry is true', () => {
    const metrics = calculateExpiryMetrics(null, true);
    assert.equal(metrics.status, 'LIFETIME');
    assert.equal(metrics.daysRemaining, null);
    assert.equal(metrics.formattedRemaining, 'No Expiry');
  });

  test('Generates exact reminder dates for scheduled lead days', () => {
    const expiry = '2026-10-01';
    const leadDays = [90, 60, 30, 14, 7, 1];
    const reminders = generateReminderDates(expiry, leadDays);

    assert.equal(reminders.length, 6);
    assert.equal(reminders[0].leadDays, 90);
    assert.equal(reminders[0].reminderDate, '2026-07-03');
    assert.equal(reminders[5].leadDays, 1);
    assert.equal(reminders[5].reminderDate, '2026-09-30');
  });
});

describe('2. Authentication & User Profile Flow', () => {
  const userAEmail = `test_user_a_${Date.now()}@example.com`;
  const userBEmail = `test_user_b_${Date.now()}@example.com`;
  let tokenA;
  let userAId;
  let tokenB;
  let userBId;

  test('Registers User A and initializes default family group and free subscription', async () => {
    const res = await apiRequest('/auth/register', {
      method: 'POST',
      body: {
        email: userAEmail,
        password: 'Password123!',
        fullName: 'Alice Johnson'
      }
    });

    assert.equal(res.status, 201);
    assert.ok(res.data.token);
    assert.equal(res.data.user.email, userAEmail);
    assert.equal(res.data.user.fullName, 'Alice Johnson');
    assert.equal(res.data.user.planId, 'FREE');

    tokenA = res.data.token;
    userAId = res.data.user.id;
  });

  test('Rejects duplicate registration for same email', async () => {
    const res = await apiRequest('/auth/register', {
      method: 'POST',
      body: {
        email: userAEmail,
        password: 'Password123!',
        fullName: 'Alice Johnson'
      }
    });

    assert.equal(res.status, 409);
  });

  test('Logs in User A and retrieves profile', async () => {
    const res = await apiRequest('/auth/login', {
      method: 'POST',
      body: {
        email: userAEmail,
        password: 'Password123!'
      }
    });

    assert.equal(res.status, 200);
    assert.ok(res.data.token);
    assert.equal(res.data.user.fullName, 'Alice Johnson');
  });

  test('Rejects login with invalid password', async () => {
    const res = await apiRequest('/auth/login', {
      method: 'POST',
      body: {
        email: userAEmail,
        password: 'WrongPassword!'
      }
    });

    assert.equal(res.status, 401);
  });

  test('Registers User B for cross-user isolation tests', async () => {
    const res = await apiRequest('/auth/register', {
      method: 'POST',
      body: {
        email: userBEmail,
        password: 'Password123!',
        fullName: 'Bob Smith'
      }
    });

    assert.equal(res.status, 201);
    tokenB = res.data.token;
    userBId = res.data.user.id;
  });

  test('Configures and verifies App Lock PIN for User A', async () => {
    const setupRes = await apiRequest('/auth/app-lock', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: { enabled: true, pin: '1234', biometricEnabled: true }
    });

    assert.equal(setupRes.status, 200);
    assert.equal(setupRes.data.appLockEnabled, true);

    const verifySuccess = await apiRequest('/auth/app-lock/verify', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: { pin: '1234' }
    });

    assert.equal(verifySuccess.status, 200);
    assert.equal(verifySuccess.data.valid, true);

    const verifyFail = await apiRequest('/auth/app-lock/verify', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: { pin: '9999' }
    });

    assert.equal(verifyFail.status, 401);
  });
});

describe('3. Document Management & Cross-User Security Isolation', () => {
  let tokenA;
  let tokenB;
  let doc1Id;

  before(async () => {
    // Create fresh test users
    const emailA = `doc_a_${Date.now()}@example.com`;
    const emailB = `doc_b_${Date.now()}@example.com`;

    const resA = await apiRequest('/auth/register', {
      method: 'POST',
      body: { email: emailA, password: 'Password123!', fullName: 'Doc Owner' }
    });
    tokenA = resA.data.token;

    const resB = await apiRequest('/auth/register', {
      method: 'POST',
      body: { email: emailB, password: 'Password123!', fullName: 'Other User' }
    });
    tokenB = resB.data.token;
  });

  test('User A creates a Passport document with expiry in 45 days', async () => {
    const res = await apiRequest('/documents', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: {
        name: 'US Passport',
        documentTypeId: 'cat_travel',
        documentNumber: 'A12345678',
        issueDate: '2016-08-01',
        expiryDate: '2026-10-15',
        issuingAuthority: 'Department of State',
        notes: 'Primary international travel document'
      }
    });

    assert.equal(res.status, 201);
    assert.ok(res.data.documentId);
    doc1Id = res.data.documentId;
  });

  test('User A can view their document with deterministic expiry and auto-reminders', async () => {
    const res = await apiRequest(`/documents/${doc1Id}`, {
      headers: { Authorization: `Bearer ${tokenA}` }
    });

    assert.equal(res.status, 200);
    assert.equal(res.data.document.name, 'US Passport');
    assert.equal(res.data.document.document_number, 'A12345678');
    assert.ok(res.data.document.reminders.length > 0);
    assert.equal(res.data.document.userPermission, 'OWNER');
  });

  test('CRITICAL SECURITY: User B CANNOT view User A\'s document (403 Forbidden)', async () => {
    const res = await apiRequest(`/documents/${doc1Id}`, {
      headers: { Authorization: `Bearer ${tokenB}` }
    });

    assert.equal(res.status, 403);
  });

  test('CRITICAL SECURITY: User B CANNOT update User A\'s document (403 Forbidden)', async () => {
    const res = await apiRequest(`/documents/${doc1Id}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${tokenB}` },
      body: { name: 'Hacked Passport' }
    });

    assert.equal(res.status, 403);
  });

  test('CRITICAL SECURITY: User B CANNOT delete User A\'s document (403 Forbidden)', async () => {
    const res = await apiRequest(`/documents/${doc1Id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tokenB}` }
    });

    assert.equal(res.status, 403);
  });
});

describe('4. Document Renewal & Timeline History Flow', () => {
  let tokenA;
  let docId;

  before(async () => {
    const emailA = `renewal_${Date.now()}@example.com`;
    const resA = await apiRequest('/auth/register', {
      method: 'POST',
      body: { email: emailA, password: 'Password123!', fullName: 'Renewal Tester' }
    });
    tokenA = resA.data.token;

    const docRes = await apiRequest('/documents', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: {
        name: 'Driving License',
        documentTypeId: 'cat_driving',
        documentNumber: 'DL-998877',
        issueDate: '2021-03-10',
        expiryDate: '2026-03-10',
        issuingAuthority: 'DMV'
      }
    });
    docId = docRes.data.documentId;
  });

  test('Renews document with new expiry and creates immutable history', async () => {
    const renewRes = await apiRequest(`/documents/${docId}/renew`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: {
        newIssueDate: '2026-03-10',
        newExpiryDate: '2031-03-10',
        newDocumentNumber: 'DL-998877-RENEWED',
        renewalNotes: 'Standard 5-year renewal completed online'
      }
    });

    assert.equal(renewRes.status, 200);
    assert.equal(renewRes.data.newExpiryDate, '2031-03-10');

    // Fetch document details to verify renewal history
    const detailRes = await apiRequest(`/documents/${docId}`, {
      headers: { Authorization: `Bearer ${tokenA}` }
    });

    assert.equal(detailRes.status, 200);
    assert.equal(detailRes.data.document.document_number, 'DL-998877-RENEWED');
    assert.equal(detailRes.data.document.expiry_date, '2031-03-10');
    assert.ok(detailRes.data.document.renewalHistory.length >= 1);
    assert.equal(detailRes.data.document.renewalHistory[0].previous_expiry_date, '2026-03-10');
    assert.equal(detailRes.data.document.renewalHistory[0].new_expiry_date, '2031-03-10');
    assert.equal(detailRes.data.document.renewalHistory[0].renewal_notes, 'Standard 5-year renewal completed online');
  });
});

describe('5. Free vs Pro Subscription Entitlements', () => {
  let tokenUser;

  before(async () => {
    const email = `sub_tester_${Date.now()}@example.com`;
    const res = await apiRequest('/auth/register', {
      method: 'POST',
      body: { email, password: 'Password123!', fullName: 'Sub Tester' }
    });
    tokenUser = res.data.token;
  });

  test('Allows Free user to add up to 5 documents', async () => {
    for (let i = 1; i <= 5; i++) {
      const res = await apiRequest('/documents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenUser}` },
        body: {
          name: `Doc ${i}`,
          documentTypeId: 'cat_other',
          expiryDate: `2027-0${i}-01`
        }
      });
      assert.equal(res.status, 201);
    }
  });

  test('Blocks 6th document creation on Free plan with PLAN_LIMIT_REACHED (403)', async () => {
    const res = await apiRequest('/documents', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenUser}` },
      body: {
        name: 'Doc 6 (Should Fail on Free Tier)',
        documentTypeId: 'cat_other',
        expiryDate: '2027-06-01'
      }
    });

    assert.equal(res.status, 403);
    assert.equal(res.data.code, 'PLAN_LIMIT_REACHED');
  });

  test('Upgrades user to Document Vault Pro', async () => {
    const upgradeRes = await apiRequest('/subscriptions/upgrade', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenUser}` },
      body: { planId: 'PRO_MONTHLY' }
    });

    assert.equal(upgradeRes.status, 200);
    assert.equal(upgradeRes.data.planId, 'PRO_MONTHLY');
    assert.equal(upgradeRes.data.status, 'ACTIVE');
  });

  test('Allows Pro user to add 6th document without limits', async () => {
    const res = await apiRequest('/documents', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenUser}` },
      body: {
        name: 'Doc 6 (Allowed on Pro)',
        documentTypeId: 'cat_other',
        expiryDate: '2027-06-01'
      }
    });

    assert.equal(res.status, 201);
  });
});
