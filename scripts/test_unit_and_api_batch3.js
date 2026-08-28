import assert from 'assert';

// Mock localStorage and sessionStorage for pure Node API verification
const storage = {};
global.localStorage = {
  getItem: (k) => storage[k] || null,
  setItem: (k, v) => { storage[k] = v; },
  removeItem: (k) => { delete storage[k]; },
  clear: () => { for (const k in storage) delete storage[k]; }
};
global.sessionStorage = {
  getItem: (k) => storage['sess_' + k] || null,
  setItem: (k, v) => { storage['sess_' + k] = v; },
  removeItem: (k) => { delete storage['sess_' + k]; },
  clear: () => { for (const k in storage) if (k.startsWith('sess_')) delete storage[k]; }
};

// Import client API
import { api } from '../../client/src/api/client.js';

async function runTests() {
  console.log('========================================================');
  console.log('RUNNING STRICT UNIT & API VERIFICATIONS (BATCH 3)');
  console.log('========================================================');

  // Test 1: Wrong Email Rejection on Login
  console.log('\n--- 1. Testing Strict Email Check on Login ---');
  try {
    await api.auth.login({ email: 'unknown.user999@test.com', password: 'AnyPassword123!' });
    assert.fail('Should have rejected non-existent email');
  } catch (err) {
    console.log('Non-existent email rejected properly:', err.message);
    assert(err.message.includes('No account found') || err.message.includes('create a free vault'));
    console.log('Email check on login: PASSED ✅');
  }

  // Test 2: Register New User & Test Duplicate Registration Rejection
  console.log('\n--- 2. Testing Register & Duplicate Email Rejection ---');
  const regRes = await api.auth.register({
    email: 'hassan.ali@example.com',
    password: 'CorrectPassword2026!',
    fullName: 'Hassan Ali'
  });
  console.log('User registered successfully:', regRes.user.fullName, regRes.user.email);
  assert.strictEqual(regRes.user.email, 'hassan.ali@example.com');

  try {
    await api.auth.register({
      email: 'hassan.ali@example.com',
      password: 'AnotherPassword999!',
      fullName: 'Duplicate Hassan'
    });
    assert.fail('Should have rejected duplicate registration');
  } catch (err) {
    console.log('Duplicate email rejected properly:', err.message);
    assert(err.message.includes('already exists'));
    console.log('Duplicate email rejection: PASSED ✅');
  }

  // Test 3: Wrong Password Rejection for Registered User
  console.log('\n--- 3. Testing Wrong Password Rejection ---');
  try {
    await api.auth.login({ email: 'hassan.ali@example.com', password: 'WrongPassword999!' });
    assert.fail('Should have rejected wrong password');
  } catch (err) {
    console.log('Wrong password rejected properly:', err.message);
    assert(err.message.includes('Incorrect password'));
    console.log('Wrong password check: PASSED ✅');
  }

  // Test 4: Successful Login with Correct Password
  console.log('\n--- 4. Testing Successful Login ---');
  const loginRes = await api.auth.login({ email: 'hassan.ali@example.com', password: 'CorrectPassword2026!' });
  assert.strictEqual(loginRes.user.email, 'hassan.ali@example.com');
  console.log('Login with valid credentials: PASSED ✅');

  // Test 5: Custom Categories CRUD (Create, Read, Update, Delete)
  console.log('\n--- 5. Testing Custom Categories CRUD ---');
  const initialCats = await api.categories.list();
  console.log('Initial categories count:', initialCats.categories.length);

  const createdCat = await api.categories.create({
    name: 'Property Tax Deeds',
    color: '#ec4899',
    icon: 'FileText'
  });
  console.log('Created category:', createdCat.category.name, createdCat.category.id);
  assert.strictEqual(createdCat.category.name, 'Property Tax Deeds');

  // Update Category
  const updatedCat = await api.categories.update(createdCat.category.id, {
    name: 'Commercial Property Deeds',
    color: '#8b5cf6'
  });
  console.log('Updated category name & color:', updatedCat.category.name, updatedCat.category.color);
  assert.strictEqual(updatedCat.category.name, 'Commercial Property Deeds');
  assert.strictEqual(updatedCat.category.color, '#8b5cf6');

  // Delete Category
  const delRes = await api.categories.delete(createdCat.category.id);
  console.log('Deleted category response:', delRes);
  assert.strictEqual(delRes.success, true);
  console.log('Custom Categories CRUD: PASSED ✅');

  // Test 6: Family Vault Invite and Join by Code
  console.log('\n--- 6. Testing Family Vault Invite & Join by Code ---');
  const inviteRes = await api.family.invite({
    email: 'fatima.hassan@example.com',
    name: 'Fatima',
    relationship: 'Spouse',
    role: 'ADMIN'
  });
  console.log('Family Invite Code generated:', inviteRes.inviteCode);
  assert(inviteRes.inviteCode && inviteRes.inviteCode.length === 6);

  // Switch to Fatima user
  const fatimaReg = await api.auth.register({
    email: 'fatima.hassan@example.com',
    password: 'FatimaPassword2026!',
    fullName: 'Fatima Hassan'
  });
  console.log('Fatima registered:', fatimaReg.user.email);

  // Join family with invite code
  const joinRes = await api.family.joinByCode(inviteRes.inviteCode);
  console.log('Join response:', joinRes);
  assert.strictEqual(joinRes.success, true);

  // Verify Fatima's family details
  const fatimaFamily = await api.family.getDetails();
  console.log('Fatima family group:', fatimaFamily.familyGroup?.name, 'Members:', fatimaFamily.members?.length);
  assert(fatimaFamily.members && fatimaFamily.members.length >= 2);
  console.log('Family Vault Invite & Join: PASSED ✅');

  // Test 7: Subscription Purchase Verification & Restoration
  console.log('\n--- 7. Testing In-App Purchase & Restoration ---');
  const verifyRes = await api.subscriptions.verifyPurchase(
    'token_test_abc123',
    'pro_lifetime',
    'GPA.3344-5566-7788-99000'
  );
  console.log('Purchase verify response:', verifyRes.planId, verifyRes.isPro);
  assert.strictEqual(verifyRes.isPro, true);

  // Test Restore
  const restoreRes = await api.subscriptions.restore();
  console.log('Restore response:', restoreRes.planId, restoreRes.isPro);
  assert.strictEqual(restoreRes.isPro, true);
  console.log('Subscription Purchase & Restore: PASSED ✅');

  console.log('\n========================================================');
  console.log('ALL 7 UNIT & API TESTS PASSED PERFECTLY (100%)! 🎉');
  console.log('========================================================');
}

runTests().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
