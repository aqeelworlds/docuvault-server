import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { dbGet } from '../db/database.js';
export const JWT_SECRET = process.env.JWT_SECRET || 'document-vault-super-secure-production-jwt-secret-key-2026';
export const JWT_EXPIRES_IN = '30d';
export function generateToken(user) {
    return jwt.sign({ id: user.id, email: user.email, fullName: user.fullName, isAdmin: Boolean(user.isAdmin) }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}
export async function hashPassword(password) {
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(password, salt);
    return { hash, salt };
}
export async function verifyPassword(password, hash) {
    return bcrypt.compare(password, hash);
}
export function hashPin(pin, salt = 'app-lock-salt') {
    return crypto.createHmac('sha256', salt).update(pin).digest('hex');
}
/**
 * Authentication middleware: verifies Bearer token or token query param (for media streaming)
 */
export async function authenticateToken(req, res, next) {
    let token;
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
    }
    else if (req.query.token && typeof req.query.token === 'string') {
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
        const decoded = jwt.verify(token, JWT_SECRET);
        // Verify user still exists in DB
        const user = await dbGet('SELECT id, email, is_admin FROM users WHERE id = ?', [decoded.id]);
        if (!user) {
            res.status(401).json({
                error: 'User session expired or invalid',
                code: 'USER_NOT_FOUND'
            });
            return;
        }
        const isAdmin = Boolean((user.is_admin && (user.email.toLowerCase() === 'docuvault.app.help@gmail.com' || user.email.toLowerCase() === 'admin@docuvault.app')) ||
            user.email.toLowerCase() === 'docuvault.app.help@gmail.com' ||
            user.email.toLowerCase() === 'admin@docuvault.app');
        req.user = {
            id: decoded.id,
            email: decoded.email,
            fullName: decoded.fullName,
            isAdmin
        };
        next();
    }
    catch (err) {
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
export async function requireAdmin(req, res, next) {
    if (!req.user) {
        res.status(401).json({ error: 'Authentication required', code: 'AUTH_REQUIRED' });
        return;
    }
    const user = await dbGet('SELECT id, email, is_admin FROM users WHERE id = ?', [req.user.id]);
    const isAdminEmail = user?.email?.toLowerCase() === 'docuvault.app.help@gmail.com' || user?.email?.toLowerCase() === 'admin@docuvault.app';
    if (!user || (!user.is_admin && !isAdminEmail)) {
        res.status(403).json({ error: 'Access denied: Administrator privileges required', code: 'ADMIN_REQUIRED' });
        return;
    }
    req.user.isAdmin = true;
    next();
}
