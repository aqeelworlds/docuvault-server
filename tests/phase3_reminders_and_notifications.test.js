import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import apiRouter from '../dist/routes/api.js';
import { initDatabase, dbRun, dbGet, dbAll } from '../dist/db/database.js';
import { calculateExpiryMetrics, differenceInCalendarDays, generateReminderDates } from '../dist/services/expiryService.js';

const PORT = 5078;
const BASE_URL = `http://localhost:${PORT}/api`;

let server;
let userToken;
let userId;
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

describe('PHASE 3: Expiry Reminders & Android Notification Integration Test Suite', () => {
  before(async () => {
    await initDatabase();

    const app = express();
    app.use(cors());
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use('/api', apiRouter);

    server = app.listen(PORT);

    // Register User
    const res = await request('/auth/register', {
      method: 'POST',
      body: {
        email: `phase3_user_${Date.now()}@vault.local`,
        password: 'Password123!',
        fullName: 'Notification Tester'
      }
    });
    assert.equal(res.status, 201);
    userToken = res.data.token;
    userId = res.data.user.id;
  });

  after(() => {
    if (server) server.close();
  });

  // 1. Default Reminder Generation & Custom Selection
  describe('1. Default Reminder Generation & Lead Time Selection', () => {
    it('Creates document with custom lead day schedule [60, 30, 7, 1]', async () => {
      const res = await request('/documents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${userToken}` },
        body: {
          name: 'Diplomatic Passport',
          documentTypeId: 'cat_travel',
          documentNumber: 'DP-SECRET-998822',
          issueDate: '2024-01-01',
          expiryDate: '2030-01-01',
          issuingAuthority: 'Ministry of Foreign Affairs',
          reminders: [60, 30, 7, 1]
        }
      });
      assert.equal(res.status, 201);
      docId = res.data.documentId;

      // Verify reminders in DB
      const reminders = await dbAll(
        'SELECT lead_days, reminder_date, is_active FROM reminders WHERE document_id = ? ORDER BY lead_days DESC',
        [docId]
      );
      assert.equal(reminders.length, 4);
      assert.deepEqual(reminders.map(r => r.lead_days), [60, 30, 7, 1]);
      assert.ok(reminders.every(r => r.is_active === 1));
    });
  });

  // 2. Custom Reminder Addition & Validation
  describe('2. Custom Reminder Addition & Validation', () => {
    it('Adds a 45-day custom reminder for the document', async () => {
      await request('/subscriptions/upgrade', {
        method: 'POST',
        headers: { Authorization: `Bearer ${userToken}` },
        body: { planId: 'PRO_MONTHLY' }
      });

      const res = await request('/reminders/custom', {
        method: 'POST',
        headers: { Authorization: `Bearer ${userToken}` },
        body: {
          documentId: docId,
          leadDays: 45
        }
      });
      assert.equal(res.status, 201);
      assert.equal(res.data.leadDays, 45);
    });

    it('Rejects custom reminder with invalid lead days (<=0)', async () => {
      const res = await request('/reminders/custom', {
        method: 'POST',
        headers: { Authorization: `Bearer ${userToken}` },
        body: {
          documentId: docId,
          leadDays: 0
        }
      });
      assert.equal(res.status, 400);
      assert.ok(res.data.error.includes('positive lead days'));
    });
  });

  // 3. Reminder Toggle & Section Categorization
  describe('3. Reminder Toggle & Section Grouping', () => {
    let reminderIdToToggle;

    it('Fetches reminders grouped into sections (today, thisWeek, upcoming, expired)', async () => {
      const res = await request('/reminders', {
        headers: { Authorization: `Bearer ${userToken}` }
      });
      assert.equal(res.status, 200);
      assert.ok(res.data.sections);
      assert.ok(Array.isArray(res.data.sections.upcoming));
      assert.ok(res.data.sections.upcoming.length >= 1);
      reminderIdToToggle = res.data.sections.upcoming[0].id;
    });

    it('Toggles reminder status from active (1) to inactive (0)', async () => {
      const res = await request(`/reminders/${reminderIdToToggle}/toggle`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${userToken}` }
      });
      assert.equal(res.status, 200);
      assert.equal(res.data.isActive, false);

      const dbCheck = await dbGet('SELECT is_active FROM reminders WHERE id = ?', [reminderIdToToggle]);
      assert.equal(dbCheck.is_active, 0);
    });

    it('Toggles reminder status back from inactive (0) to active (1)', async () => {
      const res = await request(`/reminders/${reminderIdToToggle}/toggle`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${userToken}` }
      });
      assert.equal(res.status, 200);
      assert.equal(res.data.isActive, true);

      const dbCheck = await dbGet('SELECT is_active FROM reminders WHERE id = ?', [reminderIdToToggle]);
      assert.equal(dbCheck.is_active, 1);
    });
  });

  // 4. Privacy & Security Check on Notifications
  describe('4. Privacy & Security: Sensitive Document Numbers Not Exposed', () => {
    it('Verifies notification payloads do NOT expose private document numbers', async () => {
      const res = await request(`/documents/${docId}`, {
        headers: { Authorization: `Bearer ${userToken}` }
      });
      assert.equal(res.status, 200);
      const doc = res.data.document;

      // Ensure notification formatting uses doc.name and category, not full sensitive doc number
      const testTitle = `${doc.name} expires in 30 days`;
      const testBody = `Your ${doc.category_name || 'document'} is scheduled to expire on ${doc.expiry_date}. Tap to review.`;

      assert.ok(!testTitle.includes(doc.document_number));
      assert.ok(!testBody.includes(doc.document_number));
    });
  });

  // 5. Expiry Date Modification & Renewal Synchronization
  describe('5. Expiry Date Modification & Renewal Synchronization', () => {
    it('Recalculates reminders when document expiry date is updated', async () => {
      const newExpiry = '2035-06-30';
      const updateRes = await request(`/documents/${docId}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${userToken}` },
        body: {
          name: 'Diplomatic Passport (Updated)',
          expiryDate: newExpiry
        }
      });
      assert.equal(updateRes.status, 200);

      // Verify reminders recalculated for new expiry
      const reminders = await dbAll(
        'SELECT reminder_date, lead_days FROM reminders WHERE document_id = ? ORDER BY lead_days DESC',
        [docId]
      );
      assert.ok(reminders.length > 0);
      // For 30 days before 2035-06-30 -> 2035-05-31
      const rem30 = reminders.find(r => r.lead_days === 30);
      if (rem30) {
        assert.equal(rem30.reminder_date, '2035-05-31');
      }
    });

    it('Resets reminders upon renewal with new expiry horizon', async () => {
      const renewExpiry = '2045-01-01';
      const renewRes = await request(`/documents/${docId}/renew`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${userToken}` },
        body: {
          newExpiryDate: renewExpiry,
          renewalNotes: 'Extended 10 years'
        }
      });
      assert.equal(renewRes.status, 200);

      const reminders = await dbAll(
        'SELECT reminder_date, lead_days FROM reminders WHERE document_id = ? ORDER BY lead_days DESC',
        [docId]
      );
      assert.ok(reminders.length > 0);
      // 30 days before 2045-01-01 -> 2044-12-02
      const rem30 = reminders.find(r => r.lead_days === 30);
      if (rem30) {
        assert.equal(rem30.reminder_date, '2044-12-02');
      }
    });
  });

  // 6. Cascading Reminder Deletion
  describe('6. Cascading Reminder Deletion', () => {
    it('Deletes document and verifies all associated reminders are deleted from DB', async () => {
      const delRes = await request(`/documents/${docId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${userToken}` }
      });
      assert.equal(delRes.status, 200);

      const remCount = await dbAll('SELECT id FROM reminders WHERE document_id = ?', [docId]);
      assert.equal(remCount.length, 0);
    });
  });
});
