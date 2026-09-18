import type { Express } from 'express';
import { randomUUID } from 'node:crypto';
import webpush from 'web-push';
import { z } from 'zod';
import { db, all, one, run } from './db.js';
import { requireRole, type AuthRequest } from './security.js';

db.exec(`
CREATE TABLE IF NOT EXISTS notifications(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),type TEXT NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL DEFAULT '',link TEXT NOT NULL DEFAULT '',read INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id,created_at);
CREATE TABLE IF NOT EXISTS push_subscriptions(endpoint TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),p256dh TEXT NOT NULL,auth TEXT NOT NULL,created_at TEXT NOT NULL);
`);

/** VAPID keys come from the environment, or are generated once and kept in the database. */
function vapidKeys() {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY)
    return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  const saved = one("SELECT value FROM settings WHERE key='vapid'");
  if (saved) return JSON.parse(saved.value) as { publicKey: string; privateKey: string };
  const keys = webpush.generateVAPIDKeys();
  run("INSERT INTO settings VALUES('vapid',?)", JSON.stringify(keys));
  return keys;
}
const keys = vapidKeys();
webpush.setVapidDetails(
  process.env.VAPID_SUBJECT || 'mailto:dellvitsupport@gmail.com',
  keys.publicKey,
  keys.privateKey,
);

export type Message = { type: string; title: string; body?: string; link?: string };

export function notify(userIds: (string | null | undefined)[], m: Message) {
  const ids = [...new Set(userIds.filter(Boolean) as string[])];
  const created = new Date().toISOString();
  for (const uid of ids) {
    const id = randomUUID();
    run(
      'INSERT INTO notifications VALUES(?,?,?,?,?,?,0,?)',
      id,
      uid,
      m.type,
      m.title,
      m.body || '',
      m.link || '',
      created,
    );
    if (process.env.NODE_ENV === 'test') continue;
    for (const s of all('SELECT * FROM push_subscriptions WHERE user_id=?', uid)) {
      webpush
        .sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify({ id, title: m.title, body: m.body || '', link: m.link || '/' }),
          { TTL: 3600 },
        )
        .catch((e) => {
          if (e?.statusCode === 404 || e?.statusCode === 410)
            run('DELETE FROM push_subscriptions WHERE endpoint=?', s.endpoint);
        });
    }
  }
}

/** Active administrators who may see a module. */
export function adminsWith(permission: string): string[] {
  return all(
    "SELECT u.id,a.super,a.permissions FROM users u JOIN admin_access a ON a.user_id=u.id WHERE u.role='admin' AND u.active=1",
  )
    .filter((a) => a.super || (JSON.parse(a.permissions) as string[]).includes(permission))
    .map((a) => a.id);
}

export function outletUser(outletId: string) {
  return one('SELECT user_id FROM outlets WHERE id=?', outletId)?.user_id as string | undefined;
}

export function installNotifications(app: Express) {
  const signedIn = requireRole('customer', 'admin', 'outlet', 'rider');
  app.get('/api/notifications', signedIn, (req: AuthRequest, res) => {
    const q = z
      .object({
        limit: z.coerce.number().int().min(1).max(100).default(20),
        offset: z.coerce.number().int().min(0).default(0),
        filter: z.enum(['all', 'unread', 'read']).default('all'),
        type: z.string().max(40).optional(),
      })
      .parse(req.query);
    let where = 'user_id=?';
    const args: any[] = [req.user!.id];
    if (q.filter !== 'all') where += q.filter === 'unread' ? ' AND read=0' : ' AND read=1';
    if (q.type) {
      where += ' AND type=?';
      args.push(q.type);
    }
    res.json({
      items: all(
        `SELECT * FROM notifications WHERE ${where} ORDER BY created_at DESC,id LIMIT ? OFFSET ?`,
        ...args,
        q.limit,
        q.offset,
      ),
      total: one(`SELECT COUNT(*) n FROM notifications WHERE ${where}`, ...args)!.n,
      unread: one('SELECT COUNT(*) n FROM notifications WHERE user_id=? AND read=0', req.user!.id)!
        .n,
    });
  });
  app.patch('/api/notifications/:id', signedIn, (req: AuthRequest, res) => {
    const p = z.object({ read: z.boolean() }).parse(req.body);
    run(
      'UPDATE notifications SET read=? WHERE id=? AND user_id=?',
      Number(p.read),
      String(req.params.id),
      req.user!.id,
    );
    res.json({ ok: true });
  });
  app.post('/api/notifications/read-all', signedIn, (req: AuthRequest, res) => {
    run('UPDATE notifications SET read=1 WHERE user_id=?', req.user!.id);
    res.json({ ok: true });
  });
  app.delete('/api/notifications/:id', signedIn, (req: AuthRequest, res) => {
    run('DELETE FROM notifications WHERE id=? AND user_id=?', String(req.params.id), req.user!.id);
    res.json({ ok: true });
  });
  app.delete('/api/notifications', signedIn, (req: AuthRequest, res) => {
    run('DELETE FROM notifications WHERE user_id=? AND read=1', req.user!.id);
    res.json({ ok: true });
  });
  app.get('/api/notifications/push-key', (_req, res) => res.json({ publicKey: keys.publicKey }));
  app.post('/api/notifications/subscribe', signedIn, (req: AuthRequest, res) => {
    const p = z
      .object({
        endpoint: z.url().max(1000),
        keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }),
      })
      .parse(req.body);
    run(
      'INSERT INTO push_subscriptions VALUES(?,?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id,p256dh=excluded.p256dh,auth=excluded.auth',
      p.endpoint,
      req.user!.id,
      p.keys.p256dh,
      p.keys.auth,
      new Date().toISOString(),
    );
    res.json({ ok: true });
  });
  app.post('/api/notifications/unsubscribe', signedIn, (req: AuthRequest, res) => {
    const p = z.object({ endpoint: z.string().max(1000) }).parse(req.body);
    run(
      'DELETE FROM push_subscriptions WHERE endpoint=? AND user_id=?',
      p.endpoint,
      req.user!.id,
    );
    res.json({ ok: true });
  });
}
