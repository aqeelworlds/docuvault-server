import puppeteer from 'puppeteer-core';

const CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

(async () => {
  console.log('--- STARTING DIAGNOSTIC TEST ON CLIENT DIST / DEV ---');
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();

  page.on('console', msg => console.log(`[PAGE ${msg.type().toUpperCase()}]:`, msg.text()));
  page.on('pageerror', err => console.error('[PAGE ERROR CRASH]:', err.message, err.stack));

  console.log('Navigating to http://localhost:3001...');
  await page.goto('http://localhost:3001', { waitUntil: 'networkidle0' });

  // Simulate fresh install: clear localStorage and sessionStorage
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload({ waitUntil: 'networkidle0' });

  console.log('Waiting 3.5s for splash screen to finish...');
  await new Promise(r => setTimeout(r, 3500));

  let pageText = await page.evaluate(() => document.body.innerText);
  console.log('Page Text after splash:\n', pageText.substring(0, 300));

  // Find and click "Explore Demo Vault"
  console.log('\n--- CLICKING "Explore Demo Vault" ---');
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

  await new Promise(r => setTimeout(r, 1500));
  pageText = await page.evaluate(() => document.body.innerText);
  console.log('Page Text after clicking Demo:\n', pageText.substring(0, 300));

  // Check if Home is loaded
  const hasAlexander = pageText.includes('Alexander') || pageText.includes('Total') || pageText.includes('Passport');
  console.log('\n>>> SUCCESS? Home vault loaded with Alexander/Documents:', hasAlexander);

  await browser.close();
  console.log('--- DIAGNOSTIC FINISHED ---');
})();
