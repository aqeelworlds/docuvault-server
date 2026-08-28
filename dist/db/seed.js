import { v4 as uuidv4 } from 'uuid';
import { initDatabase, dbRun, dbGet } from './database.js';
import { hashPassword, hashPin } from '../middleware/auth.js';
import { generateReminderDates } from '../services/expiryService.js';
export async function seedDemoData() {
    await initDatabase();
    const demoEmail = 'demo.family@vault.local';
    const existingUser = await dbGet('SELECT id FROM users WHERE email = ?', [demoEmail]);
    if (existingUser) {
        console.log('Demo account already exists.');
        return;
    }
    console.log('Seeding rich demo family account for Document Vault...');
    const userId = uuidv4();
    const profileId = uuidv4();
    const familyGroupId = uuidv4();
    const ownerMemberId = uuidv4();
    const spouseMemberId = uuidv4();
    const childMemberId = uuidv4();
    const parentMemberId = uuidv4();
    const { hash, salt } = await hashPassword('VaultPass123!');
    const pinHash = hashPin('1234', userId);
    // Insert User
    await dbRun('INSERT INTO users (id, email, password_hash, salt) VALUES (?, ?, ?, ?)', [userId, demoEmail, hash, salt]);
    // Insert Profile with App Lock PIN '1234' configured
    await dbRun(`INSERT INTO profiles (id, user_id, full_name, timezone, app_lock_enabled, app_lock_pin_hash, biometric_enabled)
     VALUES (?, ?, ?, 'America/New_York', 1, ?, 1)`, [profileId, userId, 'Alexander Wright', pinHash]);
    // Insert Pro Subscription
    await dbRun(`INSERT INTO subscriptions (id, user_id, plan_id, status, current_period_end)
     VALUES (?, ?, 'PRO_YEARLY', 'ACTIVE', '2027-08-23T00:00:00Z')`, [uuidv4(), userId]);
    // Insert Notification Preferences
    await dbRun('INSERT INTO notification_preferences (id, user_id, default_lead_days) VALUES (?, ?, ?)', [uuidv4(), userId, '[90, 60, 30, 14, 7, 1]']);
    // Insert Family Group
    await dbRun('INSERT INTO family_groups (id, name, created_by_user_id) VALUES (?, ?, ?)', [familyGroupId, 'Wright Family Vault', userId]);
    // Insert Family Members
    await dbRun('INSERT INTO family_members (id, family_group_id, user_id, name, relationship, role, avatar_color) VALUES (?, ?, ?, ?, ?, ?, ?)', [ownerMemberId, familyGroupId, userId, 'Alexander Wright', 'Self (Primary)', 'OWNER', '#4f46e5']);
    await dbRun('INSERT INTO family_members (id, family_group_id, name, relationship, role, avatar_color) VALUES (?, ?, ?, ?, ?, ?)', [spouseMemberId, familyGroupId, 'Elena Wright', 'Spouse', 'ADMIN', '#ec4899']);
    await dbRun('INSERT INTO family_members (id, family_group_id, name, relationship, role, avatar_color) VALUES (?, ?, ?, ?, ?, ?)', [childMemberId, familyGroupId, 'Leo Wright', 'Child', 'MEMBER', '#3b82f6']);
    await dbRun('INSERT INTO family_members (id, family_group_id, name, relationship, role, avatar_color) VALUES (?, ?, ?, ?, ?, ?)', [parentMemberId, familyGroupId, 'Margaret Wright', 'Mother', 'MEMBER', '#10b981']);
    // Calculate dynamic dates relative to today for realistic demo expiry statuses
    const today = new Date();
    const addDays = (d) => {
        const target = new Date(today.getTime() + d * 24 * 60 * 60 * 1000);
        return target.toISOString().split('T')[0];
    };
    const seedDocs = [
        {
            name: 'International Passport',
            catId: 'cat_travel',
            docNum: 'US-992817402',
            ownerId: ownerMemberId,
            issue: addDays(-1800),
            expiry: addDays(28), // Expiring Soon (28 days)
            authority: 'U.S. Department of State',
            notes: 'Primary biometric travel passport. Needs renewal before upcoming Europe trip.'
        },
        {
            name: 'Driver License (Class C)',
            catId: 'cat_driving',
            docNum: 'DL-WA-881923',
            ownerId: ownerMemberId,
            issue: addDays(-700),
            expiry: addDays(73), // Active (73 days)
            authority: 'Department of Licensing',
            notes: 'Real ID compliant enhanced driver license.'
        },
        {
            name: 'Comprehensive Auto Insurance',
            catId: 'cat_insurance',
            docNum: 'POL-GEICO-9921',
            ownerId: ownerMemberId,
            issue: addDays(-340),
            expiry: addDays(7), // Expiring Soon (7 days - Urgent!)
            authority: 'GEICO Casualty Co.',
            notes: 'Covers 2023 Tesla Model Y and 2021 Subaru Outback. Policy renewal due.'
        },
        {
            name: 'Elena Passport',
            catId: 'cat_travel',
            docNum: 'US-771829011',
            ownerId: spouseMemberId,
            issue: addDays(-1200),
            expiry: addDays(410), // Active (~1.1 years)
            authority: 'U.S. Department of State',
            notes: 'Elena standard passport.'
        },
        {
            name: 'Leo Pediatric Health Card',
            catId: 'cat_health',
            docNum: 'MED-BCBS-1029',
            ownerId: childMemberId,
            issue: addDays(-180),
            expiry: addDays(185), // Active
            authority: 'BlueCross BlueShield',
            notes: 'Pediatric care and immunization coverage.'
        },
        {
            name: 'Vehicle Registration (Tesla Model Y)',
            catId: 'cat_vehicle',
            docNum: 'REG-WA-992-XYZ',
            ownerId: ownerMemberId,
            issue: addDays(-380),
            expiry: addDays(-15), // Expired 15 days ago
            authority: 'State Department of Transportation',
            notes: 'Vehicle tabs expired! Renew online immediately.'
        },
        {
            name: 'Official Birth Certificate',
            catId: 'cat_identity',
            docNum: 'BC-NY-1988-99281',
            ownerId: ownerMemberId,
            issue: '1988-04-12',
            expiry: null,
            hasNoExpiry: 1, // Lifetime valid
            authority: 'New York Vital Statistics Department',
            notes: 'Original certified copy of birth certificate.'
        }
    ];
    for (const item of seedDocs) {
        const docId = uuidv4();
        await dbRun(`INSERT INTO documents (
        id, user_id, family_group_id, owner_member_id, name, document_type_id,
        document_number, issue_date, expiry_date, has_no_expiry, issuing_authority, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
            docId,
            userId,
            familyGroupId,
            item.ownerId,
            item.name,
            item.catId,
            item.docNum,
            item.issue,
            item.expiry,
            item.hasNoExpiry ? 1 : 0,
            item.authority,
            item.notes
        ]);
        // If shared with spouse
        if (item.ownerId === ownerMemberId && item.name.includes('Passport')) {
            await dbRun('INSERT INTO document_permissions (id, document_id, shared_with_member_id, permission_level, granted_by_user_id) VALUES (?, ?, ?, "VIEW", ?)', [uuidv4(), docId, spouseMemberId, userId]);
        }
        // Generate Reminders if expiry is set
        if (!item.hasNoExpiry && item.expiry) {
            const reminders = generateReminderDates(item.expiry, [90, 60, 30, 14, 7, 1]);
            for (const rem of reminders) {
                await dbRun('INSERT INTO reminders (id, document_id, user_id, lead_days, reminder_date, is_active) VALUES (?, ?, ?, ?, ?, 1)', [uuidv4(), docId, userId, rem.leadDays, rem.reminderDate]);
            }
        }
    }
    console.log('✅ Demo account seeded successfully for Document Vault.');
}
