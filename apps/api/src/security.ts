import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { one, run, type Row } from './db.js';
export function hashPassword(p: string) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(p, salt, 64).toString('hex')}`;
}
export function verifyPassword(p: string, hash: string) {
  const [salt, key] = hash.split(':');
  if (!salt || !key) return false;
  return timingSafeEqual(Buffer.from(key, 'hex'), scryptSync(p, salt, 64));
}
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
export type AuthRequest = Request & { user?: Row; sessionHash?: string };
/**
 * The store owner's administrator account. Other administrators can never edit, disable or
 * delete it; the owner changes it from their own profile.
 */
export const ownerEmail = (process.env.OWNER_EMAIL || 'dellvitsupport@gmail.com').trim().toLowerCase();
export const isOwner = (user?: Row) => user?.role === 'admin' && user.email === ownerEmail;
type Access = { super: number; permissions: string } | undefined;
/** Admin access rows already loaded with their user, so a request does not fetch them again. */
const loadedAccess = new WeakMap<Row, Access>();
/** A user's admin_access row; undefined for other roles and for admins without one. */
export async function accessRow(user?: Row): Promise<Access> {
  if (user?.role !== 'admin') return undefined;
  if (loadedAccess.has(user)) return loadedAccess.get(user);
  return (await one('SELECT * FROM admin_access WHERE user_id=?', user.id)) as Access;
}
export async function session(req: AuthRequest, _res: Response, next: NextFunction) {
  const token = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : req.cookies?.dellvit_session;
  if (token) {
    const hash = tokenHash(token);
    // The session, its active user and that user's admin access in one round trip.
    const s = await one(
      'SELECT u.*,a.user_id access_user,a.super access_super,a.permissions access_permissions FROM sessions s LEFT JOIN users u ON u.id=s.user_id AND u.active=1 LEFT JOIN admin_access a ON a.user_id=u.id WHERE s.token_hash=? AND s.expires_at>?',
      hash,
      new Date().toISOString(),
    );
    if (s) {
      req.sessionHash = hash;
      const { access_user, access_super, access_permissions, ...user } = s;
      if (user.id) {
        req.user = user;
        loadedAccess.set(
          user,
          access_user ? { super: access_super, permissions: access_permissions } : undefined,
        );
      }
    }
  }
  next();
}
export async function newSession(req: AuthRequest, res: Response, userId: string | null) {
  const token = randomBytes(32).toString('hex');
  const hash = tokenHash(token);
  await run('DELETE FROM sessions WHERE expires_at<?', new Date().toISOString());
  await run(
    'INSERT INTO sessions(token_hash,user_id,expires_at,created_at,user_agent) VALUES(?,?,?,?,?)',
    hash,
    userId,
    new Date(Date.now() + 7 * 86400000).toISOString(),
    new Date().toISOString(),
    String(req.headers['user-agent'] || '').slice(0, 300),
  );
  res.cookie('dellvit_session', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 86400000,
    path: '/',
  });
  req.sessionHash = hash;
  return token;
}
export function requireRole(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'Please sign in to continue.' });
    if (!roles.includes(req.user.role))
      return res.status(403).json({ error: 'You do not have access to this action.' });
    next();
  };
}
export async function publicUser(user: Row) {
  // Notes written by administrators never reach the account they are about.
  const { password_hash, admin_notes, deleted_at, notify_muted, ...safe } = user;
  const a = await accessRow(user);
  return {
    ...safe,
    // Notification types the account has silenced.
    notify_muted: JSON.parse(notify_muted || '[]') as string[],
    is_super_admin: !!a?.super,
    is_owner: isOwner(user),
    permissions: a ? JSON.parse(a.permissions) : [],
  };
}
