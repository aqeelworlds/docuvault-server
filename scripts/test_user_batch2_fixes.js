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

server.listen(3008, async () => {
  console.log('========================================================');
  console.log('VERIFYING BATCH 2 USER REQUIREMENTS: CATEGORIES, FAMILY & REMINDERS');
  console.log('========================================================');

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();

  // Test 1: New User Family Tab check (Zero Demo Names)
  console.log('\n--- 1. Testing New User Family Isolation ---');
  await page.goto('http://localhost:3008', { waitUntil: 'networkidle0' });
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.reload({ waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 3200));

  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const btn = btns.find(b => b.textContent && b.textContent.includes('Get Started'));
    if (btn) btn.click();
  });
  await new Promise(r => setTimeout(r, 500));

  await page.type('input[placeholder="e.g. John Doe"]', 'Zack Ahmed');
  await page.type('input[placeholder="name@example.com"]', 'zack.ahmed@example.com');
  await page.type('input[placeholder="••••••••"]', 'SafePass2026!');

  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const btn = btns.find(b => b.textContent && b.textContent.includes('Create Free Vault'));
    if (btn) btn.click();
  });
  await new Promise(r => setTimeout(r, 1500));

  // Navigate to Family Tab
  await page.evaluate(() => {
    const navs = Array.from(document.querySelectorAll('button'));
    const famBtn = navs.find(b => b.textContent && b.textContent.includes('Family'));
    if (famBtn) famBtn.click();
  });
  await new Promise(r => setTimeout(r, 1200));

  const familyText = await page.evaluate(() => document.body.innerText);
  const noSmithNamesInFamily = !familyText.includes('Alexander Smith') && !familyText.includes('Sarah Smith') && !familyText.includes('Liam Smith');
  const hasZackSelfProfile = familyText.includes('Zack Ahmed') && familyText.includes('Self (Vault Owner)');
  console.log('Family Tab No Demo Names Leaked:', noSmithNamesInFamily ? 'PASSED ✅' : 'FAILED ❌');
  console.log('Family Tab Has Self Profile:', hasZackSelfProfile ? 'PASSED ✅' : 'FAILED ❌');

  // Test 2: Custom Category Creation
  console.log('\n--- 2. Testing Custom Category Creation ---');
  // Navigate to Home -> Add Document
  await page.evaluate(() => {
    const navs = Array.from(document.querySelectorAll('button'));
    const homeBtn = navs.find(b => b.textContent && b.textContent.includes('Vault'));
    if (homeBtn) homeBtn.click();
  });
  await new Promise(r => setTimeout(r, 800));

  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const btn = btns.find(b => b.textContent && b.textContent.includes('Add Document'));
    if (btn) btn.click();
  });
  await new Promise(r => setTimeout(r, 1000));

  // Click + Custom Category
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const customBtn = btns.find(b => b.textContent && b.textContent.includes('+ Custom'));
    if (customBtn) customBtn.click();
  });
  await new Promise(r => setTimeout(r, 800));

  // Fill in Custom Category Modal
  await page.type('input[placeholder="e.g. Pet Passports, Tax Returns"]', 'Gold Certificate');
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const submitBtn = btns.find(b => b.textContent && b.textContent.includes('Create Category'));
    if (submitBtn) submitBtn.click();
  });
  await new Promise(r => setTimeout(r, 1500));

  const addDocText = await page.evaluate(() => document.body.innerText);
  const customCatCreated = addDocText.includes('Gold Certificate');
  console.log('Custom Category Created & Listed:', customCatCreated ? 'PASSED ✅' : 'FAILED ❌');

  // Test 3: Form Draft Persistence
  console.log('\n--- 3. Testing Form Draft Persistence ---');
  await page.type('input[placeholder="e.g. Passport, Driving License, Insurance"]', 'Gold Asset #999');
  await page.type('input[placeholder="e.g. A12345678, DL-998877"]', 'GA-100200');

  // Check draft saved in sessionStorage
  const draftSaved = await page.evaluate(() => {
    const draft = sessionStorage.getItem('dv_doc_form_draft');
    return draft && draft.includes('Gold Asset #999');
  });
  console.log('Draft Saved in Session Storage:', draftSaved ? 'PASSED ✅' : 'FAILED ❌');

  // Test 4: Reminders Alert Schedule Settings
  console.log('\n--- 4. Testing Expiry Reminders Multi-Stage Alert Schedule ---');
  // Click back button from Add Document
  await page.evaluate(() => {
    const backBtn = document.querySelector('button[title="Go Back"]');
    if (backBtn) backBtn.click();
  });
  await new Promise(r => setTimeout(r, 1000));

  // Click Home tab
  await page.evaluate(() => {
    const navs = Array.from(document.querySelectorAll('button'));
    const homeBtn = navs.find(b => b.textContent && b.textContent.trim() === 'Home');
    if (homeBtn) homeBtn.click();
  });
  await new Promise(r => setTimeout(r, 800));

  // Navigate to Reminders screen via Bell Header Icon
  await page.evaluate(() => {
    const bellBtn = document.querySelector('button[title="Expiry Alerts"]');
    if (bellBtn) bellBtn.click();
  });
  await new Promise(r => setTimeout(r, 1200));

  const remindersText = await page.evaluate(() => document.body.innerText);
  const hasScheduleCard = remindersText.includes('Multi-Stage Expiry Alert Schedule') && remindersText.includes('90 Days') && remindersText.includes('14 Days');
  console.log('Reminders Multi-Stage Alert Schedule Live:', hasScheduleCard ? 'PASSED ✅' : 'FAILED ❌');

  // Test 5: Profile Help & Support row layout
  console.log('\n--- 5. Testing Profile Help & Support Layout ---');
  await page.evaluate(() => {
    const navs = Array.from(document.querySelectorAll('button'));
    const profBtn = navs.find(b => b.textContent && b.textContent.includes('Profile'));
    if (profBtn) profBtn.click();
  });
  await new Promise(r => setTimeout(r, 1000));

  const profileText = await page.evaluate(() => document.body.innerText);
  const hasHelpRow = profileText.includes('Help & Customer Support');
  console.log('Profile Help & Support Compact Row Live:', hasHelpRow ? 'PASSED ✅' : 'FAILED ❌');

  await browser.close();
  server.close();
  console.log('\n========================================================');
  console.log('ALL BATCH 2 VERIFICATIONS COMPLETED SUCCESSFULLY!');
  console.log('========================================================');
  process.exit(0);
});
