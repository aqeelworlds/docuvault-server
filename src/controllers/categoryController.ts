import { Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { dbGet, dbRun, dbAll } from '../db/database.js';
import { AuthenticatedRequest } from '../middleware/auth.js';

export async function getCategories(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user?.id;

    const categories = await dbAll(
      `SELECT dt.*, 
              (SELECT COUNT(*) FROM documents WHERE document_type_id = dt.id AND user_id = ?) as document_count
       FROM document_types dt
       WHERE dt.is_custom = 0 OR dt.user_id = ?
       ORDER BY dt.is_custom ASC, dt.name ASC`,
      [userId || '', userId || '']
    );

    res.json({ categories });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch categories', details: error.message });
  }
}

export async function createCustomCategory(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;
    const { name, icon, color } = req.body;

    if (!name || typeof name !== 'string' || name.trim() === '') {
      res.status(400).json({ error: 'Category name is required' });
      return;
    }

    const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 30);
    const categoryId = `custom_${uuidv4()}`;

    await dbRun(
      'INSERT INTO document_types (id, name, slug, icon, color, is_custom, user_id) VALUES (?, ?, ?, ?, ?, 1, ?)',
      [categoryId, name.trim(), slug, icon || 'Folder', color || '#6366f1', userId]
    );

    res.status(201).json({
      message: 'Custom category created',
      category: {
        id: categoryId,
        name: name.trim(),
        slug,
        icon: icon || 'Folder',
        color: color || '#6366f1',
        is_custom: 1,
        user_id: userId
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to create category', details: error.message });
  }
}
