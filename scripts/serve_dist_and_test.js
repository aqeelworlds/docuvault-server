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

server.listen(3005, async () => {
  console.log('Serving client dist on http://localhost:3005...');

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();

  const logs = [];
  const errors = [];

  page.on('console', msg => logs.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', err => errors.push(`[PAGE ERROR]: ${err.message}\n${err.stack}`));

  console.log('Navigating to http://localhost:3005...');
  await page.goto('http://localhost:3005', { waitUntil: 'networkidle0' });

  // Simulate fresh install: clear storage
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload({ waitUntil: 'networkidle0' });

  console.log('Waiting 3.5s for splash screen to finish...');
  await new Promise(r => setTimeout(r, 3500));

  let pageText = await page.evaluate(() => document.body.innerText);
  console.log('=== PAGE TEXT AFTER BOOT ===\n', pageText.substring(0, 300));

  // Try clicking Explore Demo Vault
  console.log('\n--- CLICKING "Explore Demo Vault (1-Click Instant)" ---');
  const clickedDemo = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const demoBtn = buttons.find(b => b.textContent && b.textContent.includes('Explore Demo Vault'));
    if (demoBtn) {
      demoBtn.click();
      return true;
    }
    return false;
  });
  console.log('Clicked Demo Button:', clickedDemo);

  await new Promise(r => setTimeout(r, 2000));
  pageText = await page.evaluate(() => document.body.innerText);
  console.log('=== PAGE TEXT AFTER DEMO CLICK ===\n', pageText.substring(0, 400));

  // Check if Home Screen is rendered
  const isHomeVisible = pageText.includes('Total') && pageText.includes('Alexander');
  console.log('>>> RESULT: Home screen loaded?', isHomeVisible);

  console.log('\n=== BROWSER LOGS ===');
  console.log(logs.join('\n'));

  console.log('\n=== PAGE ERRORS ===');
  console.log(errors.length > 0 ? errors.join('\n') : 'NO PAGE ERRORS!');

  await browser.close();
  server.close();
  process.exit(0);
});
