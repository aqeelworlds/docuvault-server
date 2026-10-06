import path from 'path';
import fs from 'fs';
import { dbGet, dbRun, VAULT_DIR } from '../db/database.js';
import { getDocumentAccess } from '../middleware/authorization.js';
/**
 * Persist uploaded file bytes into the database (document_attachments.file_data).
 * The serverless filesystem (/tmp on Vercel) is wiped constantly, so files saved
 * to disk alone would be lost. Bytes in PostgreSQL survive forever.
 */
export async function persistAttachmentBytes(attachmentId, diskPath) {
    try {
        if (!diskPath || !fs.existsSync(diskPath))
            return;
        const data = fs.readFileSync(diskPath);
        if (!data || data.length === 0)
            return;
        await dbRun('UPDATE document_attachments SET file_data = ? WHERE id = ?', [data, attachmentId]);
    }
    catch (e) {
        console.warn('[Attachments] file_data persist notice:', e?.message || e);
    }
}
/** Serve bytes from the database when the disk copy is gone (serverless /tmp wipe). */
async function sendFromDatabase(res, attachmentId, fileName, mimeType, disposition) {
    try {
        const row = await dbGet('SELECT file_data FROM document_attachments WHERE id = ?', [attachmentId]);
        const buf = row?.file_data ? Buffer.from(row.file_data) : null;
        if (!buf || buf.length === 0)
            return false;
        res.setHeader('Content-Type', mimeType || 'application/octet-stream');
        res.setHeader('Content-Disposition', `${disposition}; filename="${encodeURIComponent(path.basename(fileName))}"`);
        res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Length', String(buf.length));
        res.send(buf);
        return true;
    }
    catch (e) {
        console.warn('[Attachments] db fallback notice:', e?.message || e);
        return false;
    }
}
export async function viewAttachment(req, res) {
    try {
        const attachmentId = req.params.id;
        const userId = req.user.id;
        const attachment = await dbGet('SELECT id, document_id, file_name, mime_type, file_path FROM document_attachments WHERE id = ?', [attachmentId]);
        if (!attachment) {
            res.status(404).json({ error: 'Attachment not found' });
            return;
        }
        // Check authorization on parent document (Owner or active family share)
        const access = await getDocumentAccess(userId, attachment.document_id);
        if (!access || access.permissionLevel === 'NONE') {
            res.status(403).json({ error: 'Access denied: You do not have permission to access this attachment' });
            return;
        }
        // Path traversal safety check
        const safeVaultDir = path.resolve(VAULT_DIR);
        const sanitizedFileName = path.basename(attachment.file_path);
        const fullPath = path.resolve(safeVaultDir, sanitizedFileName);
        if (!fullPath.startsWith(safeVaultDir)) {
            res.status(403).json({ error: 'Access denied: Invalid file path' });
            return;
        }
        if (!fs.existsSync(fullPath)) {
            // Disk copy gone (e.g. serverless /tmp wipe) -> serve bytes stored in DB.
            const served = await sendFromDatabase(res, attachmentId, attachment.file_name, attachment.mime_type, 'inline');
            if (!served) {
                res.status(404).json({ error: 'Attachment file not found' });
            }
            return;
        }
        // Secure Response Headers to prevent XSS / MIME sniffing
        res.setHeader('Content-Type', attachment.mime_type || 'application/octet-stream');
        res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(path.basename(attachment.file_name))}"`);
        res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        const stream = fs.createReadStream(fullPath);
        stream.pipe(res);
    }
    catch (error) {
        console.error('viewAttachment error:', error);
        res.status(500).json({ error: 'Failed to stream attachment', details: error.message });
    }
}
export async function downloadAttachment(req, res) {
    try {
        const attachmentId = req.params.id;
        const userId = req.user.id;
        const attachment = await dbGet('SELECT id, document_id, file_name, mime_type, file_path FROM document_attachments WHERE id = ?', [attachmentId]);
        if (!attachment) {
            res.status(404).json({ error: 'Attachment not found' });
            return;
        }
        // Check authorization on parent document
        const access = await getDocumentAccess(userId, attachment.document_id);
        if (!access || access.permissionLevel === 'NONE') {
            res.status(403).json({ error: 'Access denied: You do not have permission to download this attachment' });
            return;
        }
        // Path traversal safety check
        const safeVaultDir = path.resolve(VAULT_DIR);
        const sanitizedFileName = path.basename(attachment.file_path);
        const fullPath = path.resolve(safeVaultDir, sanitizedFileName);
        if (!fullPath.startsWith(safeVaultDir)) {
            res.status(403).json({ error: 'Access denied: Invalid file path' });
            return;
        }
        if (!fs.existsSync(fullPath)) {
            // Disk copy gone (e.g. serverless /tmp wipe) -> serve bytes stored in DB.
            const served = await sendFromDatabase(res, attachmentId, attachment.file_name, attachment.mime_type, 'attachment');
            if (!served) {
                res.status(404).json({ error: 'Attachment file not found' });
            }
            return;
        }
        res.setHeader('Content-Type', attachment.mime_type || 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(path.basename(attachment.file_name))}"`);
        res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        const stream = fs.createReadStream(fullPath);
        stream.pipe(res);
    }
    catch (error) {
        console.error('downloadAttachment error:', error);
        res.status(500).json({ error: 'Failed to download attachment', details: error.message });
    }
}
export async function deleteAttachment(req, res) {
    try {
        const attachmentId = req.params.id;
        const userId = req.user.id;
        const attachment = await dbGet('SELECT id, document_id, file_path FROM document_attachments WHERE id = ?', [attachmentId]);
        if (!attachment) {
            res.status(404).json({ error: 'Attachment not found' });
            return;
        }
        const access = await getDocumentAccess(userId, attachment.document_id);
        if (!access || (access.permissionLevel !== 'OWNER' && access.permissionLevel !== 'EDIT')) {
            res.status(403).json({ error: 'Access denied: You cannot delete attachments on this document' });
            return;
        }
        const safeVaultDir = path.resolve(VAULT_DIR);
        const sanitizedFileName = path.basename(attachment.file_path);
        const fullPath = path.resolve(safeVaultDir, sanitizedFileName);
        if (fullPath.startsWith(safeVaultDir) && fs.existsSync(fullPath)) {
            try {
                fs.unlinkSync(fullPath);
            }
            catch { }
        }
        await dbRun('DELETE FROM document_attachments WHERE id = ?', [attachmentId]);
        res.json({ message: 'Attachment deleted successfully' });
    }
    catch (error) {
        console.error('deleteAttachment error:', error);
        res.status(500).json({ error: 'Failed to delete attachment', details: error.message });
    }
}
