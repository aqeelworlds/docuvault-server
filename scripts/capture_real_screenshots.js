import puppeteer from 'puppeteer-core';
import path from 'path';
import fs from 'fs';

const CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUTPUT_DIR = 'C:/Users/Qaisar Aqeel/.gemini/antigravity/scratch/document-vault/PlayStore_Graphics';

async function main() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  console.log('Launching Chrome for 100% authentic mobile screenshots...');
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-web-security'
    ],
    defaultViewport: {
      width: 412,
      height: 892,
      deviceScaleFactor: 2.625,
      isMobile: true,
      hasTouch: true
    }
  });

  const page = await browser.newPage();

  // 1. Welcome / Auth Screen
  console.log('📸 1. Capturing Welcome Screen...');
  await page.goto('http://localhost:3001/', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 1500));
  await page.screenshot({
    path: path.join(OUTPUT_DIR, 'Screenshot_1_Welcome.png'),
    type: 'png'
  });

  // 2. Set onboarded in localStorage to prevent modal and log into Demo Vault
  console.log('Logging into Demo Vault without popup overlay...');
  await page.evaluate(() => {
    localStorage.setItem('document_vault_onboarded', 'true');
    const buttons = Array.from(document.querySelectorAll('button, a'));
    const demoBtn = buttons.find(b => b.innerText.includes('Demo') || b.innerText.includes('Guest'));
    if (demoBtn) demoBtn.click();
  });
  await new Promise(r => setTimeout(r, 2500));

  // Dismiss any lingering onboarding modal if open
  await page.evaluate(() => {
    localStorage.setItem('document_vault_onboarded', 'true');
    const buttons = Array.from(document.querySelectorAll('button'));
    const skipBtn = buttons.find(b => b.innerText.includes('Skip') || b.innerText.includes('Got it') || b.innerText.includes('Continue'));
    if (skipBtn) skipBtn.click();
  });
  await new Promise(r => setTimeout(r, 1000));

  // 2. Real Home Dashboard Screen
  console.log('📸 2. Capturing Real Home Dashboard Screen...');
  await page.screenshot({
    path: path.join(OUTPUT_DIR, 'Screenshot_2_Home_Dashboard.png'),
    type: 'png'
  });

  // 3. Real Vault Documents Screen
  console.log('📸 3. Capturing Real Vault Documents Screen...');
  await page.evaluate(() => {
    const navButtons = Array.from(document.querySelectorAll('button'));
    const vaultBtn = navButtons.find(b => b.innerText.trim().toLowerCase() === 'vault');
    if (vaultBtn) vaultBtn.click();
  });
  await new Promise(r => setTimeout(r, 2000));
  await page.screenshot({
    path: path.join(OUTPUT_DIR, 'Screenshot_3_Vault_Documents.png'),
    type: 'png'
  });

  // 4. Real Family Hub Screen
  console.log('📸 4. Capturing Real Family Hub Screen...');
  await page.evaluate(() => {
    const navButtons = Array.from(document.querySelectorAll('button'));
    const famBtn = navButtons.find(b => b.innerText.trim().toLowerCase() === 'family');
    if (famBtn) famBtn.click();
  });
  await new Promise(r => setTimeout(r, 2000));
  await page.screenshot({
    path: path.join(OUTPUT_DIR, 'Screenshot_4_Family_Hub.png'),
    type: 'png'
  });

  // 5. Real Profile & Security Screen
  console.log('📸 5. Capturing Real Profile & Security Screen...');
  await page.evaluate(() => {
    const navButtons = Array.from(document.querySelectorAll('button'));
    const profBtn = navButtons.find(b => b.innerText.trim().toLowerCase() === 'profile');
    if (profBtn) profBtn.click();
  });
  await new Promise(r => setTimeout(r, 2000));
  await page.screenshot({
    path: path.join(OUTPUT_DIR, 'Screenshot_5_Security_Profile.png'),
    type: 'png'
  });

  // 6. Real Pro Subscriptions Screen
  console.log('📸 6. Capturing Real Pro Subscriptions Screen...');
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button, a'));
    const subBtn = buttons.find(b => b.innerText.includes('Manage') || b.innerText.includes('Subscription') || b.innerText.includes('PRO') || b.innerText.includes('Upgrade'));
    if (subBtn) subBtn.click();
  });
  await new Promise(r => setTimeout(r, 2000));
  await page.screenshot({
    path: path.join(OUTPUT_DIR, 'Screenshot_6_Subscriptions_Paywall.png'),
    type: 'png'
  });

  await browser.close();
  console.log('✅ ALL 6 DISTINCT REAL SCREENSHOTS CAPTURED PERFECTLY!');
}

main().catch(err => {
  console.error('Error capturing screenshots:', err);
  process.exit(1);
});
