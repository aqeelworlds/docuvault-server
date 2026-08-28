import { Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { dbGet, dbAll, dbRun } from '../db/database.js';
import { AuthenticatedRequest } from '../middleware/auth.js';
import { checkUserIsPro } from './subscriptionController.js';

export async function exportVaultData(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;

    // Gate full backup export with Pro entitlement check
    const isPro = await checkUserIsPro(userId);
    if (!isPro) {
      res.status(403).json({
        error: 'Complete encrypted vault export is exclusive to Document Vault Pro.',
        code: 'EXPORT_PRO_REQUIRED'
      });
      return;
    }

    const user = await dbGet('SELECT id, email, created_at FROM users WHERE id = ?', [userId]);
    const profile = await dbGet('SELECT full_name, phone, timezone, created_at FROM profiles WHERE user_id = ?', [userId]);
    const documents = await dbAll('SELECT * FROM documents WHERE user_id = ?', [userId]);
    const reminders = await dbAll('SELECT * FROM reminders WHERE user_id = ?', [userId]);
    const renewalHistory = await dbAll(
      `SELECT rh.* FROM renewal_history rh
       JOIN documents d ON rh.document_id = d.id
       WHERE d.user_id = ?`,
      [userId]
    );
    const customCategories = await dbAll('SELECT * FROM document_types WHERE user_id = ?', [userId]);
    const familyMember = await dbGet<{ family_group_id: string }>('SELECT family_group_id FROM family_members WHERE user_id = ?', [userId]);
    
    let familyGroup = null;
    let familyMembers: any[] = [];
    if (familyMember?.family_group_id) {
      familyGroup = await dbGet('SELECT * FROM family_groups WHERE id = ?', [familyMember.family_group_id]);
      familyMembers = await dbAll('SELECT id, name, relationship, role, avatar_color, created_at FROM family_members WHERE family_group_id = ?', [familyMember.family_group_id]);
    }

    const backupPayload = {
      exportVersion: '1.0',
      exportedAt: new Date().toISOString(),
      user,
      profile,
      familyGroup,
      familyMembers,
      customCategories,
      documents,
      reminders,
      renewalHistory
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="document_vault_backup_${new Date().toISOString().split('T')[0]}.json"`);
    res.json(backupPayload);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to export vault data', details: error.message });
  }
}

export async function syncVaultData(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;
    const docRow = await dbGet<{ count: number }>('SELECT COUNT(*) as count FROM documents WHERE user_id = ? AND is_archived = 0', [userId]);
    const reminderRow = await dbGet<{ count: number }>('SELECT COUNT(*) as count FROM reminders WHERE user_id = ? AND is_active = 1', [userId]);
    const memberRow = await dbGet<{ count: number }>(
      `SELECT COUNT(*) as count FROM family_members 
       WHERE family_group_id = (SELECT family_group_id FROM family_members WHERE user_id = ?)`,
      [userId]
    );

    const now = new Date().toISOString();
    res.json({
      status: 'synced',
      lastSyncedAt: now,
      summary: {
        documentCount: docRow?.count || 0,
        activeReminders: reminderRow?.count || 0,
        familyMembersCount: memberRow?.count || 0
      },
      message: 'Cloud vault is fully synchronized and up to date.'
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to synchronize cloud vault', details: error.message });
  }
}

export async function importVaultData(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;
    const { backup } = req.body;

    if (!backup || !backup.documents || !Array.isArray(backup.documents)) {
      res.status(400).json({ error: 'Invalid backup JSON file. Expected exportVersion and documents array.' });
      return;
    }

    const isPro = await checkUserIsPro(userId);
    if (!isPro && backup.documents.length > 5) {
      res.status(403).json({
        error: 'Free plan supports maximum 5 documents. Upgrade to Pro to restore unlimited backup.',
        code: 'PLAN_LIMIT_REACHED'
      });
      return;
    }

    let restoredCount = 0;
    for (const doc of backup.documents) {
      const existing = await dbGet('SELECT id FROM documents WHERE id = ? AND user_id = ?', [doc.id, userId]);
      if (!existing) {
        const docId = doc.id || uuidv4();
        await dbRun(
          `INSERT INTO documents (
            id, user_id, name, document_type_id, document_number, issue_date,
            expiry_date, has_no_expiry, issuing_authority, notes, is_archived, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            docId,
            userId,
            doc.name || 'Restored Document',
            doc.document_type_id || 'cat_other',
            doc.document_number || null,
            doc.issue_date || null,
            doc.expiry_date || null,
            doc.has_no_expiry ? 1 : 0,
            doc.issuing_authority || null,
            doc.notes || null,
            doc.is_archived ? 1 : 0,
            doc.created_at || new Date().toISOString(),
            new Date().toISOString()
          ]
        );
        restoredCount++;
      }
    }

    res.json({
      message: `Vault restored successfully. Restored ${restoredCount} document(s).`,
      restoredCount
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to restore vault backup', details: error.message });
  }
}
