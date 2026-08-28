import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { dbGet } from '../db/database.js';

export const JWT_SECRET = process.env.JWT_SECRET || 'document-vault-super-secure-production-jwt-secret-key-2026';
export const JWT_EXPIRES_IN = '30d';

export interface AuthenticatedUser {
  id: string;
  email: string;
  fullName: string;
  isAdmin?: boolean;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

export function generateToken(user: { id: string; email: string; fullName: string; isAdmin?: boolean }): string {
  return jwt.sign(
    { id: user.id, email: user.email, fullName: user.fullName, isAdmin: Boolean(user.isAdmin) },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

export async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const salt = await bcrypt.genSalt(10);
  const hash = await bcrypt.hash(password, salt);
  return { hash, salt };
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function hashPin(pin: string, salt: string = 'app-lock-salt'): string {
  return crypto.createHmac('sha256', salt).update(pin).digest('hex');
}

/**
 * Authentication middleware: verifies Bearer token or token query param (for media streaming)
 */
export async function authenticateToken(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  let token: string | undefined;

  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  } else if (req.query.token && typeof req.query.token === 'string') {
    token = req.query.token;
  }

  if (!token) {
    res.status(401).json({
      error: 'Authentication required',
      code: 'AUTH_TOKEN_MISSING'
    });
    return;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { id: string; email: string; fullName: string };
    
    // Verify user still exists in DB
    const user = await dbGet<{ id: string; email: string; is_admin: number }>('SELECT id, email, is_admin FROM users WHERE id = ?', [decoded.id]);
    if (!user) {
      res.status(401).json({
        error: 'User session expired or invalid',
        code: 'USER_NOT_FOUND'
      });
      return;
    }

    const isAdmin = Boolean(
      user.is_admin ||
      ['aqeelpay38@gmail.com', 'admin@vault.local', 'demo.family@vault.local', 'docuvault.app.help@gmail.com', 'admin@docuvault.app'].includes(user.email.toLowerCase())
    );

    req.user = {
      id: decoded.id,
      email: decoded.email,
      fullName: decoded.fullName,
      isAdmin
    };

    next();
  } catch (err: any) {
    res.status(401).json({
      error: 'Invalid or expired token',
      code: 'TOKEN_INVALID',
      details: err.message
    });
  }
}

/**
 * Authorization middleware: ensures caller is an administrator.
 */
export async function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required', code: 'AUTH_REQUIRED' });
    return;
  }

  const user = await dbGet<{ id: string; email: string; is_admin: number }>(
    'SELECT id, email, is_admin FROM users WHERE id = ?',
    [req.user.id]
  );

  const isAdminEmail = ['aqeelpay38@gmail.com', 'admin@vault.local', 'demo.family@vault.local', 'docuvault.app.help@gmail.com', 'admin@docuvault.app'].includes(user?.email?.toLowerCase() || '');

  if (!user || (!user.is_admin && !isAdminEmail)) {
    res.status(403).json({ error: 'Access denied: Administrator privileges required', code: 'ADMIN_REQUIRED' });
    return;
  }

  req.user.isAdmin = true;
  next();
}
