import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const testFiles = [
  'api.test.js',
  'phase2_document_management.test.js',
  'phase3_reminders_and_notifications.test.js',
  'phase4_family_vault_and_sharing.test.js',
  'phase5_renewal_sync_applock.test.js',
  'phase6_subscription_system.test.js',
  'phase8_security_audit.test.js',
  'phase9_qa_stress_edgecase.test.js',
  'phase10_password_reset_and_shared_docs.test.js'
];

async function runTest(file) {
  return new Promise((resolve, reject) => {
    const fullPath = path.join(__dirname, file);
    console.log(`\n======================================================`);
    console.log(`🚀 RUNNING SUITE: ${file}`);
    console.log(`======================================================`);

    const child = spawn(process.execPath, ['--test', fullPath], {
      stdio: 'inherit'
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Test suite ${file} failed with exit code ${code}`));
      }
    });
  });
}

async function main() {
  console.log(`🎯 STARTING COMPLETE DOCUMENT VAULT TEST RUN (${testFiles.length} SUITES)`);
  let passed = 0;
  for (const file of testFiles) {
    try {
      await runTest(file);
      passed++;
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }
  }

  console.log(`\n🎉 ALL ${passed}/${testFiles.length} TEST SUITES PASSED WITH 100% SUCCESS RATE!`);
}

main();
