import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import apiRouter from '../dist/routes/api.js';
import { initDatabase, dbRun, dbGet, dbAll } from '../dist/db/database.js';

const PORT = 5124;
const BASE_URL = `http://localhost:${PORT}/api`;

let server;
let userA_Token, userA_Id, userA_Email, userA_MemberId;
let userB_Token, userB_Id, userB_Email, userB_MemberId;
let docA_Id;

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

describe('PHASE 8: Security, Privacy & Data Protection Audit Test Suite', () => {
  before(async () => {
    await initDatabase();

    const app = express();
    app.use(cors());
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use('/api', apiRouter);

    server = app.listen(PORT);

    // Register User A
    userA_Email = `sec_userA_${Date.now()}@vault.local`;
    const resA = await request('/auth/register', {
      method: 'POST',
      body: {
        email: userA_Email,
        password: 'UserASecretPass123!',
        fullName: 'Alice Security Audit'
      }
    });
    assert.equal(resA.status, 201);
    userA_Token = resA.data.token;
    userA_Id = resA.data.user.id;
    userA_MemberId = resA.data.user.familyMemberId;

    // Register User B
    userB_Email = `sec_userB_${Date.now()}@vault.local`;
    const resB = await request('/auth/register', {
      method: 'POST',
      body: {
        email: userB_Email,
        password: 'UserBSecretPass123!',
        fullName: 'Bob Hacker Isolation'
      }
    });
    assert.equal(resB.status, 201);
    userB_Token = resB.data.token;
    userB_Id = resB.data.user.id;
    userB_MemberId = resB.data.user.familyMemberId;
  });

  after(() => {
    server?.close();
  });

  describe('1. Unauthenticated Endpoint Access Rejection', () => {
    it('Blocks unauthenticated GET /documents with 401', async () => {
      const res = await request('/documents');
      assert.equal(res.status, 401);
      assert.equal(res.data.code, 'AUTH_TOKEN_MISSING');
    });

    it('Blocks unauthenticated GET /reminders with 401', async () => {
      const res = await request('/reminders');
      assert.equal(res.status, 401);
      assert.equal(res.data.code, 'AUTH_TOKEN_MISSING');
    });

    it('Blocks unauthenticated GET /family with 401', async () => {
      const res = await request('/family');
      assert.equal(res.status, 401);
      assert.equal(res.data.code, 'AUTH_TOKEN_MISSING');
    });

    it('Blocks unauthenticated GET /subscriptions with 401', async () => {
      const res = await request('/subscriptions');
      assert.equal(res.status, 401);
      assert.equal(res.data.code, 'AUTH_TOKEN_MISSING');
    });

    it('Blocks unauthenticated GET /backup/export with 401', async () => {
      const res = await request('/backup/export');
      assert.equal(res.status, 401);
      assert.equal(res.data.code, 'AUTH_TOKEN_MISSING');
    });

    it('Blocks invalid/forged Bearer token with 401', async () => {
      const res = await request('/documents', {
        headers: { 'Authorization': 'Bearer forged.malicious.token' }
      });
      assert.equal(res.status, 401);
      assert.equal(res.data.code, 'TOKEN_INVALID');
    });
  });

  describe('2. User Data Isolation & Strict IDOR Prevention', () => {
    it('User A creates confidential document', async () => {
      const res = await request('/documents', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${userA_Token}` },
        body: {
          name: 'Alice Top Secret Passport',
          documentTypeId: 'passport',
          documentNumber: 'PA-99887766',
          issueDate: '2022-01-01',
          expiryDate: '2032-01-01',
          issuingAuthority: 'Passport Authority',
          notes: 'Confidential personal notes'
        }
      });
      assert.equal(res.status, 201);
      docA_Id = res.data.documentId;
      assert.ok(docA_Id);
    });

    it('CRITICAL IDOR: User B CANNOT read User A document (403 Forbidden)', async () => {
      const res = await request(`/documents/${docA_Id}`, {
        headers: { 'Authorization': `Bearer ${userB_Token}` }
      });
      assert.equal(res.status, 403);
      assert.match(res.data.error, /Access denied/i);
    });

    it('CRITICAL IDOR: User B CANNOT update User A document (403 Forbidden)', async () => {
      const res = await request(`/documents/${docA_Id}`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${userB_Token}` },
        body: {
          name: 'Hacked by Bob',
          documentNumber: 'HACKED'
        }
      });
      assert.equal(res.status, 403);
    });

    it('CRITICAL IDOR: User B CANNOT delete User A document (403 Forbidden)', async () => {
      const res = await request(`/documents/${docA_Id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${userB_Token}` }
      });
      assert.equal(res.status, 403);
    });

    it('CRITICAL IDOR: User B CANNOT archive User A document (403 Forbidden)', async () => {
      const res = await request(`/documents/${docA_Id}/archive`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${userB_Token}` }
      });
      assert.equal(res.status, 403);
    });

    it('CRITICAL IDOR: User B CANNOT renew User A document (403 Forbidden)', async () => {
      const res = await request(`/documents/${docA_Id}/renew`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${userB_Token}` },
        body: {
          newExpiryDate: '2040-01-01',
          renewalNotes: 'Unauthorized renewal attempt'
        }
      });
      assert.equal(res.status, 403);
    });

    it('CRITICAL IDOR: User B CANNOT modify User A family member (403/404 Forbidden)', async () => {
      const res = await request(`/family/members/${userA_MemberId}`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${userB_Token}` },
        body: { name: 'Hacked Name' }
      });
      assert.ok(res.status === 403 || res.status === 404);
    });
  });

  describe('3. Instant Revocation & Access Control Invariants', () => {
    it('User A upgrades to Pro and shares Document A with User B (VIEW)', async () => {
      // Upgrade User A to Pro to enable family sharing
      await request('/subscriptions/upgrade', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${userA_Token}` },
        body: { planId: 'PRO_YEARLY' }
      });

      // User A invites User B
      const invRes = await request('/family/invite', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${userA_Token}` },
        body: { email: userB_Email, relationship: 'Spouse' }
      });
      assert.equal(invRes.status, 201);
      const invId = invRes.data.invitationId;

      // User B accepts invitation
      const acceptRes = await request(`/family/invitations/${invId}/accept`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${userB_Token}` }
      });
      assert.equal(acceptRes.status, 200);

      // Get User B's member record in User A's family
      const famRes = await request('/family', {
        headers: { 'Authorization': `Bearer ${userB_Token}` }
      });
      const bMemberInA = famRes.data.currentUserMemberId;

      // User A shares Document A with User B
      const shareRes = await request('/family/share', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${userA_Token}` },
        body: {
          documentId: docA_Id,
          memberId: bMemberInA,
          permissionLevel: 'VIEW'
        }
      });
      assert.equal(shareRes.status, 200);

      // User B can now read Document A
      const readRes = await request(`/documents/${docA_Id}`, {
        headers: { 'Authorization': `Bearer ${userB_Token}` }
      });
      assert.equal(readRes.status, 200);
      assert.equal(readRes.data.document.name, 'Alice Top Secret Passport');

      // User A revokes access
      const unshareRes = await request('/family/unshare', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${userA_Token}` },
        body: {
          documentId: docA_Id,
          memberId: bMemberInA
        }
      });
      assert.equal(unshareRes.status, 200);

      // CRITICAL: User B is immediately rejected from reading Document A (403)
      const blockedRes = await request(`/documents/${docA_Id}`, {
        headers: { 'Authorization': `Bearer ${userB_Token}` }
      });
      assert.equal(blockedRes.status, 403);
    });
  });

  describe('4. Salted App Lock Security & PIN Verification', () => {
    it('User A configures 4-digit App Lock PIN', async () => {
      const res = await request('/auth/app-lock', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${userA_Token}` },
        body: {
          enabled: true,
          pin: '5678',
          biometricEnabled: true
        }
      });
      assert.equal(res.status, 200);
      assert.equal(res.data.appLockEnabled, true);
    });

    it('Verifies correct PIN successfully', async () => {
      const res = await request('/auth/app-lock/verify', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${userA_Token}` },
        body: { pin: '5678' }
      });
      assert.equal(res.status, 200);
      assert.equal(res.data.valid, true);
    });

    it('Rejects incorrect PIN with 401', async () => {
      const res = await request('/auth/app-lock/verify', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${userA_Token}` },
        body: { pin: '9999' }
      });
      assert.equal(res.status, 401);
      assert.equal(res.data.valid, false);
    });
  });

  describe('5. Account Deletion & Cross-User Data Safety', () => {
    it('User B creates personal document', async () => {
      const res = await request('/documents', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${userB_Token}` },
        body: {
          name: 'Bob Safe Insurance Policy',
          documentTypeId: 'insurance',
          expiryDate: '2030-05-01'
        }
      });
      assert.equal(res.status, 201);
    });

    it('User A deletes account permanently', async () => {
      const res = await request('/auth/account', {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${userA_Token}` }
      });
      assert.equal(res.status, 200);
      assert.match(res.data.message, /permanently deleted/i);
    });

    it('User A cannot login after deletion (401)', async () => {
      const res = await request('/auth/login', {
        method: 'POST',
        body: {
          email: userA_Email,
          password: 'UserASecretPass123!'
        }
      });
      assert.equal(res.status, 401);
    });

    it('CRITICAL: User B document remains 100% intact and unaffected', async () => {
      const res = await request('/documents', {
        headers: { 'Authorization': `Bearer ${userB_Token}` }
      });
      assert.equal(res.status, 200);
      assert.equal(res.data.documents.length, 1);
      assert.equal(res.data.documents[0].name, 'Bob Safe Insurance Policy');
    });
  });
});
