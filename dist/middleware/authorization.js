import { dbGet, dbRun } from '../db/database.js';
/**
 * Resolves user's access level for a specific document.
 */
export async function getDocumentAccess(userId, documentId) {
    const doc = await dbGet(`SELECT d.*, dt.name as category_name, dt.slug as category_slug, dt.icon as category_icon, dt.color as category_color,
            fm.name as owner_name, fm.relationship as owner_relationship
     FROM documents d
     LEFT JOIN document_types dt ON d.document_type_id = dt.id
     LEFT JOIN family_members fm ON d.owner_member_id = fm.id
     WHERE d.id = ?`, [documentId]);
    if (!doc)
        return null;
    // If user owns the document directly
    if (doc.user_id === userId) {
        return {
            documentId,
            isOwner: true,
            permissionLevel: 'OWNER',
            document: doc
        };
    }
    // Get current user's email
    const userObj = await dbGet('SELECT id, email FROM users WHERE id = ?', [userId]);
    const userEmail = userObj?.email ? userObj.email.toLowerCase().trim() : '';
    // Auto-link any unlinked family_members with this email
    if (userEmail) {
        await dbRun('UPDATE family_members SET user_id = ? WHERE (user_id IS NULL OR user_id = "") AND LOWER(email) = ?', [userId, userEmail]);
    }
    // Check if current user is an OWNER of the family group the document belongs to
    if (doc.family_group_id) {
        const ownerMember = await dbGet('SELECT id, role FROM family_members WHERE family_group_id = ? AND (user_id = ? OR (email IS NOT NULL AND LOWER(email) = ?)) AND role = "OWNER"', [doc.family_group_id, userId, userEmail]);
        if (ownerMember) {
            return {
                documentId,
                isOwner: true,
                permissionLevel: 'OWNER',
                document: doc
            };
        }
    }
    // Check if document was shared with this user (via any linked member record or email)
    const perm = await dbGet(`SELECT dp.permission_level
     FROM document_permissions dp
     JOIN family_members fm ON dp.shared_with_member_id = fm.id
     WHERE dp.document_id = ? 
       AND (
         fm.user_id = ? 
         OR (fm.email IS NOT NULL AND LOWER(fm.email) = ?)
       )
     ORDER BY CASE WHEN dp.permission_level = 'EDIT' THEN 1 ELSE 2 END ASC`, [documentId, userId, userEmail]);
    if (perm && (perm.permission_level === 'VIEW' || perm.permission_level === 'EDIT')) {
        return {
            documentId,
            isOwner: false,
            permissionLevel: perm.permission_level,
            document: doc
        };
    }
    // Check if user is the assigned owner_member_id of the document
    if (doc.owner_member_id) {
        const isOwnerMember = await dbGet('SELECT id FROM family_members WHERE id = ? AND (user_id = ? OR (email IS NOT NULL AND LOWER(email) = ?))', [doc.owner_member_id, userId, userEmail]);
        if (isOwnerMember) {
            return {
                documentId,
                isOwner: false,
                permissionLevel: 'VIEW',
                document: doc
            };
        }
    }
    return {
        documentId,
        isOwner: false,
        permissionLevel: 'NONE',
        document: doc
    };
}
/**
 * Middleware requiring at least VIEW permission on document :id
 */
export async function requireDocumentView(req, res, next) {
    const documentId = String(req.params.id || req.params.documentId || '');
    const userId = req.user?.id;
    if (!userId || !documentId) {
        res.status(400).json({ error: 'Invalid document request' });
        return;
    }
    const access = await getDocumentAccess(userId, documentId);
    if (!access || !access.document) {
        res.status(404).json({ error: 'Document not found' });
        return;
    }
    if (access.permissionLevel === 'NONE') {
        res.status(403).json({ error: 'Access denied: You do not have permission to view this document' });
        return;
    }
    req.docAccess = access;
    next();
}
/**
 * Middleware requiring EDIT or OWNER permission on document :id
 */
export async function requireDocumentEdit(req, res, next) {
    const documentId = String(req.params.id || req.params.documentId || '');
    const userId = req.user?.id;
    if (!userId || !documentId) {
        res.status(400).json({ error: 'Invalid document request' });
        return;
    }
    const access = await getDocumentAccess(userId, documentId);
    if (!access || !access.document) {
        res.status(404).json({ error: 'Document not found' });
        return;
    }
    if (access.permissionLevel !== 'OWNER' && access.permissionLevel !== 'EDIT') {
        res.status(403).json({ error: 'Access denied: You do not have permission to modify this document' });
        return;
    }
    req.docAccess = access;
    next();
}
/**
 * Middleware requiring direct OWNER permission on document :id (e.g. for deletion or unsharing)
 */
export async function requireDocumentOwner(req, res, next) {
    const documentId = String(req.params.id || req.params.documentId || '');
    const userId = req.user?.id;
    if (!userId || !documentId) {
        res.status(400).json({ error: 'Invalid document request' });
        return;
    }
    const access = await getDocumentAccess(userId, documentId);
    if (!access || !access.document) {
        res.status(404).json({ error: 'Document not found' });
        return;
    }
    if (!access.isOwner) {
        res.status(403).json({ error: 'Access denied: Only the document owner can perform this action' });
        return;
    }
    req.docAccess = access;
    next();
}
