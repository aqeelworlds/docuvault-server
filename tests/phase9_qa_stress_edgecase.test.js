import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import apiRouter from '../dist/routes/api.js';
import { initDatabase, dbRun, dbGet, dbAll } from '../dist/db/database.js';
import { calculateExpiryMetrics, differenceInCalendarDays, generateReminderDates } from '../dist/services/expiryService.js';

const PORT = 5126;
const BASE_URL = `http://localhost:${PORT}/api`;

let server;
let userToken, userId, userEmail, userMemberId;

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

describe('PHASE 9: Complete QA, Stress Testing, Performance & Edge-Case Hardening Test Suite', () => {
  before(async () => {
    await initDatabase();

    const app = express();
    app.use(cors());
    app.use(express.json({ limit: '20mb' }));
    app.use(express.urlencoded({ extended: true, limit: '20mb' }));
    app.use('/api', apiRouter);

    server = app.listen(PORT);

    // Register primary QA user
    userEmail = `qa_journey_${Date.now()}@vault.local`;
    const regRes = await request('/auth/register', {
      method: 'POST',
      body: {
        email: userEmail,
        password: 'QAPassword123!',
        fullName: 'Elena Rostova QA'
      }
    });
    assert.equal(regRes.status, 201);
    userToken = regRes.data.token;
    userId = regRes.data.user.id;
    userMemberId = regRes.data.user.familyMemberId;
  });

  after(() => {
    server?.close();
  });

  describe('1. Complete End-to-End User Journey Verification', () => {
    let journeyDocId;
    let familyMemberId;

    it('Step 1: Retrieves user profile & default FREE subscription', async () => {
      const res = await request('/auth/me', {
        headers: { 'Authorization': `Bearer ${userToken}` }
      });
      assert.equal(res.status, 200);
      assert.equal(res.data.user.email, userEmail);
      assert.equal(res.data.user.planId, 'FREE');
    });

    it('Step 2: Adds a new driving license document with automatic reminders', async () => {
      const res = await request('/documents', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${userToken}` },
        body: {
          name: 'Elena Driving License',
          documentTypeId: 'cat_driving',
          documentNumber: 'DL-99228811',
          issueDate: '2022-06-01',
          expiryDate: '2032-06-01',
          issuingAuthority: 'State DMV',
          notes: 'Standard class C driving license'
        }
      });
      assert.equal(res.status, 201);
      journeyDocId = res.data.documentId;
      assert.ok(journeyDocId);
    });

    it('Step 3: Fetches document details with verified reminders & zero AI status', async () => {
      const res = await request(`/documents/${journeyDocId}`, {
        headers: { 'Authorization': `Bearer ${userToken}` }
      });
      assert.equal(res.status, 200);
      assert.equal(res.data.document.name, 'Elena Driving License');
      assert.equal(res.data.document.document_number, 'DL-99228811');
      assert.equal(res.data.document.status, 'ACTIVE');
      assert.ok(res.data.document.reminders.length > 0);
    });

    it('Step 4: Renews the document to a new expiry date (2037-06-01)', async () => {
      const res = await request(`/documents/${journeyDocId}/renew`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${userToken}` },
        body: {
          newExpiryDate: '2037-06-01',
          newIssueDate: '2032-06-01',
          renewalNotes: 'Renewed online via DMV portal'
        }
      });
      assert.equal(res.status, 200);

      // Verify renewal history record
      const detailRes = await request(`/documents/${journeyDocId}`, {
        headers: { 'Authorization': `Bearer ${userToken}` }
      });
      assert.equal(detailRes.status, 200);
      assert.equal(detailRes.data.document.renewalHistory.length, 1);
      assert.equal(detailRes.data.document.renewalHistory[0].new_expiry_date, '2037-06-01');
    });

    it('Step 5: Upgrades to Pro and adds a family member profile', async () => {
      const upRes = await request('/subscriptions/upgrade', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${userToken}` },
        body: { planId: 'PRO_YEARLY' }
      });
      assert.equal(upRes.status, 200);

      const memRes = await request('/family/members', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${userToken}` },
        body: {
          name: 'Lucas Rostova',
          relationship: 'Son'
        }
      });
      assert.equal(memRes.status, 201);
      familyMemberId = memRes.data.memberId;
    });

    it('Step 6: Shares document with family member', async () => {
      const res = await request('/family/share', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${userToken}` },
        body: {
          documentId: journeyDocId,
          memberId: familyMemberId,
          permissionLevel: 'VIEW'
        }
      });
      assert.equal(res.status, 200);
    });

    it('Step 7: Configures and verifies App Lock PIN', async () => {
      const setRes = await request('/auth/app-lock', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${userToken}` },
        body: { enabled: true, pin: '4321', biometricEnabled: true }
      });
      assert.equal(setRes.status, 200);

      const verifyRes = await request('/auth/app-lock/verify', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${userToken}` },
        body: { pin: '4321' }
      });
      assert.equal(verifyRes.status, 200);
      assert.equal(verifyRes.data.valid, true);
    });

    it('Step 8: Exports complete encrypted cloud backup JSON', async () => {
      const res = await request('/backup/export', {
        headers: { 'Authorization': `Bearer ${userToken}` }
      });
      assert.equal(res.status, 200);
      assert.ok(res.data.documents);
      assert.ok(res.data.documents.length >= 1);
    });
  });

  describe('2. Document & Expiry Edge Cases & Internationalization', () => {
    it('Handles Arabic & Urdu internationalized document names and notes', async () => {
      const res = await request('/documents', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${userToken}` },
        body: {
          name: 'پاسپورٹ اور شناختی کارڈ - وثيقة الإقامة',
          documentTypeId: 'cat_identity',
          documentNumber: 'CNIC-35202-1234567-1',
          expiryDate: '2030-12-31',
          notes: 'یہ ایک اہم خاندانی دستاویز ہے - وثيقة رسمية معتمدة'
        }
      });
      assert.equal(res.status, 201);

      const getRes = await request(`/documents/${res.data.documentId}`, {
        headers: { 'Authorization': `Bearer ${userToken}` }
      });
      assert.equal(getRes.status, 200);
      assert.equal(getRes.data.document.name, 'پاسپورٹ اور شناختی کارڈ - وثيقة الإقامة');
      assert.match(getRes.data.document.notes, /دستاویز/);
    });

    it('Handles Japanese / Chinese characters and emojis', async () => {
      const res = await request('/documents', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${userToken}` },
        body: {
          name: '海外旅行保険証書 🏥 (Policy 2026-X)',
          documentTypeId: 'cat_insurance',
          expiryDate: '2029-08-15',
          notes: '家庭旅行保障カード • 緊急連絡先'
        }
      });
      assert.equal(res.status, 201);
    });

    it('Handles Leap Year dates accurately (2028-02-29)', async () => {
      const res = await request('/documents', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${userToken}` },
        body: {
          name: 'Leap Year Certificate',
          documentTypeId: 'cat_other',
          expiryDate: '2028-02-29'
        }
      });
      assert.equal(res.status, 201);

      const detailRes = await request(`/documents/${res.data.documentId}`, {
        headers: { 'Authorization': `Bearer ${userToken}` }
      });
      assert.equal(detailRes.status, 200);
      assert.equal(detailRes.data.document.expiry_date, '2028-02-29');
    });

    it('Rejects invalid date sequence (issue date strictly AFTER expiry date)', async () => {
      const res = await request('/documents', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${userToken}` },
        body: {
          name: 'Invalid Date Doc',
          documentTypeId: 'cat_identity',
          issueDate: '2030-01-01',
          expiryDate: '2025-01-01'
        }
      });
      assert.equal(res.status, 400);
      assert.match(res.data.error, /Issue date cannot be after expiry date/i);
    });

    it('Handles Lifetime / No-Expiry documents without reminder dates', async () => {
      const res = await request('/documents', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${userToken}` },
        body: {
          name: 'Birth Certificate Permanent',
          documentTypeId: 'cat_identity',
          hasNoExpiry: true
        }
      });
      assert.equal(res.status, 201);

      const detailRes = await request(`/documents/${res.data.documentId}`, {
        headers: { 'Authorization': `Bearer ${userToken}` }
      });
      assert.equal(detailRes.status, 200);
      assert.equal(Boolean(detailRes.data.document.has_no_expiry), true);
      assert.equal(detailRes.data.document.status, 'LIFETIME');
      assert.equal(detailRes.data.document.reminders.length, 0);
    });

    it('Handles far-future expiry date (2099-12-31) without integer overflow', () => {
      const metrics = calculateExpiryMetrics('2099-12-31', false, new Date('2026-08-23'));
      assert.equal(metrics.status, 'ACTIVE');
      assert.ok(metrics.daysRemaining > 20000);
    });
  });

  describe('3. High-Volume Batch & Query Performance Stress Test', () => {
    it('Batch creates 30 documents rapidly under load and verifies fast retrieval', async () => {
      const startTime = Date.now();
      const promises = [];

      for (let i = 1; i <= 30; i++) {
        promises.push(
          request('/documents', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${userToken}` },
            body: {
              name: `Stress Doc #${i}`,
              documentTypeId: 'cat_warranty',
              documentNumber: `WARR-${1000 + i}`,
              expiryDate: `2030-0${(i % 9) + 1}-15`
            }
          })
        );
      }

      const results = await Promise.all(promises);
      for (const r of results) {
        assert.equal(r.status, 201);
      }
      const creationDuration = Date.now() - startTime;
      assert.ok(creationDuration < 5000, `Batch creation took ${creationDuration}ms (expected < 5000ms)`);

      // Verify fast list retrieval
      const queryStart = Date.now();
      const listRes = await request('/documents?search=Stress&sortBy=expiry_asc', {
        headers: { 'Authorization': `Bearer ${userToken}` }
      });
      const queryDuration = Date.now() - queryStart;

      assert.equal(listRes.status, 200);
      assert.equal(listRes.data.documents.length, 30);
      assert.ok(queryDuration < 300, `Query response took ${queryDuration}ms (expected < 300ms)`);
    });
  });

  describe('4. Session & Authentication Hardening', () => {
    it('Rejects registration with malformed email', async () => {
      const res = await request('/auth/register', {
        method: 'POST',
        body: { email: 'notanemail', password: 'Pass123456!', fullName: 'Test' }
      });
      assert.equal(res.status, 400);
    });

    it('Rejects registration with short password (<6 chars)', async () => {
      const res = await request('/auth/register', {
        method: 'POST',
        body: { email: 'short.pass@vault.test', password: '123', fullName: 'Test' }
      });
      assert.equal(res.status, 400);
    });

    it('Rejects login with non-existent user email', async () => {
      const res = await request('/auth/login', {
        method: 'POST',
        body: { email: 'nonexistent.ghost@vault.test', password: 'Password123!' }
      });
      assert.equal(res.status, 401);
    });
  });
});
