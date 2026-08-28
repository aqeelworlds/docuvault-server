import { Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { dbGet, dbRun, dbAll } from '../db/database.js';
import { AuthenticatedRequest } from '../middleware/auth.js';
import { differenceInCalendarDays, calculateExpiryMetrics } from '../services/expiryService.js';
import { checkUserIsPro } from './subscriptionController.js';

export async function getReminders(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;

    const sql = `
      SELECT r.id, r.document_id, r.lead_days, r.reminder_date, r.is_active, r.is_triggered, r.created_at,
             d.name as document_name, d.document_number, d.expiry_date, d.has_no_expiry,
             dt.name as category_name, dt.slug as category_slug, dt.icon as category_icon, dt.color as category_color,
             fm.name as owner_name, fm.relationship as owner_relationship
      FROM reminders r
      JOIN documents d ON r.document_id = d.id
      LEFT JOIN document_types dt ON d.document_type_id = dt.id
      LEFT JOIN family_members fm ON d.owner_member_id = fm.id
      WHERE r.user_id = ?
      ORDER BY r.reminder_date ASC, r.lead_days ASC
    `;

    const reminders = await dbAll<any>(sql, [userId]);
    const todayStr = new Date().toISOString().split('T')[0];

    const todayList: any[] = [];
    const thisWeekList: any[] = [];
    const upcomingList: any[] = [];
    const expiredList: any[] = [];

    for (const rem of reminders) {
      const metrics = calculateExpiryMetrics(rem.expiry_date, Boolean(rem.has_no_expiry));
      const daysUntilReminder = differenceInCalendarDays(rem.reminder_date, todayStr);

      const enriched = {
        ...rem,
        is_active: Boolean(rem.is_active),
        is_triggered: Boolean(rem.is_triggered),
        documentMetrics: metrics,
        daysUntilReminder
      };

      if (metrics.isExpired) {
        expiredList.push(enriched);
      } else if (daysUntilReminder <= 0) {
        todayList.push(enriched);
      } else if (daysUntilReminder <= 7) {
        thisWeekList.push(enriched);
      } else {
        upcomingList.push(enriched);
      }
    }

    res.json({
      summary: {
        total: reminders.length,
        today: todayList.length,
        thisWeek: thisWeekList.length,
        upcoming: upcomingList.length,
        expired: expiredList.length
      },
      sections: {
        today: todayList,
        thisWeek: thisWeekList,
        upcoming: upcomingList,
        expired: expiredList
      }
    });
  } catch (error: any) {
    console.error('getReminders error:', error);
    res.status(500).json({ error: 'Failed to fetch reminders', details: error.message });
  }
}

export async function toggleReminder(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const reminderId = req.params.id;
    const userId = req.user!.id;

    const reminder = await dbGet<{ id: string; is_active: number }>(
      'SELECT id, is_active FROM reminders WHERE id = ? AND user_id = ?',
      [reminderId, userId]
    );

    if (!reminder) {
      res.status(404).json({ error: 'Reminder not found' });
      return;
    }

    const nextState = reminder.is_active ? 0 : 1;
    await dbRun('UPDATE reminders SET is_active = ? WHERE id = ?', [nextState, reminderId]);

    res.json({ message: 'Reminder state toggled', isActive: Boolean(nextState) });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to toggle reminder', details: error.message });
  }
}

export async function createCustomReminder(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;
    const { documentId, leadDays } = req.body;

    if (!documentId || !leadDays || typeof leadDays !== 'number' || leadDays <= 0) {
      res.status(400).json({ error: 'Valid document ID and positive lead days are required' });
      return;
    }

    // Check user owns document
    const doc = await dbGet<{ id: string; expiry_date: string; user_id: string }>(
      'SELECT id, expiry_date, user_id FROM documents WHERE id = ?',
      [documentId]
    );

    if (!doc || doc.user_id !== userId) {
      res.status(403).json({ error: 'Document not found or unauthorized' });
      return;
    }

    if (!doc.expiry_date) {
      res.status(400).json({ error: 'Cannot set reminders for documents without expiry date' });
      return;
    }

    // Free users can use standard lead days [90, 60, 30, 14, 7, 1]; custom schedules require Pro
    const standardDays = [90, 60, 30, 14, 7, 1];
    if (!standardDays.includes(leadDays)) {
      const isPro = await checkUserIsPro(userId);
      if (!isPro) {
        res.status(403).json({
          error: 'Custom reminder intervals require Document Vault Pro.',
          code: 'CUSTOM_REMINDERS_PRO_REQUIRED'
        });
        return;
      }
    }

    // Calculate reminder date
    const expiry = new Date(doc.expiry_date);
    const reminderDateObj = new Date(expiry.getTime() - (leadDays * 24 * 60 * 60 * 1000));
    const reminderDate = reminderDateObj.toISOString().split('T')[0];

    const reminderId = uuidv4();
    await dbRun(
      'INSERT INTO reminders (id, document_id, user_id, lead_days, reminder_date, is_active) VALUES (?, ?, ?, ?, ?, 1)',
      [reminderId, documentId, userId, leadDays, reminderDate]
    );

    res.status(201).json({
      message: 'Custom reminder created',
      reminderId,
      leadDays,
      reminderDate
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to create reminder', details: error.message });
  }
}

export async function deleteReminder(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const reminderId = req.params.id;
    const userId = req.user!.id;

    await dbRun('DELETE FROM reminders WHERE id = ? AND user_id = ?', [reminderId, userId]);
    res.json({ message: 'Reminder deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to delete reminder', details: error.message });
  }
}
