import http from 'http';
import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer-core';

const CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const DIST_DIR = 'C:/Users/Qaisar Aqeel/.gemini/antigravity/scratch/document-vault/client/dist';

const mimeTypes = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpg',
  '.svg': 'image/svg+xml'
};

const server = http.createServer((req, res) => {
  let reqPath = req.url.split('?')[0];
  if (reqPath === '/') reqPath = '/index.html';
  let filePath = path.join(DIST_DIR, reqPath);

  if (!fs.existsSync(filePath)) {
    filePath = path.join(DIST_DIR, 'index.html');
  }

  const ext = path.extname(filePath);
  const contentType = mimeTypes[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(500);
      res.end('Error loading file');
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    }
  });
});

server.listen(3011, async () => {
  console.log('========================================================');
  console.log('RUNNING IN-BROWSER BATCH 3 VERIFICATIONS (100% SUITE)');
  console.log('========================================================');

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.goto('http://localhost:3011', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 1000));

  // Execute using window.__DV_API in browser window
  const testResults = await page.evaluate(async () => {
    const results = [];
    localStorage.clear();
    sessionStorage.clear();
    const api = window.__DV_API;

    // 1. Check wrong email rejection on login
    try {
      await api.auth.login({ email: 'unknown999@test.com', password: 'Password123!' });
      results.push({ name: 'Strict Email Check (Reject Unknown Email)', passed: false });
    } catch (e) {
      const isExpected = e.message.includes('No account found') || e.message.includes('create a free vault');
      results.push({ name: 'Strict Email Check (Reject Unknown Email)', passed: isExpected, message: e.message });
    }

    // 2. Register user
    let user1;
    try {
      const regRes = await api.auth.register({
        email: 'ahmed.khan@example.com',
        password: 'AhmedPassword2026!',
        fullName: 'Ahmed Khan'
      });
      user1 = regRes.user;
      results.push({ name: 'User Registration with Custom Credentials', passed: !!user1 && user1.email === 'ahmed.khan@example.com' });
    } catch (e) {
      results.push({ name: 'User Registration with Custom Credentials', passed: false, error: e.message });
    }

    // 3. Reject duplicate registration
    try {
      await api.auth.register({
        email: 'ahmed.khan@example.com',
        password: 'AnotherPassword999!',
        fullName: 'Duplicate Ahmed'
      });
      results.push({ name: 'Duplicate Email Registration Rejection', passed: false });
    } catch (e) {
      const isDup = e.message.includes('already exists');
      results.push({ name: 'Duplicate Email Registration Rejection', passed: isDup, message: e.message });
    }

    // 4. Reject wrong password for registered user
    try {
      await api.auth.login({ email: 'ahmed.khan@example.com', password: 'WrongPass999!' });
      results.push({ name: 'Wrong Password Rejection for Registered Account', passed: false });
    } catch (e) {
      const isWrongPass = e.message.includes('Incorrect password');
      results.push({ name: 'Wrong Password Rejection for Registered Account', passed: isWrongPass, message: e.message });
    }

    // 5. Successful login with correct password
    try {
      const loginRes = await api.auth.login({ email: 'ahmed.khan@example.com', password: 'AhmedPassword2026!' });
      results.push({ name: 'Valid Credentials Sign In', passed: loginRes.user?.email === 'ahmed.khan@example.com' });
    } catch (e) {
      results.push({ name: 'Valid Credentials Sign In', passed: false, error: e.message });
    }

    // 6. Custom Category Create, Update, Delete
    try {
      const catCreateRes = await api.categories.create({
        name: 'Investment Portfolios',
        color: '#10b981',
        icon: 'FileText'
      });
      const catId = catCreateRes.category?.id;

      const catUpdateRes = await api.categories.update(catId, {
        name: 'Crypto & Stock Portfolios',
        color: '#6366f1'
      });
      const catUpdated = catUpdateRes.category?.name === 'Crypto & Stock Portfolios' && catUpdateRes.category?.color === '#6366f1';

      const catDelRes = await api.categories.delete(catId);
      results.push({ name: 'Custom Category CRUD (Create, Edit Name/Color, Delete)', passed: catUpdated && catDelRes.success === true });
    } catch (e) {
      results.push({ name: 'Custom Category CRUD (Create, Edit Name/Color, Delete)', passed: false, error: e.message });
    }

    // 7. Family Invite & Join with 6-Digit Code
    try {
      const inviteRes = await api.family.invite({
        email: 'sara.khan@example.com',
        name: 'Sara',
        relationship: 'Sister',
        role: 'MEMBER'
      });
      const inviteCode = inviteRes.inviteCode;

      // Register Sara
      await api.auth.register({
        email: 'sara.khan@example.com',
        password: 'SaraPassword2026!',
        fullName: 'Sara Khan'
      });

      // Sara joins with code
      const joinRes = await api.family.joinByCode(inviteCode);
      const famDetails = await api.family.get();

      const passed = joinRes.success === true && famDetails.members?.length >= 2;
      results.push({
        name: 'Family Vault 6-Digit Invite & Join Sync',
        passed,
        message: `joinRes: ${JSON.stringify(joinRes)}, members: ${famDetails.members?.length}`
      });
    } catch (e) {
      results.push({ name: 'Family Vault 6-Digit Invite & Join Sync', passed: false, error: e.message, message: e.message });
    }

    // 8. Subscription Verify Purchase & Restore
    try {
      const verifyRes = await api.subscriptions.verifyPurchase('gpay_token_9988', 'pro_lifetime', 'GPA.1234-5678');
      const restoreRes = await api.subscriptions.restore();
      results.push({
        name: 'Google Play Purchase Verification & Restore',
        passed: verifyRes.isPro === true && restoreRes.isPro === true
      });
    } catch (e) {
      results.push({ name: 'Google Play Purchase Verification & Restore', passed: false, error: e.message });
    }

    return results;
  });

  console.log('\n--- BROWSER TEST RESULTS ---');
  let allPassed = true;
  for (const r of testResults) {
    console.log(`[${r.passed ? 'PASSED ✅' : 'FAILED ❌'}] ${r.name} ${r.message ? `(${r.message})` : ''}`);
    if (!r.passed) allPassed = false;
  }

  await browser.close();
  server.close();
  console.log('\n========================================================');
  console.log(allPassed ? 'ALL IN-BROWSER TESTS PASSED (100%)! 🎉' : 'SOME TESTS FAILED');
  console.log('========================================================');
  process.exit(allPassed ? 0 : 1);
});
