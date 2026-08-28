import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { dbGet, dbRun, dbAll, VAULT_DIR } from '../db/database.js';
import { calculateExpiryMetrics, generateReminderDates } from '../services/expiryService.js';
import { checkUserIsPro } from './subscriptionController.js';
export async function getDocuments(req, res) {
    try {
        const userId = req.user.id;
        const { search, category, status, memberId, sortBy } = req.query;
        // Find family member ID for current user
        const userMember = await dbGet('SELECT id FROM family_members WHERE user_id = ?', [userId]);
        const userMemberId = userMember ? userMember.id : '';
        // Fetch documents owned by user OR shared with user
        const sql = `
      SELECT DISTINCT
        d.id, d.user_id, d.family_group_id, d.owner_member_id, d.name, d.document_type_id,
        d.document_number, d.issue_date, d.expiry_date, d.has_no_expiry, d.issuing_authority,
        d.notes, d.is_archived, d.archived_at, d.created_at, d.updated_at,
        dt.name as category_name, dt.slug as category_slug, dt.icon as category_icon, dt.color as category_color,
        fm.name as owner_name, fm.relationship as owner_relationship, fm.avatar_color as owner_avatar_color,
        (CASE WHEN d.user_id = ? THEN 'OWNER' ELSE COALESCE(dp.permission_level, 'VIEW') END) as user_permission,
        (SELECT COUNT(*) FROM document_attachments WHERE document_id = d.id) as attachment_count,
        (SELECT file_name FROM document_attachments WHERE document_id = d.id ORDER BY is_primary DESC, created_at ASC LIMIT 1) as primary_file_name,
        (SELECT mime_type FROM document_attachments WHERE document_id = d.id ORDER BY is_primary DESC, created_at ASC LIMIT 1) as primary_mime_type,
        (SELECT id FROM document_attachments WHERE document_id = d.id ORDER BY is_primary DESC, created_at ASC LIMIT 1) as primary_attachment_id
      FROM documents d
      LEFT JOIN document_types dt ON d.document_type_id = dt.id
      LEFT JOIN family_members fm ON d.owner_member_id = fm.id
      LEFT JOIN document_permissions dp ON (dp.document_id = d.id AND dp.shared_with_member_id = ?)
      WHERE d.user_id = ? OR dp.shared_with_member_id = ?
    `;
        const rawDocs = await dbAll(sql, [userId, userMemberId, userId, userMemberId]);
        // Deterministically enrich documents with expiry calculation
        const enrichedDocs = rawDocs.map(doc => {
            const metrics = calculateExpiryMetrics(doc.expiry_date, Boolean(doc.has_no_expiry));
            return {
                ...doc,
                has_no_expiry: Boolean(doc.has_no_expiry),
                is_archived: Boolean(doc.is_archived),
                status: metrics.status,
                daysRemaining: metrics.daysRemaining,
                urgencyLevel: metrics.urgencyLevel,
                formattedRemaining: metrics.formattedRemaining,
                isExpired: metrics.isExpired,
                isExpiringSoon: metrics.isExpiringSoon
            };
        });
        // Compute summary stats for ACTIVE (non-archived) documents
        const activeDocs = enrichedDocs.filter(d => !d.is_archived);
        const summary = {
            total: activeDocs.length,
            expiringSoon: activeDocs.filter(d => d.status === 'EXPIRING_SOON').length,
            expired: activeDocs.filter(d => d.status === 'EXPIRED').length,
            upToDate: activeDocs.filter(d => d.status === 'ACTIVE' || d.status === 'LIFETIME').length,
            archived: enrichedDocs.filter(d => d.is_archived).length
        };
        // Filter by archive state
        let filtered = enrichedDocs;
        if (status === 'archived') {
            filtered = filtered.filter(d => d.is_archived);
        }
        else {
            // Default: exclude archived
            filtered = filtered.filter(d => !d.is_archived);
        }
        // Apply Search
        if (search && typeof search === 'string' && search.trim() !== '') {
            const q = search.toLowerCase().trim();
            filtered = filtered.filter(d => (d.name && d.name.toLowerCase().includes(q)) ||
                (d.document_number && d.document_number.toLowerCase().includes(q)) ||
                (d.issuing_authority && d.issuing_authority.toLowerCase().includes(q)) ||
                (d.owner_name && d.owner_name.toLowerCase().includes(q)) ||
                (d.category_name && d.category_name.toLowerCase().includes(q)) ||
                (d.notes && d.notes.toLowerCase().includes(q)));
        }
        // Category filter
        if (category && typeof category === 'string' && category !== 'all') {
            filtered = filtered.filter(d => d.document_type_id === category || d.category_slug === category);
        }
        // Status filter
        if (status && typeof status === 'string' && status !== 'all' && status !== 'archived') {
            const targetStatus = status.toUpperCase();
            if (targetStatus === 'ACTIVE') {
                filtered = filtered.filter(d => d.status === 'ACTIVE' || d.status === 'LIFETIME');
            }
            else {
                filtered = filtered.filter(d => d.status === targetStatus);
            }
        }
        // Family Member filter
        if (memberId && typeof memberId === 'string' && memberId !== 'all') {
            filtered = filtered.filter(d => d.owner_member_id === memberId);
        }
        // Deterministic Sorting
        filtered.sort((a, b) => {
            if (sortBy === 'expiry_asc') {
                if (a.has_no_expiry && !b.has_no_expiry)
                    return 1;
                if (!a.has_no_expiry && b.has_no_expiry)
                    return -1;
                return (a.daysRemaining ?? 99999) - (b.daysRemaining ?? 99999);
            }
            else if (sortBy === 'expiry_desc') {
                return (b.daysRemaining ?? -99999) - (a.daysRemaining ?? -99999);
            }
            else if (sortBy === 'name_asc') {
                return (a.name || '').localeCompare(b.name || '');
            }
            else if (sortBy === 'name_desc') {
                return (b.name || '').localeCompare(a.name || '');
            }
            else if (sortBy === 'updated_desc') {
                return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
            }
            else {
                // Default: created_desc
                return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
            }
        });
        res.json({
            documents: filtered,
            summary
        });
    }
    catch (error) {
        console.error('getDocuments error:', error);
        res.status(500).json({ error: 'Failed to fetch documents', details: error.message });
    }
}
export async function getDocumentById(req, res) {
    try {
        const documentId = req.params.id;
        const access = req.docAccess;
        const doc = access.document;
        const metrics = calculateExpiryMetrics(doc.expiry_date, Boolean(doc.has_no_expiry));
        // Get attachments metadata
        const attachments = await dbAll('SELECT id, file_name, file_size, mime_type, is_primary, created_at FROM document_attachments WHERE document_id = ? ORDER BY is_primary DESC, created_at ASC', [documentId]);
        // Get active reminders
        const reminders = await dbAll('SELECT id, lead_days, reminder_date, is_active, is_triggered FROM reminders WHERE document_id = ? ORDER BY lead_days DESC', [documentId]);
        // Get renewal history
        const renewalHistory = await dbAll(`SELECT rh.*, u.email as renewed_by_email, p.full_name as renewed_by_name
       FROM renewal_history rh
       LEFT JOIN users u ON rh.renewed_by_user_id = u.id
       LEFT JOIN profiles p ON u.id = p.user_id
       WHERE rh.document_id = ?
       ORDER BY rh.created_at DESC`, [documentId]);
        // Get activity history
        const activity = await dbAll(`SELECT ah.*, p.full_name as user_name
       FROM activity_history ah
       LEFT JOIN profiles p ON ah.user_id = p.user_id
       WHERE ah.document_id = ?
       ORDER BY ah.created_at DESC`, [documentId]);
        // Get shared permissions (if owner)
        let permissions = [];
        if (access.isOwner) {
            permissions = await dbAll(`SELECT dp.*, fm.name as member_name, fm.relationship, fm.avatar_color
         FROM document_permissions dp
         JOIN family_members fm ON dp.shared_with_member_id = fm.id
         WHERE dp.document_id = ?`, [documentId]);
        }
        res.json({
            document: {
                ...doc,
                has_no_expiry: Boolean(doc.has_no_expiry),
                is_archived: Boolean(doc.is_archived),
                status: metrics.status,
                daysRemaining: metrics.daysRemaining,
                urgencyLevel: metrics.urgencyLevel,
                formattedRemaining: metrics.formattedRemaining,
                isExpired: metrics.isExpired,
                isExpiringSoon: metrics.isExpiringSoon,
                user_permission: access.permissionLevel,
                userPermission: access.permissionLevel,
                is_owner: access.isOwner,
                isOwner: access.isOwner,
                can_edit: access.isOwner || access.permissionLevel === 'EDIT',
                canEdit: access.isOwner || access.permissionLevel === 'EDIT',
                attachments,
                reminders,
                renewalHistory,
                activity,
                permissions
            }
        });
    }
    catch (error) {
        console.error('getDocumentById error:', error);
        res.status(500).json({ error: 'Failed to retrieve document', details: error.message });
    }
}
export async function createDocument(req, res) {
    try {
        const userId = req.user.id;
        const { name, documentTypeId, documentNumber, ownerMemberId, issueDate, expiryDate, hasNoExpiry, issuingAuthority, notes, reminders: customLeadDays } = req.body;
        const docTypeId = documentTypeId || req.body.document_type_id;
        const docNumber = documentNumber || req.body.document_number;
        const ownMemberId = ownerMemberId || req.body.owner_member_id;
        const issDate = issueDate || req.body.issue_date;
        const expDate = expiryDate || req.body.expiry_date;
        const isNoExpiry = hasNoExpiry === 'true' || hasNoExpiry === true || req.body.has_no_expiry === 'true' || req.body.has_no_expiry === true || req.body.has_no_expiry === 1;
        const issAuth = issuingAuthority || req.body.issuing_authority;
        // Validate name
        if (!name || typeof name !== 'string' || name.trim() === '') {
            res.status(400).json({ error: 'Document name is required' });
            return;
        }
        if (name.trim().length > 150) {
            res.status(400).json({ error: 'Document name cannot exceed 150 characters' });
            return;
        }
        // Validate category
        if (!docTypeId) {
            res.status(400).json({ error: 'Document category is required' });
            return;
        }
        if (!isNoExpiry && (!expDate || typeof expDate !== 'string')) {
            res.status(400).json({ error: 'Expiry date is required unless Lifetime / No Expiry is selected' });
            return;
        }
        // Date Range Validation: Issue Date cannot be after Expiry Date
        if (issueDate && expiryDate && !isNoExpiry) {
            const issueTime = new Date(issueDate).getTime();
            const expiryTime = new Date(expiryDate).getTime();
            if (issueTime > expiryTime) {
                res.status(400).json({
                    error: 'Issue date cannot be after expiry date',
                    code: 'INVALID_DATE_RANGE'
                });
                return;
            }
        }
        // Field length limits
        if (documentNumber && documentNumber.trim().length > 100) {
            res.status(400).json({ error: 'Document number cannot exceed 100 characters' });
            return;
        }
        if (issuingAuthority && issuingAuthority.trim().length > 150) {
            res.status(400).json({ error: 'Issuing authority cannot exceed 150 characters' });
            return;
        }
        if (notes && notes.trim().length > 2000) {
            res.status(400).json({ error: 'Notes cannot exceed 2000 characters' });
            return;
        }
        // Check Entitlement / Free Tier Limit
        const isPro = await checkUserIsPro(userId);
        if (!isPro) {
            const docCountRow = await dbGet('SELECT COUNT(*) as count FROM documents WHERE user_id = ? AND is_archived = 0', [userId]);
            const currentCount = docCountRow?.count || 0;
            if (currentCount >= 5) {
                res.status(403).json({
                    error: 'Free plan limit reached (maximum 5 documents). Upgrade to Document Vault Pro for unlimited storage.',
                    code: 'PLAN_LIMIT_REACHED',
                    limit: 5,
                    current: currentCount
                });
                return;
            }
        }
        // Find user's family group ID and resolve default owner member if not provided
        const userMember = await dbGet('SELECT id, family_group_id FROM family_members WHERE user_id = ?', [userId]);
        const familyGroupId = userMember?.family_group_id || null;
        const resolvedOwnerMemberId = ownMemberId || userMember?.id || null;
        // Resolve category safely (accepts ID or slug, falls back to cat_identity/cat_other)
        let resolvedTypeId = docTypeId || 'cat_identity';
        const existingType = await dbGet('SELECT id FROM document_types WHERE id = ? OR slug = ?', [resolvedTypeId, resolvedTypeId]);
        if (existingType) {
            resolvedTypeId = existingType.id;
        }
        else {
            resolvedTypeId = 'cat_identity';
        }
        const documentId = uuidv4();
        // Insert Document
        await dbRun(`INSERT INTO documents (
        id, user_id, family_group_id, owner_member_id, name, document_type_id,
        document_number, issue_date, expiry_date, has_no_expiry, issuing_authority, notes,
        is_archived, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`, [
            documentId,
            userId,
            familyGroupId,
            resolvedOwnerMemberId,
            name.trim(),
            resolvedTypeId,
            docNumber ? docNumber.trim() : null,
            issDate || null,
            isNoExpiry ? null : expDate,
            isNoExpiry ? 1 : 0,
            issAuth ? issAuth.trim() : null,
            notes ? notes.trim() : null
        ]);
        // Handle uploaded attachment if present
        if (req.file) {
            const attachmentId = uuidv4();
            await dbRun(`INSERT INTO document_attachments (
          id, document_id, file_name, file_size, mime_type, file_path, is_primary
        ) VALUES (?, ?, ?, ?, ?, ?, 1)`, [
                attachmentId,
                documentId,
                req.file.originalname,
                req.file.size,
                req.file.mimetype,
                req.file.filename
            ]);
        }
        // Generate Reminders if expiry is set
        if (!isNoExpiry && expiryDate) {
            let leadDaysList = [90, 60, 30, 14, 7, 1];
            if (customLeadDays) {
                try {
                    const parsed = typeof customLeadDays === 'string' ? JSON.parse(customLeadDays) : customLeadDays;
                    if (Array.isArray(parsed) && parsed.length > 0) {
                        leadDaysList = parsed.map(Number).filter(n => !isNaN(n) && n > 0);
                    }
                }
                catch { }
            }
            const remindersToCreate = generateReminderDates(expiryDate, leadDaysList);
            for (const rem of remindersToCreate) {
                await dbRun('INSERT INTO reminders (id, document_id, user_id, lead_days, reminder_date, is_active) VALUES (?, ?, ?, ?, ?, 1)', [uuidv4(), documentId, userId, rem.leadDays, rem.reminderDate]);
            }
        }
        // Log activity
        await dbRun('INSERT INTO activity_history (id, document_id, user_id, action_type, description) VALUES (?, ?, ?, ?, ?)', [uuidv4(), documentId, userId, 'CREATED', `Added document "${name.trim()}"`]);
        res.status(201).json({
            message: 'Document created successfully',
            documentId
        });
    }
    catch (error) {
        console.error('createDocument error:', error);
        res.status(500).json({ error: 'Failed to create document', details: error.message });
    }
}
export async function updateDocument(req, res) {
    try {
        const documentId = req.params.id;
        const userId = req.user.id;
        const { name, documentTypeId, documentNumber, ownerMemberId, issueDate, expiryDate, hasNoExpiry, issuingAuthority, notes } = req.body;
        if (!name || typeof name !== 'string' || name.trim() === '') {
            res.status(400).json({ error: 'Document name is required' });
            return;
        }
        if (name.trim().length > 150) {
            res.status(400).json({ error: 'Document name cannot exceed 150 characters' });
            return;
        }
        const isNoExpiry = hasNoExpiry === 'true' || hasNoExpiry === true;
        if (!isNoExpiry && (!expiryDate || typeof expiryDate !== 'string')) {
            res.status(400).json({ error: 'Expiry date is required unless Lifetime / No Expiry is selected' });
            return;
        }
        // Date Range Validation
        if (issueDate && expiryDate && !isNoExpiry) {
            const issueTime = new Date(issueDate).getTime();
            const expiryTime = new Date(expiryDate).getTime();
            if (issueTime > expiryTime) {
                res.status(400).json({
                    error: 'Issue date cannot be after expiry date',
                    code: 'INVALID_DATE_RANGE'
                });
                return;
            }
        }
        if (documentNumber && documentNumber.trim().length > 100) {
            res.status(400).json({ error: 'Document number cannot exceed 100 characters' });
            return;
        }
        if (issuingAuthority && issuingAuthority.trim().length > 150) {
            res.status(400).json({ error: 'Issuing authority cannot exceed 150 characters' });
            return;
        }
        if (notes && notes.trim().length > 2000) {
            res.status(400).json({ error: 'Notes cannot exceed 2000 characters' });
            return;
        }
        const previousDoc = req.docAccess.document;
        const expiryChanged = previousDoc.expiry_date !== expiryDate || Boolean(previousDoc.has_no_expiry) !== isNoExpiry;
        let resolvedTypeId = documentTypeId || previousDoc.document_type_id;
        const existingType = await dbGet('SELECT id FROM document_types WHERE id = ? OR slug = ?', [resolvedTypeId, resolvedTypeId]);
        if (existingType) {
            resolvedTypeId = existingType.id;
        }
        else {
            resolvedTypeId = previousDoc.document_type_id || 'cat_identity';
        }
        await dbRun(`UPDATE documents SET
        name = ?, document_type_id = ?, document_number = ?, owner_member_id = ?,
        issue_date = ?, expiry_date = ?, has_no_expiry = ?, issuing_authority = ?, notes = ?,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`, [
            name.trim(),
            resolvedTypeId,
            documentNumber ? documentNumber.trim() : null,
            ownerMemberId || previousDoc.owner_member_id,
            issueDate || null,
            isNoExpiry ? null : expiryDate,
            isNoExpiry ? 1 : 0,
            issuingAuthority ? issuingAuthority.trim() : null,
            notes ? notes.trim() : null,
            documentId
        ]);
        // If attachment was uploaded, attach it
        if (req.file) {
            const attachmentId = uuidv4();
            await dbRun(`INSERT INTO document_attachments (
          id, document_id, file_name, file_size, mime_type, file_path, is_primary
        ) VALUES (?, ?, ?, ?, ?, ?, 0)`, [
                attachmentId,
                documentId,
                req.file.originalname,
                req.file.size,
                req.file.mimetype,
                req.file.filename
            ]);
        }
        // If expiry date changed, recalculate all existing active reminders
        if (expiryChanged) {
            if (isNoExpiry) {
                // Deactivate reminders for lifetime document
                await dbRun('UPDATE reminders SET is_active = 0 WHERE document_id = ?', [documentId]);
            }
            else if (expiryDate) {
                const existingReminders = await dbAll('SELECT id, lead_days FROM reminders WHERE document_id = ?', [documentId]);
                if (existingReminders.length > 0) {
                    const newDates = generateReminderDates(expiryDate, existingReminders.map(r => r.lead_days));
                    for (const rem of newDates) {
                        await dbRun('UPDATE reminders SET reminder_date = ?, is_active = 1, is_triggered = 0 WHERE document_id = ? AND lead_days = ?', [rem.reminderDate, documentId, rem.leadDays]);
                    }
                }
                else {
                    // Generate standard reminders
                    const remindersToCreate = generateReminderDates(expiryDate, [90, 60, 30, 14, 7, 1]);
                    for (const rem of remindersToCreate) {
                        await dbRun('INSERT INTO reminders (id, document_id, user_id, lead_days, reminder_date, is_active) VALUES (?, ?, ?, ?, ?, 1)', [uuidv4(), documentId, userId, rem.leadDays, rem.reminderDate]);
                    }
                }
            }
        }
        // Log activity
        await dbRun('INSERT INTO activity_history (id, document_id, user_id, action_type, description) VALUES (?, ?, ?, ?, ?)', [uuidv4(), documentId, userId, 'UPDATED', `Updated details for "${name.trim()}"`]);
        res.json({ message: 'Document updated successfully' });
    }
    catch (error) {
        console.error('updateDocument error:', error);
        res.status(500).json({ error: 'Failed to update document', details: error.message });
    }
}
export async function archiveDocument(req, res) {
    try {
        const documentId = req.params.id;
        const userId = req.user.id;
        const docName = req.docAccess?.document?.name || 'Document';
        await dbRun('UPDATE documents SET is_archived = 1, archived_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [documentId]);
        // Deactivate active reminders while archived
        await dbRun('UPDATE reminders SET is_active = 0 WHERE document_id = ?', [documentId]);
        // Log activity
        await dbRun('INSERT INTO activity_history (id, document_id, user_id, action_type, description) VALUES (?, ?, ?, ?, ?)', [uuidv4(), documentId, userId, 'UPDATED', `Archived document "${docName}"`]);
        res.json({ message: 'Document archived successfully' });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to archive document', details: error.message });
    }
}
export async function unarchiveDocument(req, res) {
    try {
        const documentId = req.params.id;
        const userId = req.user.id;
        const doc = req.docAccess.document;
        await dbRun('UPDATE documents SET is_archived = 0, archived_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [documentId]);
        // Reactivate reminders if document is not expired and has expiry
        if (!doc.has_no_expiry && doc.expiry_date) {
            await dbRun('UPDATE reminders SET is_active = 1 WHERE document_id = ?', [documentId]);
        }
        // Log activity
        await dbRun('INSERT INTO activity_history (id, document_id, user_id, action_type, description) VALUES (?, ?, ?, ?, ?)', [uuidv4(), documentId, userId, 'UPDATED', `Unarchived document "${doc.name}"`]);
        res.json({ message: 'Document unarchived successfully' });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to unarchive document', details: error.message });
    }
}
export async function renewDocument(req, res) {
    try {
        const documentId = req.params.id;
        const userId = req.user.id;
        const { newIssueDate, newExpiryDate, newDocumentNumber, issuingAuthority, renewalNotes } = req.body;
        if (!newExpiryDate || typeof newExpiryDate !== 'string') {
            res.status(400).json({ error: 'New expiry date is required for renewal' });
            return;
        }
        // Date Range Validation for Renewal
        if (newIssueDate && newExpiryDate) {
            const issueTime = new Date(newIssueDate).getTime();
            const expiryTime = new Date(newExpiryDate).getTime();
            if (issueTime > expiryTime) {
                res.status(400).json({
                    error: 'New issue date cannot be after new expiry date',
                    code: 'INVALID_DATE_RANGE'
                });
                return;
            }
        }
        const previousDoc = req.docAccess.document;
        // Insert Renewal History Record
        await dbRun(`INSERT INTO renewal_history (
        id, document_id, previous_expiry_date, new_expiry_date,
        previous_doc_number, new_doc_number, renewed_by_user_id, renewal_notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [
            uuidv4(),
            documentId,
            previousDoc.expiry_date,
            newExpiryDate,
            previousDoc.document_number,
            newDocumentNumber ? newDocumentNumber.trim() : previousDoc.document_number,
            userId,
            renewalNotes ? renewalNotes.trim() : 'Document renewed'
        ]);
        // Update document record
        await dbRun(`UPDATE documents SET
        issue_date = ?, expiry_date = ?, document_number = ?,
        issuing_authority = ?, has_no_expiry = 0, is_archived = 0,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`, [
            newIssueDate || previousDoc.issue_date,
            newExpiryDate,
            newDocumentNumber ? newDocumentNumber.trim() : previousDoc.document_number,
            issuingAuthority ? issuingAuthority.trim() : previousDoc.issuing_authority,
            documentId
        ]);
        // Attach optional new file
        if (req.file) {
            const attachmentId = uuidv4();
            await dbRun(`INSERT INTO document_attachments (
          id, document_id, file_name, file_size, mime_type, file_path, is_primary
        ) VALUES (?, ?, ?, ?, ?, ?, 1)`, [
                attachmentId,
                documentId,
                req.file.originalname,
                req.file.size,
                req.file.mimetype,
                req.file.filename
            ]);
        }
        // Reset and recalculate reminders for the new expiry date
        const existingReminders = await dbAll('SELECT id, lead_days FROM reminders WHERE document_id = ?', [documentId]);
        const leadDays = existingReminders.length > 0 ? existingReminders.map(r => r.lead_days) : [90, 60, 30, 14, 7, 1];
        const newDates = generateReminderDates(newExpiryDate, leadDays);
        await dbRun('DELETE FROM reminders WHERE document_id = ?', [documentId]);
        for (const rem of newDates) {
            await dbRun('INSERT INTO reminders (id, document_id, user_id, lead_days, reminder_date, is_active) VALUES (?, ?, ?, ?, ?, 1)', [uuidv4(), documentId, userId, rem.leadDays, rem.reminderDate]);
        }
        // Record activity
        await dbRun('INSERT INTO activity_history (id, document_id, user_id, action_type, description) VALUES (?, ?, ?, ?, ?)', [uuidv4(), documentId, userId, 'RENEWED', `Renewed document from ${previousDoc.expiry_date || 'N/A'} to ${newExpiryDate}`]);
        res.json({
            message: 'Document renewed successfully',
            newExpiryDate
        });
    }
    catch (error) {
        console.error('renewDocument error:', error);
        res.status(500).json({ error: 'Failed to renew document', details: error.message });
    }
}
export async function deleteDocument(req, res) {
    try {
        const documentId = req.params.id;
        const userId = req.user.id;
        const docName = req.docAccess?.document?.name || 'Document';
        // Delete attachment files from vault directory
        const attachments = await dbAll('SELECT file_path FROM document_attachments WHERE document_id = ?', [documentId]);
        for (const att of attachments) {
            const fullPath = path.resolve(VAULT_DIR, att.file_path);
            if (fs.existsSync(fullPath)) {
                try {
                    fs.unlinkSync(fullPath);
                }
                catch { }
            }
        }
        // Delete document from DB (cascades to attachments, reminders, permissions, history)
        await dbRun('DELETE FROM documents WHERE id = ?', [documentId]);
        // Record activity
        await dbRun('INSERT INTO activity_history (id, user_id, action_type, description) VALUES (?, ?, ?, ?)', [uuidv4(), userId, 'UPDATED', `Deleted document "${docName}"`]);
        res.json({ message: 'Document deleted successfully' });
    }
    catch (error) {
        console.error('deleteDocument error:', error);
        res.status(500).json({ error: 'Failed to delete document', details: error.message });
    }
}
