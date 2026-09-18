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
export async function session(req: AuthRequest, _res: Response, next: NextFunction) {
  const token = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : req.cookies?.dellvit_session;
  if (token) {
    const hash = tokenHash(token);
    const s = await one(
      'SELECT * FROM sessions WHERE token_hash=? AND expires_at>?',
      hash,
      new Date().toISOString(),
    );
    if (s) {
      req.sessionHash = hash;
      if (s.user_id) req.user = await one('SELECT * FROM users WHERE id=? AND active=1', s.user_id);
    }
  }
  next();
}
export async function newSession(req: AuthRequest, res: Response, userId: string | null) {
  const token = randomBytes(32).toString('hex');
  const hash = tokenHash(token);
  await run('DELETE FROM sessions WHERE expires_at<?', new Date().toISOString());
  await run(
    'INSERT INTO sessions VALUES(?,?,?)',
    hash,
    userId,
    new Date(Date.now() + 7 * 86400000).toISOString(),
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
  const { password_hash, ...safe } = user;
  const a =
    user.role === 'admin'
      ? await one('SELECT * FROM admin_access WHERE user_id=?', user.id)
      : undefined;
  return { ...safe, is_super_admin: !!a?.super, permissions: a ? JSON.parse(a.permissions) : [] };
}
