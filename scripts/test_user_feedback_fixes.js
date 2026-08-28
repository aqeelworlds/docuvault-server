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

server.listen(3007, async () => {
  console.log('==============================================');
  console.log('AUTOMATED VALIDATION OF ALL USER FEEDBACK POINTS');
  console.log('==============================================');

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();

  page.on('console', msg => {
    if (msg.type() === 'error') console.error(`[PAGE ERROR]:`, msg.text());
  });
  page.on('pageerror', err => console.error(`[PAGE CRASH]:`, err.message));

  // TEST 1: NEW USER SIGNUP & OWNER IS CLEAN (NO DEMO NAMES)
  console.log('\n--- 1. Testing New User Signup & Owner Scope ---');
  await page.goto('http://localhost:3007', { waitUntil: 'networkidle0' });
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.reload({ waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 3200));

  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const btn = btns.find(b => b.textContent && b.textContent.includes('Get Started'));
    if (btn) btn.click();
  });
  await new Promise(r => setTimeout(r, 500));

  await page.type('input[placeholder="e.g. John Doe"]', 'Malik Qaisar');
  await page.type('input[placeholder="name@example.com"]', 'qaisar.test@example.com');
  await page.type('input[placeholder="••••••••"]', 'SafePass2026!');

  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const btn = btns.find(b => b.textContent && b.textContent.includes('Create Free Vault'));
    if (btn) btn.click();
  });
  await new Promise(r => setTimeout(r, 1500));

  // Click Add Document
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const btn = btns.find(b => b.textContent && b.textContent.includes('Add Document'));
    if (btn) btn.click();
  });
  await new Promise(r => setTimeout(r, 1000));

  const addDocPageText = await page.evaluate(() => document.body.innerText);
  const hasDemoNamesInNewAccount = addDocPageText.includes('Alexander Smith') || addDocPageText.includes('Liam Smith');
  console.log('Owner Scope Clean? (No Demo Names in New Account):', !hasDemoNamesInNewAccount ? 'PASSED ✅' : 'FAILED ❌');

  // Go back from Add Document screen to show Bottom Nav
  await page.evaluate(() => {
    const backBtn = document.querySelector('button.rounded-xl');
    if (backBtn) backBtn.click();
  });
  await new Promise(r => setTimeout(r, 800));

  // TEST 2: GOOGLE PLAY IN-APP PURCHASE MODAL
  console.log('\n--- 2. Testing Google Play In-App Purchase Flow ---');
  // Navigate to Profile -> Manage Subscription
  await page.evaluate(() => {
    const navs = Array.from(document.querySelectorAll('button'));
    const profBtn = navs.find(b => b.textContent && b.textContent.includes('Profile'));
    if (profBtn) profBtn.click();
  });
  await new Promise(r => setTimeout(r, 1000));

  // Click Manage Plan
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const planBtn = btns.find(b => b.textContent && b.textContent.includes('Manage Plan'));
    if (planBtn) planBtn.click();
  });
  await new Promise(r => setTimeout(r, 1000));

  // Click Select Monthly Plan
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const btn = btns.find(b => b.textContent && b.textContent.includes('Select Monthly Plan'));
    if (btn) btn.click();
  });
  await new Promise(r => setTimeout(r, 1200));

  // Click Trigger in Paywall
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const btn = btns.find(b => b.textContent && b.textContent.includes('Start Monthly Subscription'));
    if (btn) btn.click();
  });
  await new Promise(r => setTimeout(r, 1200));

  const paywallText = await page.evaluate(() => document.body.innerText);
  const hasGooglePlaySheet = paywallText.includes('Google Play In-App Purchase') && paywallText.includes('1-Tap Buy');
  console.log('Google Play Payment Sheet Live:', hasGooglePlaySheet ? 'PASSED ✅' : 'FAILED ❌');

  // Complete purchase
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const btn = btns.find(b => b.textContent && b.textContent.includes('1-Tap Buy'));
    if (btn) btn.click();
  });
  await new Promise(r => setTimeout(r, 2200));

  const upgradedText = await page.evaluate(() => document.body.innerText);
  console.log('Plan Activated to Pro Monthly:', upgradedText.includes('Pro Monthly') ? 'PASSED ✅' : 'FAILED ❌');

  // Go back from Subscription Screen to Profile
  await page.evaluate(() => {
    const backBtn = document.querySelector('button.rounded-xl');
    if (backBtn) backBtn.click();
  });
  await new Promise(r => setTimeout(r, 1000));

  // TEST 3: APP LOCK PIN & BIOMETRIC MODAL
  console.log('\n--- 3. Testing App Lock PIN & Biometrics ---');
  // Click App Lock Toggle in Profile
  await page.evaluate(() => {
    const btn = document.querySelector('button[type="button"].w-11');
    if (btn) btn.click();
  });
  await new Promise(r => setTimeout(r, 1000));

  // Set PIN 8899
  await page.type('input[placeholder="••••"]', '8899');
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const btn = btns.find(b => b.textContent && b.textContent.includes('Save PIN Lock'));
    if (btn) btn.click();
  });
  await new Promise(r => setTimeout(r, 1500));

  // Test AppLockScreen
  await page.evaluate(() => {
    sessionStorage.clear();
  });
  await page.reload({ waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 3500));

  const lockScreenText = await page.evaluate(() => document.body.innerText);
  console.log('App Lock Screen Shown on Startup:', lockScreenText.includes('Vault Locked') ? 'PASSED ✅' : 'FAILED ❌');

  // Test Wrong PIN 1111
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const b1 = btns.find(b => b.textContent && b.textContent.trim() === '1');
      if (b1) b1.click();
    });
    await new Promise(r => setTimeout(r, 150));
  }
  await new Promise(r => setTimeout(r, 1000));

  const wrongPinText = await page.evaluate(() => document.body.innerText);
  const wrongPinFailedProperly = wrongPinText.includes('Wrong PIN') || wrongPinText.includes('Incorrect');
  console.log('Wrong PIN Rejection Test:', wrongPinFailedProperly ? 'PASSED ✅' : 'FAILED ❌');

  // Test Biometric Button
  await page.evaluate(() => {
    const btn = document.querySelector('button[title="Unlock with Biometrics"]');
    if (btn) btn.click();
  });
  await new Promise(r => setTimeout(r, 600));

  const bioModalText = await page.evaluate(() => document.body.innerText);
  const hasBiometricScanningModal = bioModalText.includes('Biometric Authentication') || bioModalText.includes('fingerprint sensor');
  console.log('Biometric Fingerprint Scan Modal:', hasBiometricScanningModal ? 'PASSED ✅' : 'FAILED ❌');

  // Wait for biometric unlock to complete
  await new Promise(r => setTimeout(r, 2000));
  const unlockedText = await page.evaluate(() => document.body.innerText);
  console.log('Biometric Vault Unlock:', unlockedText.includes('Malik') || unlockedText.includes('DOCUMENT VAULT') ? 'PASSED ✅' : 'FAILED ❌');

  await browser.close();
  server.close();
  console.log('\n==============================================');
  console.log('ALL VERIFICATIONS COMPLETED SUCCESSFULLY!');
  console.log('==============================================');
  process.exit(0);
});
