import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import apiRouter from '../dist/routes/api.js';
import { initDatabase, dbRun, dbGet, dbAll } from '../dist/db/database.js';

const PORT = 5120;
const BASE_URL = `http://localhost:${PORT}/api`;

let server;
let userA_Token, userA_Id, userA_Email;
let userB_Token, userB_Id, userB_Email;
const playToken = `play_token_userA_${Date.now()}`;

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

describe('PHASE 6: Real Free and Pro Subscription System Test Suite', () => {
  before(async () => {
    await initDatabase();

    const app = express();
    app.use(cors());
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use('/api', apiRouter);

    server = app.listen(PORT);

    // Register User A (Starts on Free Plan)
    userA_Email = `phase6_userA_${Date.now()}@vault.local`;
    const resA = await request('/auth/register', {
      method: 'POST',
      body: {
        email: userA_Email,
        password: 'Password123!',
        fullName: 'Free Tier User A'
      }
    });
    assert.equal(resA.status, 201);
    userA_Token = resA.data.token;
    userA_Id = resA.data.user.id;

    // Register User B
    userB_Email = `phase6_userB_${Date.now()}@vault.local`;
    const resB = await request('/auth/register', {
      method: 'POST',
      body: {
        email: userB_Email,
        password: 'Password123!',
        fullName: 'User B'
      }
    });
    assert.equal(resB.status, 201);
    userB_Token = resB.data.token;
    userB_Id = resB.data.user.id;
  });

  after(() => {
    if (server) server.close();
  });

  // 1. Free Tier Entitlements & 5-Document Limit
  describe('1. Free Plan Limit & Server-Side Enforcement', () => {
    it('Verifies initial plan is FREE with maxDocuments: 5', async () => {
      const subRes = await request('/subscriptions', {
        headers: { Authorization: `Bearer ${userA_Token}` }
      });
      assert.equal(subRes.status, 200);
      assert.equal(subRes.data.planId, 'FREE');
      assert.equal(subRes.data.isPro, false);
      assert.equal(subRes.data.entitlements.maxDocuments, 5);
      assert.equal(subRes.data.entitlements.currentDocuments, 0);
    });

    it('Adds 5 documents successfully on Free plan', async () => {
      for (let i = 1; i <= 5; i++) {
        const res = await request('/documents', {
          method: 'POST',
          headers: { Authorization: `Bearer ${userA_Token}` },
          body: {
            name: `Personal Document ${i}`,
            documentTypeId: 'cat_identity',
            documentNumber: `FREE-DOC-${i}`,
            expiryDate: '2030-01-01'
          }
        });
        assert.equal(res.status, 201, `Failed to create document ${i}`);
      }

      const subRes = await request('/subscriptions', {
        headers: { Authorization: `Bearer ${userA_Token}` }
      });
      assert.equal(subRes.data.entitlements.currentDocuments, 5);
      assert.equal(subRes.data.entitlements.hasReachedLimit, true);
    });

    it('CRITICAL: Server blocks 6th document on Free plan with 403 PLAN_LIMIT_REACHED', async () => {
      const res = await request('/documents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${userA_Token}` },
        body: {
          name: 'Sixth Document Over Limit',
          documentTypeId: 'cat_identity',
          documentNumber: 'FREE-DOC-6',
          expiryDate: '2030-01-01'
        }
      });
      assert.equal(res.status, 403);
      assert.equal(res.data.code, 'PLAN_LIMIT_REACHED');
    });

    it('Verifies existing 5 documents remain 100% accessible', async () => {
      const docsRes = await request('/documents', {
        headers: { Authorization: `Bearer ${userA_Token}` }
      });
      assert.equal(docsRes.status, 200);
      assert.equal(docsRes.data.documents.length, 5);
    });
  });

  // 2. Family Paywall Gatekeeping for Free Users
  describe('2. Family Feature Paywall on Free Plan', () => {
    it('Rejects adding additional family member on Free plan (403 FAMILY_PRO_REQUIRED)', async () => {
      const res = await request('/family/members', {
        method: 'POST',
        headers: { Authorization: `Bearer ${userA_Token}` },
        body: {
          name: 'Jane Doe',
          relationship: 'Spouse',
          role: 'MEMBER'
        }
      });
      assert.equal(res.status, 403);
      assert.equal(res.data.code, 'FAMILY_PRO_REQUIRED');
    });
  });

  // 3. Real Google Play Purchase Verification & Entitlement Activation
  describe('3. Google Play Purchase Verification & Pro Entitlement', () => {
    it('Verifies and activates Google Play monthly subscription', async () => {
      const res = await request('/subscriptions/verify-purchase', {
        method: 'POST',
        headers: { Authorization: `Bearer ${userA_Token}` },
        body: {
          purchaseToken: playToken,
          productId: 'vault_pro_monthly',
          orderId: 'GPA.3000-1111-2222',
          packageName: 'com.documentvault.app'
        }
      });
      assert.equal(res.status, 200);
      assert.equal(res.data.verified, true);
      assert.equal(res.data.planId, 'PRO_MONTHLY');
      assert.equal(res.data.status, 'ACTIVE');
    });

    it('Verifies User A now has Pro entitlements (isPro: true, unlimited docs)', async () => {
      const subRes = await request('/subscriptions', {
        headers: { Authorization: `Bearer ${userA_Token}` }
      });
      assert.equal(subRes.status, 200);
      assert.equal(subRes.data.isPro, true);
      assert.equal(subRes.data.entitlements.hasReachedLimit, false);
      assert.equal(subRes.data.entitlements.familySharingEnabled, true);
    });

    it('Allows Pro user to add 6th and 7th documents without limits', async () => {
      const res6 = await request('/documents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${userA_Token}` },
        body: {
          name: 'Pro Document 6',
          documentTypeId: 'cat_travel',
          documentNumber: 'PRO-DOC-6',
          expiryDate: '2032-05-01'
        }
      });
      assert.equal(res6.status, 201);

      const res7 = await request('/documents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${userA_Token}` },
        body: {
          name: 'Pro Document 7',
          documentTypeId: 'cat_finance',
          documentNumber: 'PRO-DOC-7',
          expiryDate: '2033-08-15'
        }
      });
      assert.equal(res7.status, 201);
    });

    it('Allows Pro user to add family member now that Pro is active', async () => {
      const res = await request('/family/members', {
        method: 'POST',
        headers: { Authorization: `Bearer ${userA_Token}` },
        body: {
          name: 'Jane Doe',
          relationship: 'Spouse',
          role: 'MEMBER'
        }
      });
      assert.equal(res.status, 201);
    });
  });

  // 4. Safe Expiration (No Data Loss & Read-Only Retention)
  describe('4. Subscription Expiration Safety & Read-Only Retention', () => {
    it('Simulates subscription expiration by setting past current_period_end', async () => {
      const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      await dbRun(
        'UPDATE subscriptions SET current_period_end = ? WHERE user_id = ?',
        [pastDate, userA_Id]
      );

      const subRes = await request('/subscriptions', {
        headers: { Authorization: `Bearer ${userA_Token}` }
      });
      assert.equal(subRes.status, 200);
      assert.equal(subRes.data.status, 'EXPIRED');
      assert.equal(subRes.data.isPro, false);
    });

    it('CRITICAL: Existing 7 documents are 100% PRESERVED and readable after Pro expires', async () => {
      const docsRes = await request('/documents', {
        headers: { Authorization: `Bearer ${userA_Token}` }
      });
      assert.equal(docsRes.status, 200);
      assert.equal(docsRes.data.documents.length, 7);
    });

    it('Server blocks adding 8th document while subscription is expired (403)', async () => {
      const res = await request('/documents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${userA_Token}` },
        body: {
          name: 'Eighth Document Post Expiry',
          documentTypeId: 'cat_identity',
          expiryDate: '2035-01-01'
        }
      });
      assert.equal(res.status, 403);
      assert.equal(res.data.code, 'PLAN_LIMIT_REACHED');
    });
  });

  // 5. Cross-Account Security & Purchase Token Replay Prevention
  describe('5. Cross-Account Security & Purchase Token Replay Prevention', () => {
    it('Verifies User B remains on FREE plan and does not inherit User A Pro status', async () => {
      const subRes = await request('/subscriptions', {
        headers: { Authorization: `Bearer ${userB_Token}` }
      });
      assert.equal(subRes.status, 200);
      assert.equal(subRes.data.planId, 'FREE');
      assert.equal(subRes.data.isPro, false);
    });

    it('Blocks User B from claiming User A Google Play purchase token (409 Conflict)', async () => {
      const res = await request('/subscriptions/verify-purchase', {
        method: 'POST',
        headers: { Authorization: `Bearer ${userB_Token}` },
        body: {
          purchaseToken: playToken,
          productId: 'vault_pro_monthly'
        }
      });
      assert.equal(res.status, 409);
      assert.equal(res.data.code, 'PURCHASE_ALREADY_LINKED');
    });
  });

  // 6. Restore Purchases Flow
  describe('6. Restore Purchases Flow', () => {
    it('Restores active Pro subscription when User A renews and calls restore', async () => {
      // Re-activate User A subscription
      const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      await dbRun(
        'UPDATE subscriptions SET current_period_end = ?, status = "ACTIVE" WHERE user_id = ?',
        [futureDate, userA_Id]
      );

      const res = await request('/subscriptions/restore', {
        method: 'POST',
        headers: { Authorization: `Bearer ${userA_Token}` }
      });
      assert.equal(res.status, 200);
      assert.equal(res.data.restored, true);
      assert.equal(res.data.planId, 'PRO_MONTHLY');
    });
  });
});
