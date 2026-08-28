import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import apiRouter from '../dist/routes/api.js';
import { initDatabase, dbRun, dbGet, dbAll } from '../dist/db/database.js';
import { calculateExpiryMetrics, differenceInCalendarDays, generateReminderDates } from '../dist/services/expiryService.js';

const PORT = 5088;
const BASE_URL = `http://localhost:${PORT}/api`;

let server;
let userAToken;
let userAId;
let userBToken;
let userBId;
let testDocId;

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

describe('PHASE 2: Core Document Management Test Suite', () => {
  before(async () => {
    await initDatabase();

    const app = express();
    app.use(cors());
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use('/api', apiRouter);

    server = app.listen(PORT);

    // Register User A
    const resA = await request('/auth/register', {
      method: 'POST',
      body: {
        email: `phase2_user_a_${Date.now()}@vault.local`,
        password: 'Password123!',
        fullName: 'User A Primary'
      }
    });
    assert.equal(resA.status, 201);
    userAToken = resA.data.token;
    userAId = resA.data.user.id;

    // Register User B
    const resB = await request('/auth/register', {
      method: 'POST',
      body: {
        email: `phase2_user_b_${Date.now()}@vault.local`,
        password: 'Password123!',
        fullName: 'User B Secondary'
      }
    });
    assert.equal(resB.status, 201);
    userBToken = resB.data.token;
    userBId = resB.data.user.id;
  });

  after(() => {
    if (server) server.close();
  });

  // 1. Deterministic Expiry Calculations across exact boundaries
  describe('1. Deterministic Expiry Boundary Calculations (Zero AI)', () => {
    const fixedNow = new Date('2026-06-01T00:00:00Z');

    it('Calculates 90 days remaining as ACTIVE', () => {
      const res = calculateExpiryMetrics('2026-08-30', false, fixedNow);
      assert.equal(res.status, 'ACTIVE');
      assert.equal(res.daysRemaining, 90);
    });

    it('Calculates 31 days remaining as ACTIVE boundary', () => {
      const res = calculateExpiryMetrics('2026-07-02', false, fixedNow);
      assert.equal(res.status, 'ACTIVE');
      assert.equal(res.daysRemaining, 31);
    });

    it('Calculates 30 days remaining as EXPIRING_SOON boundary', () => {
      const res = calculateExpiryMetrics('2026-07-01', false, fixedNow);
      assert.equal(res.status, 'EXPIRING_SOON');
      assert.equal(res.daysRemaining, 30);
    });

    it('Calculates 14 days remaining as EXPIRING_SOON', () => {
      const res = calculateExpiryMetrics('2026-06-15', false, fixedNow);
      assert.equal(res.status, 'EXPIRING_SOON');
      assert.equal(res.daysRemaining, 14);
    });

    it('Calculates 7 days remaining as EXPIRING_SOON', () => {
      const res = calculateExpiryMetrics('2026-06-08', false, fixedNow);
      assert.equal(res.status, 'EXPIRING_SOON');
      assert.equal(res.daysRemaining, 7);
    });

    it('Calculates 1 day remaining as EXPIRING_SOON (Expires tomorrow)', () => {
      const res = calculateExpiryMetrics('2026-06-02', false, fixedNow);
      assert.equal(res.status, 'EXPIRING_SOON');
      assert.equal(res.daysRemaining, 1);
      assert.equal(res.formattedRemaining, 'Expires tomorrow');
    });

    it('Calculates 0 days remaining as EXPIRING_SOON (Expires today)', () => {
      const res = calculateExpiryMetrics('2026-06-01', false, fixedNow);
      assert.equal(res.status, 'EXPIRING_SOON');
      assert.equal(res.daysRemaining, 0);
      assert.equal(res.formattedRemaining, 'Expires today');
    });

    it('Calculates -1 day remaining as EXPIRED (Expired yesterday)', () => {
      const res = calculateExpiryMetrics('2026-05-31', false, fixedNow);
      assert.equal(res.status, 'EXPIRED');
      assert.equal(res.daysRemaining, -1);
      assert.equal(res.formattedRemaining, 'Expired yesterday');
    });

    it('Calculates -15 days remaining as EXPIRED (Expired 15 days ago)', () => {
      const res = calculateExpiryMetrics('2026-05-17', false, fixedNow);
      assert.equal(res.status, 'EXPIRED');
      assert.equal(res.daysRemaining, -15);
      assert.equal(res.formattedRemaining, 'Expired 15 days ago');
    });

    it('Handles Leap Year boundaries correctly (Feb 29 -> March 1)', () => {
      const leapNow = new Date('2028-02-28T00:00:00Z');
      const leap29 = calculateExpiryMetrics('2028-02-29', false, leapNow);
      assert.equal(leap29.daysRemaining, 1);
      const march1 = calculateExpiryMetrics('2028-03-01', false, leapNow);
      assert.equal(march1.daysRemaining, 2);
    });
  });

  // 2. Input Validation & Date Range Checks
  describe('2. Input Validation & Date Range Safeguards', () => {
    it('Rejects document creation when name is empty', async () => {
      const res = await request('/documents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${userAToken}` },
        body: { name: '', documentTypeId: 'cat_identity', expiryDate: '2028-01-01' }
      });
      assert.equal(res.status, 400);
      assert.ok(res.data.error.includes('name is required'));
    });

    it('Rejects document creation when name exceeds 150 characters', async () => {
      const longName = 'A'.repeat(151);
      const res = await request('/documents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${userAToken}` },
        body: { name: longName, documentTypeId: 'cat_identity', expiryDate: '2028-01-01' }
      });
      assert.equal(res.status, 400);
      assert.ok(res.data.error.includes('cannot exceed 150 characters'));
    });

    it('Rejects document creation when issueDate is after expiryDate', async () => {
      const res = await request('/documents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${userAToken}` },
        body: {
          name: 'Invalid Date Document',
          documentTypeId: 'cat_identity',
          issueDate: '2028-05-01',
          expiryDate: '2027-05-01' // Before issue date!
        }
      });
      assert.equal(res.status, 400);
      assert.equal(res.data.code, 'INVALID_DATE_RANGE');
      assert.equal(res.data.error, 'Issue date cannot be after expiry date');
    });

    it('Successfully creates valid document with correct dates and reminders', async () => {
      const res = await request('/documents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${userAToken}` },
        body: {
          name: 'National Identity Card',
          documentTypeId: 'cat_identity',
          documentNumber: 'CNIC-99281-01',
          issueDate: '2022-01-10',
          expiryDate: '2032-01-10',
          issuingAuthority: 'National Database and Registration Authority',
          notes: 'Primary biometric citizenship card',
          reminders: [90, 60, 30, 14, 7, 1]
        }
      });
      assert.equal(res.status, 201);
      assert.ok(res.data.documentId);
      testDocId = res.data.documentId;
    });
  });

  // 3. Search, Filter & Deterministic Sorting
  describe('3. Real Database Search, Filters & Sorting', () => {
    before(async () => {
      // Add second document for search & sort testing
      await request('/documents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${userAToken}` },
        body: {
          name: 'Automobile Driver License',
          documentTypeId: 'cat_driving',
          documentNumber: 'DL-8821903',
          issueDate: '2021-03-15',
          expiryDate: '2026-09-15',
          issuingAuthority: 'Department of Motor Vehicles',
          notes: 'Motor vehicle operating permit'
        }
      });
    });

    it('Searches document by name', async () => {
      const res = await request('/documents?search=National', {
        headers: { Authorization: `Bearer ${userAToken}` }
      });
      assert.equal(res.status, 200);
      assert.equal(res.data.documents.length, 1);
      assert.equal(res.data.documents[0].name, 'National Identity Card');
    });

    it('Searches document by document number', async () => {
      const res = await request('/documents?search=CNIC-99281', {
        headers: { Authorization: `Bearer ${userAToken}` }
      });
      assert.equal(res.status, 200);
      assert.equal(res.data.documents.length, 1);
      assert.equal(res.data.documents[0].document_number, 'CNIC-99281-01');
    });

    it('Searches document by issuing authority', async () => {
      const res = await request('/documents?search=Motor Vehicles', {
        headers: { Authorization: `Bearer ${userAToken}` }
      });
      assert.equal(res.status, 200);
      assert.equal(res.data.documents.length, 1);
      assert.equal(res.data.documents[0].name, 'Automobile Driver License');
    });

    it('Filters documents by category', async () => {
      const res = await request('/documents?category=cat_driving', {
        headers: { Authorization: `Bearer ${userAToken}` }
      });
      assert.equal(res.status, 200);
      assert.equal(res.data.documents.length, 1);
      assert.equal(res.data.documents[0].document_type_id, 'cat_driving');
    });

    it('Sorts documents alphabetically (name_asc)', async () => {
      const res = await request('/documents?sortBy=name_asc', {
        headers: { Authorization: `Bearer ${userAToken}` }
      });
      assert.equal(res.status, 200);
      assert.equal(res.data.documents[0].name, 'Automobile Driver License');
      assert.equal(res.data.documents[1].name, 'National Identity Card');
    });

    it('Sorts documents by expiry date ascending (expiry_asc)', async () => {
      const res = await request('/documents?sortBy=expiry_asc', {
        headers: { Authorization: `Bearer ${userAToken}` }
      });
      assert.equal(res.status, 200);
      assert.equal(res.data.documents[0].name, 'Automobile Driver License'); // 2026 before 2032
      assert.equal(res.data.documents[1].name, 'National Identity Card');
    });
  });

  // 4. Archive & Unarchive Lifecycle
  describe('4. Document Archive & Unarchive Workflow', () => {
    it('Archives an active document', async () => {
      const res = await request(`/documents/${testDocId}/archive`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${userAToken}` }
      });
      assert.equal(res.status, 200);
      assert.equal(res.data.message, 'Document archived successfully');
    });

    it('Excludes archived documents from default active document list', async () => {
      const res = await request('/documents', {
        headers: { Authorization: `Bearer ${userAToken}` }
      });
      assert.equal(res.status, 200);
      const containsArchived = res.data.documents.some(d => d.id === testDocId);
      assert.equal(containsArchived, false);
      assert.equal(res.data.summary.archived, 1);
    });

    it('Returns archived document when status=archived filter is requested', async () => {
      const res = await request('/documents?status=archived', {
        headers: { Authorization: `Bearer ${userAToken}` }
      });
      assert.equal(res.status, 200);
      assert.equal(res.data.documents.length, 1);
      assert.equal(res.data.documents[0].id, testDocId);
      assert.equal(res.data.documents[0].is_archived, true);
    });

    it('Unarchives document restoring it to active vault list', async () => {
      const res = await request(`/documents/${testDocId}/unarchive`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${userAToken}` }
      });
      assert.equal(res.status, 200);
      assert.equal(res.data.message, 'Document unarchived successfully');

      const activeList = await request('/documents', {
        headers: { Authorization: `Bearer ${userAToken}` }
      });
      assert.equal(activeList.status, 200);
      const containsDoc = activeList.data.documents.some(d => d.id === testDocId);
      assert.equal(containsDoc, true);
    });
  });

  // 5. Document Renewal & Timeline History
  describe('5. Document Renewal with Immutable Audit Timeline', () => {
    it('Renews document with new expiry date and notes', async () => {
      const res = await request(`/documents/${testDocId}/renew`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${userAToken}` },
        body: {
          newIssueDate: '2032-01-10',
          newExpiryDate: '2042-01-10',
          newDocumentNumber: 'CNIC-99281-01-REV2',
          renewalNotes: '10-year citizenship renewal approved'
        }
      });
      assert.equal(res.status, 200);
      assert.equal(res.data.newExpiryDate, '2042-01-10');
    });

    it('Verifies renewal history record in document details', async () => {
      const res = await request(`/documents/${testDocId}`, {
        headers: { Authorization: `Bearer ${userAToken}` }
      });
      assert.equal(res.status, 200);
      assert.equal(res.data.document.expiry_date, '2042-01-10');
      assert.equal(res.data.document.document_number, 'CNIC-99281-01-REV2');
      assert.equal(res.data.document.renewalHistory.length, 1);
      assert.equal(res.data.document.renewalHistory[0].previous_expiry_date, '2032-01-10');
      assert.equal(res.data.document.renewalHistory[0].new_expiry_date, '2042-01-10');
      assert.equal(res.data.document.renewalHistory[0].renewal_notes, '10-year citizenship renewal approved');
    });
  });

  // 6. Security Isolation & Cascading Deletion
  describe('6. Security Isolation & Cascading Deletion', () => {
    it('User B CANNOT delete User A document (403 Forbidden)', async () => {
      const res = await request(`/documents/${testDocId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${userBToken}` }
      });
      assert.equal(res.status, 403);
    });

    it('User A successfully deletes their document and cascades reminders', async () => {
      const res = await request(`/documents/${testDocId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${userAToken}` }
      });
      assert.equal(res.status, 200);

      // Verify document no longer exists
      const checkDoc = await dbGet('SELECT id FROM documents WHERE id = ?', [testDocId]);
      assert.ok(!checkDoc);

      // Verify reminders cascaded
      const checkRem = await dbAll('SELECT id FROM reminders WHERE document_id = ?', [testDocId]);
      assert.equal(checkRem.length, 0);

      // Verify renewal history cascaded
      const checkHist = await dbAll('SELECT id FROM renewal_history WHERE document_id = ?', [testDocId]);
      assert.equal(checkHist.length, 0);
    });
  });
});
