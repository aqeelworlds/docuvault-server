import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import cors from 'cors';
import apiRouter from '../dist/routes/api.js';
import { initDatabase, dbGet, dbRun, dbAll } from '../dist/db/database.js';

const PORT = 5098;
const BASE_URL = `http://localhost:${PORT}/api`;

let server;
let userEmail = `reset.user.${Date.now()}@vault.local`;
let userPassword = 'InitialSecretPass123!';
let newPassword = 'NewStrongPassword456!';
let token = '';
let userId = '';
let generatedResetCode = '';

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

describe('PHASE 10: Password Reset Recovery & Shared Documents Test Suite', () => {
  before(async () => {
    await initDatabase();

    const app = express();
    app.use(cors());
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use('/api', apiRouter);

    server = app.listen(PORT);
  });

  after(() => {
    if (server) server.close();
  });

  describe('1. Password Reset Recovery Flow', () => {
    it('Registers a test user', async () => {
      const res = await request('/auth/register', {
        method: 'POST',
        body: {
          email: userEmail,
          password: userPassword,
          fullName: 'Reset Test User'
        }
      });
      assert.equal(res.status, 201);
      assert.ok(res.data.token);
      token = res.data.token;
      userId = res.data.user.id;
    });

    it('Rejects forgot-password with non-existent email', async () => {
      const res = await request('/auth/forgot-password', {
        method: 'POST',
        body: { email: 'nonexistent.user.xyz@vault.local' }
      });
      assert.equal(res.status, 404);
    });

    it('Generates 6-digit reset code for valid email', async () => {
      const res = await request('/auth/forgot-password', {
        method: 'POST',
        body: { email: userEmail }
      });
      assert.equal(res.status, 200);
      assert.ok(res.data.resetCode);
      assert.equal(res.data.resetCode.length, 6);
      generatedResetCode = res.data.resetCode;

      // Verify stored in DB
      const resetRecord = await dbGet(
        'SELECT * FROM password_resets WHERE email = ? AND reset_code = ? AND used = 0',
        [userEmail.toLowerCase(), generatedResetCode]
      );
      assert.ok(resetRecord);
    });

    it('Verifies reset code successfully', async () => {
      const res = await request('/auth/verify-reset-code', {
        method: 'POST',
        body: { email: userEmail, resetCode: generatedResetCode }
      });
      assert.equal(res.status, 200);
      assert.equal(res.data.valid, true);
    });

    it('Rejects invalid reset code', async () => {
      const res = await request('/auth/verify-reset-code', {
        method: 'POST',
        body: { email: userEmail, resetCode: '999999' }
      });
      assert.equal(res.status, 400);
    });

    it('Resets password with valid code and new password', async () => {
      const res = await request('/auth/reset-password', {
        method: 'POST',
        body: {
          email: userEmail,
          resetCode: generatedResetCode,
          newPassword: newPassword
        }
      });
      assert.equal(res.status, 200);
      assert.ok(res.data.message.includes('successful'));

      // Verify code is now marked used
      const resetRecord = await dbGet(
        'SELECT * FROM password_resets WHERE email = ? AND reset_code = ?',
        [userEmail.toLowerCase(), generatedResetCode]
      );
      assert.equal(resetRecord.used, 1);
    });

    it('Rejects login with old password', async () => {
      const res = await request('/auth/login', {
        method: 'POST',
        body: { email: userEmail, password: userPassword }
      });
      assert.equal(res.status, 401);
    });

    it('Successfully logs in with new password', async () => {
      const res = await request('/auth/login', {
        method: 'POST',
        body: { email: userEmail, password: newPassword }
      });
      assert.equal(res.status, 200);
      assert.ok(res.data.token);
      token = res.data.token;
    });
  });

  describe('2. Shared Documents Query & Permissions Visibility', () => {
    let docId = '';
    let memberId = '';

    it('Upgrades user to Pro and creates document + family member', async () => {
      // Upgrade to pro
      const upRes = await request('/subscriptions/upgrade', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: { planId: 'PRO_MONTHLY' }
      });
      assert.equal(upRes.status, 200);

      // Get category id
      const cat = await dbGet('SELECT id FROM document_types LIMIT 1');
      assert.ok(cat);

      // Create document
      const docRes = await request('/documents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: {
          name: 'Family Shared Health Insurance',
          document_type_id: cat.id,
          expiry_date: '2029-12-31'
        }
      });
      assert.equal(docRes.status, 201);
      docId = docRes.data.documentId;

      // Add family member
      const memberRes = await request('/family/members', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: {
          name: 'Sarah User',
          email: `sarah.${Date.now()}@vault.local`,
          relationship: 'Spouse',
          role: 'MEMBER'
        }
      });
      assert.equal(memberRes.status, 201);
      memberId = memberRes.data.memberId;
    });

    it('Shares document and verifies sharedPermissions in GET /family', async () => {
      // Share doc
      const shareRes = await request('/family/share', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: {
          documentId: docId,
          memberId: memberId,
          permissionLevel: 'EDIT'
        }
      });
      assert.equal(shareRes.status, 200);

      // Query family
      const famRes = await request('/family', {
        headers: { Authorization: `Bearer ${token}` }
      });
      assert.equal(famRes.status, 200);
      assert.ok(Array.isArray(famRes.data.sharedPermissions));
      assert.equal(famRes.data.sharedPermissions.length, 1);

      const sp = famRes.data.sharedPermissions[0];
      assert.equal(sp.document_id, docId);
      assert.equal(sp.document_name, 'Family Shared Health Insurance');
      assert.equal(sp.permission_level, 'EDIT');
      assert.equal(sp.shared_with_name, 'Sarah User');
      assert.equal(sp.shared_with_relationship, 'Spouse');
      assert.equal(sp.isSharedByMe, true);
    });

    it('Updates permission level from EDIT to VIEW', async () => {
      const shareRes = await request('/family/share', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: {
          documentId: docId,
          memberId: memberId,
          permissionLevel: 'VIEW'
        }
      });
      assert.equal(shareRes.status, 200);

      const famRes = await request('/family', {
        headers: { Authorization: `Bearer ${token}` }
      });
      assert.equal(famRes.data.sharedPermissions[0].permission_level, 'VIEW');
    });

    it('Unshares document and verifies removal from sharedPermissions', async () => {
      const unshareRes = await request('/family/unshare', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: {
          documentId: docId,
          memberId: memberId
        }
      });
      assert.equal(unshareRes.status, 200);

      const famRes = await request('/family', {
        headers: { Authorization: `Bearer ${token}` }
      });
      assert.equal(famRes.data.sharedPermissions.length, 0);
    });
  });
});
