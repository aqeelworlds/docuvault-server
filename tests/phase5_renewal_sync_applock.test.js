import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import apiRouter from '../dist/routes/api.js';
import { initDatabase, dbRun, dbGet, dbAll } from '../dist/db/database.js';

const PORT = 5110;
const BASE_URL = `http://localhost:${PORT}/api`;

let server;
let userToken, userId, userEmail;
let docId;

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

describe('PHASE 5: Document Renewal History, Cloud Backup/Sync & App Lock Test Suite', () => {
  before(async () => {
    await initDatabase();

    const app = express();
    app.use(cors());
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use('/api', apiRouter);

    server = app.listen(PORT);

    // Register User
    userEmail = `phase5_user_${Date.now()}@vault.local`;
    const res = await request('/auth/register', {
      method: 'POST',
      body: {
        email: userEmail,
        password: 'Password123!',
        fullName: 'Renewal & Security Tester'
      }
    });
    assert.equal(res.status, 201);
    userToken = res.data.token;
    userId = res.data.user.id;
  });

  after(() => {
    if (server) server.close();
  });

  // 1. Initial Expired Document Setup
  describe('1. Expired Document Setup', () => {
    it('Creates an expired driver license document (Expired 10 days ago)', async () => {
      const pastDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const res = await request('/documents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${userToken}` },
        body: {
          name: 'Commercial Driver License',
          documentTypeId: 'cat_driving',
          documentNumber: 'DL-OLD-112233',
          issueDate: '2019-01-01',
          expiryDate: pastDate,
          issuingAuthority: 'Highway Safety Department'
        }
      });
      assert.equal(res.status, 201);
      docId = res.data.documentId;

      // Verify status is EXPIRED
      const docRes = await request(`/documents/${docId}`, {
        headers: { Authorization: `Bearer ${userToken}` }
      });
      assert.equal(docRes.status, 200);
      assert.equal(docRes.data.document.status, 'EXPIRED');
    });
  });

  // 2. Real Renewal Workflow & Date Range Guard
  describe('2. Real Renewal Workflow & Date Range Guard', () => {
    it('Rejects renewal when new issue date is after new expiry date (400)', async () => {
      const res = await request(`/documents/${docId}/renew`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${userToken}` },
        body: {
          newIssueDate: '2030-01-01',
          newExpiryDate: '2028-01-01',
          newDocumentNumber: 'DL-NEW-998877'
        }
      });
      assert.equal(res.status, 400);
      assert.equal(res.data.code, 'INVALID_DATE_RANGE');
    });

    it('Successfully renews document with new dates, new number and renewal notes', async () => {
      const res = await request(`/documents/${docId}/renew`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${userToken}` },
        body: {
          newIssueDate: '2026-08-01',
          newExpiryDate: '2036-08-01',
          newDocumentNumber: 'DL-NEW-998877',
          issuingAuthority: 'Highway Safety Department (HQ)',
          renewalNotes: '10-year commercial renewal with biometric verification'
        }
      });
      assert.equal(res.status, 200);
      assert.equal(res.data.newExpiryDate, '2036-08-01');
    });

    it('Verifies document status transitioned from EXPIRED to ACTIVE', async () => {
      const docRes = await request(`/documents/${docId}`, {
        headers: { Authorization: `Bearer ${userToken}` }
      });
      assert.equal(docRes.status, 200);
      const doc = docRes.data.document;
      assert.equal(doc.status, 'ACTIVE');
      assert.equal(doc.document_number, 'DL-NEW-998877');
      assert.equal(doc.issuing_authority, 'Highway Safety Department (HQ)');
    });
  });

  // 3. Renewal History & Activity Audit Trail
  describe('3. Immutable Renewal History & Activity Audit Trail', () => {
    it('Verifies immutable renewal history log in database and document details', async () => {
      const docRes = await request(`/documents/${docId}`, {
        headers: { Authorization: `Bearer ${userToken}` }
      });
      assert.equal(docRes.status, 200);
      const history = docRes.data.document.renewalHistory;
      assert.ok(Array.isArray(history));
      assert.ok(history.length >= 1);
      const latest = history[0];
      assert.equal(latest.new_expiry_date, '2036-08-01');
      assert.equal(latest.previous_doc_number, 'DL-OLD-112233');
      assert.equal(latest.new_doc_number, 'DL-NEW-998877');
      assert.equal(latest.renewal_notes, '10-year commercial renewal with biometric verification');
    });

    it('Verifies activity history records RENEWED event', async () => {
      const docRes = await request(`/documents/${docId}`, {
        headers: { Authorization: `Bearer ${userToken}` }
      });
      assert.equal(docRes.status, 200);
      const activity = docRes.data.document.activity;
      assert.ok(Array.isArray(activity));
      const renewedEvent = activity.find(a => a.action_type === 'RENEWED');
      assert.ok(renewedEvent);
    });

    it('Verifies reminders were recalculated for the new 2036 expiry date', async () => {
      const reminders = await dbAll(
        'SELECT lead_days, reminder_date FROM reminders WHERE document_id = ? ORDER BY lead_days DESC',
        [docId]
      );
      assert.ok(reminders.length > 0);
      const rem30 = reminders.find(r => r.lead_days === 30);
      if (rem30) {
        assert.equal(rem30.reminder_date, '2036-07-02');
      }
    });
  });

  // 4. Cloud Vault Backup & Data Export
  describe('4. Secure Cloud Backup & Vault Data Export', () => {
    it('Exports complete vault backup JSON containing documents, renewals, and categories', async () => {
      await request('/subscriptions/upgrade', {
        method: 'POST',
        headers: { Authorization: `Bearer ${userToken}` },
        body: { planId: 'PRO_MONTHLY' }
      });

      const res = await request('/backup/export', {
        headers: { Authorization: `Bearer ${userToken}` }
      });
      assert.equal(res.status, 200);
      assert.ok(res.data.exportedAt);
      assert.ok(Array.isArray(res.data.documents));
      assert.ok(res.data.documents.some(d => d.id === docId));
      assert.ok(Array.isArray(res.data.renewalHistory));
    });
  });

  // 5. App Lock PIN Security & Hashing
  describe('5. App Lock PIN Security & Salted Hashing', () => {
    it('Configures a 4-digit PIN for App Lock', async () => {
      const res = await request('/auth/app-lock/setup', {
        method: 'POST',
        headers: { Authorization: `Bearer ${userToken}` },
        body: {
          enabled: true,
          pin: '4829',
          biometricEnabled: true
        }
      });
      assert.equal(res.status, 200);
      assert.equal(res.data.appLockEnabled, true);
    });

    it('Verifies correct PIN successfully unlocks vault', async () => {
      const res = await request('/auth/app-lock/verify', {
        method: 'POST',
        headers: { Authorization: `Bearer ${userToken}` },
        body: { pin: '4829' }
      });
      assert.equal(res.status, 200);
      assert.equal(res.data.valid, true);
    });

    it('Rejects incorrect PIN with 401 and valid: false', async () => {
      const res = await request('/auth/app-lock/verify', {
        method: 'POST',
        headers: { Authorization: `Bearer ${userToken}` },
        body: { pin: '0000' }
      });
      assert.equal(res.status, 401);
      assert.equal(res.data.valid, false);
    });

    it('CRITICAL SECURITY: Raw PIN is NEVER stored in plaintext in the database', async () => {
      const profile = await dbGet(
        'SELECT app_lock_pin_hash FROM profiles WHERE user_id = ?',
        [userId]
      );
      assert.ok(profile.app_lock_pin_hash);
      assert.notEqual(profile.app_lock_pin_hash, '4829');
      assert.equal(profile.app_lock_pin_hash.length, 64); // SHA-256 hex string length
    });
  });

  // 6. Account Deletion & Permanent Vault Wipe
  describe('6. Account Deletion & Vault Data Wipe', () => {
    it('Permanently deletes account and wipes all user data and documents', async () => {
      const res = await request('/auth/account', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${userToken}` }
      });
      assert.equal(res.status, 200);

      // Verify user does not exist
      const userCheck = await dbGet('SELECT id FROM users WHERE id = ?', [userId]);
      assert.ok(!userCheck);

      // Verify documents deleted
      const docCheck = await dbGet('SELECT id FROM documents WHERE user_id = ?', [userId]);
      assert.ok(!docCheck);

      // Verify reminders deleted
      const remCheck = await dbGet('SELECT id FROM reminders WHERE user_id = ?', [userId]);
      assert.ok(!remCheck);
    });
  });
});
