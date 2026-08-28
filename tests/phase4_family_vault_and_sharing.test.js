import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import apiRouter from '../dist/routes/api.js';
import { initDatabase, dbRun, dbGet, dbAll } from '../dist/db/database.js';

const PORT = 5092;
const BASE_URL = `http://localhost:${PORT}/api`;

let server;
let userAToken, userAId, userAEmail;
let userBToken, userBId, userBEmail;
let userCToken, userCId, userCEmail;
let familyGroupId, memberAId, memberBId, memberChildId;
let docId, attachmentId;

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

describe('PHASE 4: Family Vault, Family Members & Secure Sharing Test Suite', () => {
  before(async () => {
    await initDatabase();

    const app = express();
    app.use(cors());
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use('/api', apiRouter);

    server = app.listen(PORT);

    // Register User A (Family Owner)
    userAEmail = `owner_user_${Date.now()}@vault.local`;
    const resA = await request('/auth/register', {
      method: 'POST',
      body: {
        email: userAEmail,
        password: 'Password123!',
        fullName: 'Alice Smith'
      }
    });
    assert.equal(resA.status, 201);
    userAToken = resA.data.token;
    userAId = resA.data.user.id;

    // Upgrade User A to Pro
    await request('/subscriptions/upgrade', {
      method: 'POST',
      headers: { Authorization: `Bearer ${userAToken}` },
      body: { planId: 'PRO_MONTHLY' }
    });

    // Register User B (Invited Spouse)
    userBEmail = `spouse_user_${Date.now()}@vault.local`;
    const resB = await request('/auth/register', {
      method: 'POST',
      body: {
        email: userBEmail,
        password: 'Password123!',
        fullName: 'Bob Smith'
      }
    });
    assert.equal(resB.status, 201);
    userBToken = resB.data.token;
    userBId = resB.data.user.id;

    // Register User C (Third-party outsider)
    userCEmail = `outsider_user_${Date.now()}@vault.local`;
    const resC = await request('/auth/register', {
      method: 'POST',
      body: {
        email: userCEmail,
        password: 'Password123!',
        fullName: 'Charlie Stranger'
      }
    });
    assert.equal(resC.status, 201);
    userCToken = resC.data.token;
    userCId = resC.data.user.id;
  });

  after(() => {
    if (server) server.close();
  });

  // 1. Family Group & Direct Member Profile Creation
  describe('1. Family Group & Direct Vault Member Profiles', () => {
    it('Retrieves family group for User A with role OWNER', async () => {
      const res = await request('/family', {
        headers: { Authorization: `Bearer ${userAToken}` }
      });
      assert.equal(res.status, 200);
      assert.ok(res.data.familyGroup);
      assert.equal(res.data.currentUserRole, 'OWNER');
      familyGroupId = res.data.familyGroup.id;
      memberAId = res.data.currentUserMemberId;
    });

    it('Owner adds a child profile directly to the family vault', async () => {
      const res = await request('/family/members', {
        method: 'POST',
        headers: { Authorization: `Bearer ${userAToken}` },
        body: {
          name: 'Tommy Smith',
          relationship: 'Child',
          role: 'MEMBER'
        }
      });
      assert.equal(res.status, 201);
      assert.ok(res.data.memberId);
      memberChildId = res.data.memberId;
    });

    it('Owner renames the family group', async () => {
      const res = await request('/family/name', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${userAToken}` },
        body: { name: 'The Smith Family Vault' }
      });
      assert.equal(res.status, 200);
      assert.equal(res.data.name, 'The Smith Family Vault');
    });
  });

  // 2. Real Family Invitation Flow (Invite, Pending, Accept, Reject, Cancel)
  describe('2. Real Family Invitation Flow', () => {
    let invitationId;

    it('Owner invites User B via email with relationship Spouse', async () => {
      const res = await request('/family/invite', {
        method: 'POST',
        headers: { Authorization: `Bearer ${userAToken}` },
        body: {
          email: userBEmail,
          relationship: 'Spouse',
          role: 'MEMBER'
        }
      });
      assert.equal(res.status, 201);
      assert.ok(res.data.invitationId);
      invitationId = res.data.invitationId;
    });

    it('User B checks pending invitations and sees the invitation from User A', async () => {
      const res = await request('/family/invitations/pending', {
        headers: { Authorization: `Bearer ${userBToken}` }
      });
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.data.invitations));
      const found = res.data.invitations.find(i => i.id === invitationId);
      assert.ok(found);
      assert.equal(found.relationship, 'Spouse');
    });

    it('User B accepts the invitation and joins User A family', async () => {
      const res = await request(`/family/invitations/${invitationId}/accept`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${userBToken}` }
      });
      assert.equal(res.status, 200);

      // Verify User B is now a member
      const famRes = await request('/family', {
        headers: { Authorization: `Bearer ${userBToken}` }
      });
      assert.equal(famRes.status, 200);
      assert.equal(famRes.data.familyGroup.id, familyGroupId);
      memberBId = famRes.data.currentUserMemberId;
      assert.ok(memberBId);
    });

    it('Owner creates and then cancels an invitation for User C', async () => {
      const invRes = await request('/family/invite', {
        method: 'POST',
        headers: { Authorization: `Bearer ${userAToken}` },
        body: {
          email: userCEmail,
          relationship: 'Other'
        }
      });
      assert.equal(invRes.status, 201);
      const cInvId = invRes.data.invitationId;

      const cancelRes = await request(`/family/invitations/${cInvId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${userAToken}` }
      });
      assert.equal(cancelRes.status, 200);
    });
  });

  // 3. Document Creation with Assigned Family Member Owner
  describe('3. Document Creation for Family Member', () => {
    it('Owner creates a Passport document assigned to Child (Tommy)', async () => {
      const res = await request('/documents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${userAToken}` },
        body: {
          name: "Tommy's Official Passport",
          documentTypeId: 'cat_travel',
          documentNumber: 'TP-99887766',
          ownerMemberId: memberChildId,
          issueDate: '2024-01-01',
          expiryDate: '2029-01-01',
          issuingAuthority: 'Passport Office'
        }
      });
      assert.equal(res.status, 201);
      docId = res.data.documentId;

      // Attach a mock file attachment directly to DB for attachment authorization testing
      attachmentId = uuidv4();
      await dbRun(
        `INSERT INTO document_attachments (id, document_id, file_name, file_size, mime_type, file_path, is_primary)
         VALUES (?, ?, 'passport_scan.pdf', 102400, 'application/pdf', 'mock_vault_path.pdf', 1)`,
        [attachmentId, docId]
      );
    });

    it('Verifies document reflects correct family member owner', async () => {
      const res = await request(`/documents/${docId}`, {
        headers: { Authorization: `Bearer ${userAToken}` }
      });
      assert.equal(res.status, 200);
      assert.equal(res.data.document.owner_member_id, memberChildId);
      assert.equal(res.data.document.owner_name, 'Tommy Smith');
    });
  });

  // 4. Secure Document Sharing & Granular Permissions (VIEW vs EDIT)
  describe('4. Secure Sharing & Server-Side Authorization (VIEW vs EDIT)', () => {
    it('CRITICAL: User B CANNOT read Document X before it is shared (403 Forbidden)', async () => {
      const res = await request(`/documents/${docId}`, {
        headers: { Authorization: `Bearer ${userBToken}` }
      });
      assert.equal(res.status, 403);
    });

    it('Owner shares Document X with User B with VIEW permission', async () => {
      const res = await request('/family/share', {
        method: 'POST',
        headers: { Authorization: `Bearer ${userAToken}` },
        body: {
          documentId: docId,
          memberId: memberBId,
          permissionLevel: 'VIEW'
        }
      });
      assert.equal(res.status, 200);
    });

    it('User B can now READ Document X (200 OK)', async () => {
      const res = await request(`/documents/${docId}`, {
        headers: { Authorization: `Bearer ${userBToken}` }
      });
      assert.equal(res.status, 200);
      assert.equal(res.data.document.userPermission, 'VIEW');
    });

    it('CRITICAL: User B CANNOT EDIT Document X with VIEW permission (403 Forbidden)', async () => {
      const res = await request(`/documents/${docId}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${userBToken}` },
        body: { name: 'Attempted Malicious Rename' }
      });
      assert.equal(res.status, 403);
    });

    it('Owner upgrades User B permission to EDIT', async () => {
      const res = await request('/family/share', {
        method: 'POST',
        headers: { Authorization: `Bearer ${userAToken}` },
        body: {
          documentId: docId,
          memberId: memberBId,
          permissionLevel: 'EDIT'
        }
      });
      assert.equal(res.status, 200);
    });

    it('User B can now EDIT Document X with EDIT permission (200 OK)', async () => {
      const res = await request(`/documents/${docId}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${userBToken}` },
        body: {
          name: "Tommy's Passport (Verified by Bob)",
          expiryDate: '2029-01-01'
        }
      });
      assert.equal(res.status, 200);
    });

    it('CRITICAL: User B CANNOT DELETE Document X even with EDIT permission (403 Forbidden)', async () => {
      const res = await request(`/documents/${docId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${userBToken}` }
      });
      assert.equal(res.status, 403);
    });
  });

  // 5. Revoke Access & Attachment Security
  describe('5. Access Revocation & Private Attachment Streaming Security', () => {
    it('Owner revokes User B sharing access', async () => {
      const res = await request('/family/unshare', {
        method: 'POST',
        headers: { Authorization: `Bearer ${userAToken}` },
        body: {
          documentId: docId,
          memberId: memberBId
        }
      });
      assert.equal(res.status, 200);
    });

    it('CRITICAL: User B IMMEDIATELY loses access to Document X (403 Forbidden)', async () => {
      const res = await request(`/documents/${docId}`, {
        headers: { Authorization: `Bearer ${userBToken}` }
      });
      assert.equal(res.status, 403);
    });

    it('CRITICAL: User B CANNOT view/stream attachment after access revoked (403 Forbidden)', async () => {
      const res = await request(`/attachments/${attachmentId}/view?token=${userBToken}`);
      assert.equal(res.status, 403);
    });

    it('CRITICAL: User B CANNOT download attachment after access revoked (403 Forbidden)', async () => {
      const res = await request(`/attachments/${attachmentId}/download?token=${userBToken}`);
      assert.equal(res.status, 403);
    });
  });

  // 6. Family Member Deletion & Group Dissolution
  describe('6. Safe Member Removal & Family Dissolution', () => {
    it('Owner removes child member and verifies document ownership unlinks safely without deleting document', async () => {
      const res = await request(`/family/members/${memberChildId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${userAToken}` }
      });
      assert.equal(res.status, 200);

      // Verify document still exists in User A vault
      const docCheck = await request(`/documents/${docId}`, {
        headers: { Authorization: `Bearer ${userAToken}` }
      });
      assert.equal(docCheck.status, 200);
    });

    it('User B leaves the family group', async () => {
      const res = await request('/family/leave', {
        method: 'POST',
        headers: { Authorization: `Bearer ${userBToken}` }
      });
      assert.equal(res.status, 200);
    });

    it('Owner dissolves family group cleanly', async () => {
      const res = await request('/family', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${userAToken}` }
      });
      assert.equal(res.status, 200);
    });
  });
});
