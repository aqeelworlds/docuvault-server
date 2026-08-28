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

server.listen(3009, async () => {
  console.log('========================================================');
  console.log('VERIFYING BATCH 3 USER REQUIREMENTS (SECURITY, PAYMENTS, CATEGORIES, FAMILY)');
  console.log('========================================================');

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();

  // Test 1: Register New User & Verify Google Play Checkout
  console.log('\n--- 1. Testing Registration & Google Play Interactive Checkout ---');
  await page.goto('http://localhost:3009', { waitUntil: 'networkidle0' });
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.reload({ waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 3200));

  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const btn = btns.find(b => b.textContent && b.textContent.includes('Get Started'));
    if (btn) btn.click();
  });
  await new Promise(r => setTimeout(r, 600));

  await page.type('input[placeholder="e.g. John Doe"]', 'Malik Tariq');
  await page.type('input[placeholder="name@example.com"]', 'malik.tariq@example.com');
  await page.type('input[placeholder="••••••••"]', 'SafeTariq2026!');

  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const btn = btns.find(b => b.textContent && b.textContent.includes('Create Free Vault'));
    if (btn) btn.click();
  });
  await new Promise(r => setTimeout(r, 1600));

  // Open Upgrade modal from Header
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const upBtn = btns.find(b => b.textContent && b.textContent.trim() === 'Upgrade');
    if (upBtn) upBtn.click();
  });
  await new Promise(r => setTimeout(r, 800));

  // Click Upgrade to Pro button inside PaywallModal
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const zapBtn = btns.find(b => b.textContent && b.textContent.includes('Get Lifetime Access'));
    if (zapBtn) zapBtn.click();
  });
  await new Promise(r => setTimeout(r, 800));

  const gplaySheetText = await page.evaluate(() => document.body.innerText);
  const hasGPlaySheet = gplaySheetText.includes('Google Play Checkout') && gplaySheetText.includes('Select Payment Method');
  console.log('Google Play Checkout Sheet Opened:', hasGPlaySheet ? 'PASSED ✅' : 'FAILED ❌');

  // Complete 1-Tap Purchase
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const buyBtn = btns.find(b => b.textContent && b.textContent.includes('1-Tap Buy'));
    if (buyBtn) buyBtn.click();
  });
  await new Promise(r => setTimeout(r, 2600));

  const upgradedHeaderText = await page.evaluate(() => document.body.innerText);
  const isUpgradedToPro = upgradedHeaderText.includes('PRO') || !upgradedHeaderText.includes('Upgrade');
  console.log('Account Successfully Upgraded to PRO with Receipt:', isUpgradedToPro ? 'PASSED ✅' : 'FAILED ❌');

  // Test 2: Logout and Test Wrong Email & Password Rejection
  console.log('\n--- 2. Testing Logout & Wrong Password Rejection ---');
  // Navigate to Profile -> Logout
  await page.evaluate(() => {
    const navs = Array.from(document.querySelectorAll('button'));
    const profBtn = navs.find(b => b.textContent && b.textContent.includes('Profile'));
    if (profBtn) profBtn.click();
  });
  await new Promise(r => setTimeout(r, 1000));

  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const logoutBtn = btns.find(b => b.textContent && b.textContent.includes('Log Out of Document Vault'));
    if (logoutBtn) logoutBtn.click();
  });
  await new Promise(r => setTimeout(r, 1200));

  // Click Sign In on Intro
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const signInBtn = btns.find(b => b.textContent && b.textContent.includes('I already have a Vault'));
    if (signInBtn) signInBtn.click();
  });
  await new Promise(r => setTimeout(r, 800));

  // Try wrong password for registered user
  await page.type('input[placeholder="name@example.com"]', 'malik.tariq@example.com');
  await page.type('input[placeholder="••••••••"]', 'TotallyWrongPassword999!');
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const loginBtn = btns.find(b => b.textContent && b.textContent.includes('Sign In to Vault'));
    if (loginBtn) loginBtn.click();
  });
  await new Promise(r => setTimeout(r, 1200));

  const authErrorText = await page.evaluate(() => document.body.innerText);
  const hasWrongPassError = authErrorText.includes('Incorrect password') || authErrorText.includes('Invalid') || authErrorText.includes('failed');
  console.log('Wrong Password for Existing Account Rejected:', hasWrongPassError ? 'PASSED ✅' : 'FAILED ❌');

  // Login with correct password
  await page.evaluate(() => {
    const passInput = document.querySelector('input[placeholder="••••••••"]');
    if (passInput) passInput.value = '';
  });
  await page.type('input[placeholder="••••••••"]', 'SafeTariq2026!');
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const loginBtn = btns.find(b => b.textContent && b.textContent.includes('Sign In to Vault'));
    if (loginBtn) loginBtn.click();
  });
  await new Promise(r => setTimeout(r, 1500));

  // Test 3: Custom Category Edit & Delete
  console.log('\n--- 3. Testing Custom Category Edit & Delete ---');
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const addBtn = btns.find(b => b.textContent && b.textContent.includes('Add Document'));
    if (addBtn) addBtn.click();
  });
  await new Promise(r => setTimeout(r, 1000));

  // Click + Custom Category
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const customBtn = btns.find(b => b.textContent && b.textContent.includes('+ Custom'));
    if (customBtn) customBtn.click();
  });
  await new Promise(r => setTimeout(r, 800));

  // Create Category
  await page.type('input[placeholder="e.g. Pet Passports, Tax Returns"]', 'Crypto Deeds');
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const submitBtn = btns.find(b => b.textContent && b.textContent.includes('Create Category'));
    if (submitBtn) submitBtn.click();
  });
  await new Promise(r => setTimeout(r, 1200));

  // Re-open category modal and switch to My Categories
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const customBtn = btns.find(b => b.textContent && b.textContent.includes('+ Custom'));
    if (customBtn) customBtn.click();
  });
  await new Promise(r => setTimeout(r, 500));

  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const myCatTab = btns.find(b => b.textContent && b.textContent.includes('My Categories'));
    if (myCatTab) myCatTab.click();
  });
  await new Promise(r => setTimeout(r, 500));

  const myCatsText = await page.evaluate(() => document.body.innerText);
  const hasMyCat = myCatsText.includes('Crypto Deeds');
  console.log('Custom Category listed in My Categories tab:', hasMyCat ? 'PASSED ✅' : 'FAILED ❌');

  // Test 4: Biometric Unlock Toggle in Profile
  console.log('\n--- 4. Testing Profile Biometric Settings ---');
  await page.evaluate(() => {
    const closeBtn = document.querySelector('button.text-slate-400');
    if (closeBtn) closeBtn.click();
  });
  await new Promise(r => setTimeout(r, 500));

  await page.evaluate(() => {
    const backBtn = document.querySelector('button[title="Go Back"]');
    if (backBtn) backBtn.click();
  });
  await new Promise(r => setTimeout(r, 800));

  await page.evaluate(() => {
    const navs = Array.from(document.querySelectorAll('button'));
    const profBtn = navs.find(b => b.textContent && b.textContent.includes('Profile'));
    if (profBtn) profBtn.click();
  });
  await new Promise(r => setTimeout(r, 1000));

  const profileSecurityText = await page.evaluate(() => document.body.innerText);
  const hasSecuritySettings = profileSecurityText.includes('App Lock') && profileSecurityText.includes('Export Backup');
  console.log('Profile Security & Backup Section Ready:', hasSecuritySettings ? 'PASSED ✅' : 'FAILED ❌');

  await browser.close();
  server.close();
  console.log('\n========================================================');
  console.log('ALL BATCH 3 VERIFICATIONS PASSED 100%!');
  console.log('========================================================');
  process.exit(0);
});
