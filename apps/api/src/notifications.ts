import { atomicRoute } from './atomic-route.js';
import type { Express } from 'express';
import { randomUUID } from 'node:crypto';
import webpush from 'web-push';
import { z } from 'zod';
import { all, one, run, afterCommit } from './db.js';
import { requireRole, accessRow, type AuthRequest } from './security.js';

/** VAPID keys come from the environment, or are generated once and kept in the database. */
async function vapidKeys() {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY)
    return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  const saved = await one("SELECT value FROM settings WHERE key='vapid'");
  if (saved) return JSON.parse(saved.value) as { publicKey: string; privateKey: string };
  const keys = webpush.generateVAPIDKeys();
  await run("INSERT INTO settings VALUES('vapid',?) ON CONFLICT DO NOTHING", JSON.stringify(keys));
  return JSON.parse((await one("SELECT value FROM settings WHERE key='vapid'"))!.value) as {
    publicKey: string;
    privateKey: string;
  };
}
export type Message = { type: string; title: string; body?: string; link?: string };
/** The kinds of notification an account can silence. */
export const notificationTypes = ['order', 'delivery', 'payment', 'earning', 'payout', 'message'] as const;

export async function notify(userIds: (string | null | undefined)[], m: Message) {
  const ids = [...new Set(userIds.filter(Boolean) as string[])];
  const created = new Date().toISOString();
  for (const uid of ids) {
    const id = randomUUID();
    await run(
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
    await afterCommit(async () => {
      const keys = await vapidKeys();
      webpush.setVapidDetails(
        process.env.VAPID_SUBJECT || 'mailto:dellvitsupport@gmail.com',
        keys.publicKey,
        keys.privateKey,
      );
      // Types the account has silenced stay in its inbox but send no pop-up.
      for (const subscription of await all(
        'SELECT s.* FROM push_subscriptions s JOIN users u ON u.id=s.user_id WHERE s.user_id=? AND u.notify_muted NOT LIKE ?',
        uid,
        `%"${m.type}"%`,
      )) {
        try {
          await webpush.sendNotification(
            {
              endpoint: subscription.endpoint,
              keys: { p256dh: subscription.p256dh, auth: subscription.auth },
            },
            JSON.stringify({ id, title: m.title, body: m.body || '', link: m.link || '/' }),
            { TTL: 3600, timeout: 5000 },
          );
        } catch (error: any) {
          if (error?.statusCode === 404 || error?.statusCode === 410)
            await run('DELETE FROM push_subscriptions WHERE endpoint=?', subscription.endpoint);
        }
      }
    });
  }
}

/** Active administrators who may see a module. */
export async function adminsWith(permission: string): Promise<string[]> {
  return (
    await all(
      "SELECT u.id,a.super,a.permissions FROM users u JOIN admin_access a ON a.user_id=u.id WHERE u.role='admin' AND u.active=1",
    )
  )
    .filter((a) => a.super || (JSON.parse(a.permissions) as string[]).includes(permission))
    .map((a) => a.id);
}

export async function outletUser(outletId: string) {
  return (await one('SELECT user_id FROM outlets WHERE id=?', outletId))?.user_id as
    string | undefined;
}

export function installNotifications(app: Express) {
  const signedIn = requireRole('customer', 'admin', 'outlet', 'rider');
  app.get('/api/notifications', signedIn, async (req: AuthRequest, res) => {
    const q = z
      .object({
        limit: z.coerce.number().int().min(1).max(500).default(20),
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
    // The header's message badge rides along: replies waiting for this account, or for the
    // support team, everything waiting for an answer.
    const access = await accessRow(req.user);
    const member = req.user!.role !== 'admin';
    const team =
      !member && (!!access?.super || (JSON.parse(access?.permissions || '[]') as string[]).includes('messages'));
    const support = member
      ? '(SELECT COALESCE(SUM(user_unread),0) FROM support_threads WHERE user_id=?)'
      : team
        ? "(SELECT COALESCE(SUM(staff_unread),0) FROM support_threads)+(SELECT COUNT(*) FROM messages WHERE status='new')"
        : '0';
    // Chat messages that have reached this device for the first time become "delivered".
    const side = member ? 'user' : 'staff';
    const arriving =
      member || team
        ? `(SELECT COUNT(*) FROM support_threads WHERE ${side}_unread>0 AND (${side}_delivered_at IS NULL OR ${side}_delivered_at<last_at)${member ? ' AND user_id=?' : ''})`
        : '0';
    const [items, counts] = await Promise.all([
      all(
        `SELECT * FROM notifications WHERE ${where} ORDER BY created_at DESC,id LIMIT ? OFFSET ?`,
        ...args,
        q.limit,
        q.offset,
      ),
      one(
        `SELECT (SELECT COUNT(*) FROM notifications WHERE ${where}) total,(SELECT COUNT(*) FROM notifications WHERE user_id=? AND read=0) unread,${support} support_unread,${arriving} arriving`,
        ...args,
        req.user!.id,
        ...(member ? [req.user!.id, req.user!.id] : []),
      ),
    ]);
    if (Number(counts!.arriving))
      await run(
        `UPDATE support_threads SET ${side}_delivered_at=? WHERE ${side}_unread>0 AND (${side}_delivered_at IS NULL OR ${side}_delivered_at<last_at)${member ? ' AND user_id=?' : ''}`,
        ...[new Date().toISOString(), ...(member ? [req.user!.id] : [])],
      );
    res.json({
      items,
      total: counts!.total,
      unread: counts!.unread,
      support_unread: Number(counts!.support_unread),
    });
  });
  app.patch(
    '/api/notifications/:id',
    signedIn,
    atomicRoute(async (req: AuthRequest, res) => {
      const p = z.object({ read: z.boolean() }).parse(req.body);
      await run(
        'UPDATE notifications SET read=? WHERE id=? AND user_id=?',
        Number(p.read),
        String(req.params.id),
        req.user!.id,
      );
      res.json({ ok: true });
    }),
  );
  app.post(
    '/api/notifications/read-all',
    signedIn,
    atomicRoute(async (req: AuthRequest, res) => {
      await run('UPDATE notifications SET read=1 WHERE user_id=?', req.user!.id);
      res.json({ ok: true });
    }),
  );
  app.delete(
    '/api/notifications/:id',
    signedIn,
    atomicRoute(async (req: AuthRequest, res) => {
      await run(
        'DELETE FROM notifications WHERE id=? AND user_id=?',
        String(req.params.id),
        req.user!.id,
      );
      res.json({ ok: true });
    }),
  );
  app.delete(
    '/api/notifications',
    signedIn,
    atomicRoute(async (req: AuthRequest, res) => {
      // ?all=1 empties the inbox; otherwise unread notifications are kept.
      const { changes } = await run(
        `DELETE FROM notifications WHERE user_id=?${req.query.all ? '' : ' AND read=1'}`,
        req.user!.id,
      );
      res.json({ ok: true, removed: changes });
    }),
  );
  /** Which kinds of notification play a sound and pop up; all kinds still reach the inbox. */
  app.put(
    '/api/notifications/preferences',
    signedIn,
    atomicRoute(async (req: AuthRequest, res) => {
      const p = z.object({ muted: z.array(z.enum(notificationTypes)).max(notificationTypes.length) }).parse(req.body);
      const muted = [...new Set(p.muted)];
      await run('UPDATE users SET notify_muted=? WHERE id=?', JSON.stringify(muted), req.user!.id);
      res.json({ muted });
    }),
  );
  /** Sends the account a notification, to check that sound and pop-ups work on this device. */
  app.post(
    '/api/notifications/test',
    signedIn,
    atomicRoute(async (req: AuthRequest, res) => {
      await notify([req.user!.id], {
        type: 'test',
        title: 'Test notification',
        body: 'Notifications are working on this account.',
        link: '',
      });
      res.json({ ok: true });
    }),
  );
  app.get('/api/notifications/push-key', async (_req, res) =>
    res.json({ publicKey: (await vapidKeys()).publicKey }),
  );
  app.post(
    '/api/notifications/subscribe',
    signedIn,
    atomicRoute(async (req: AuthRequest, res) => {
      const p = z
        .object({
          endpoint: z.url().max(1000),
          keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }),
        })
        .parse(req.body);
      await run(
        'INSERT INTO push_subscriptions VALUES(?,?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id,p256dh=excluded.p256dh,auth=excluded.auth',
        p.endpoint,
        req.user!.id,
        p.keys.p256dh,
        p.keys.auth,
        new Date().toISOString(),
      );
      res.json({ ok: true });
    }),
  );
  app.post(
    '/api/notifications/unsubscribe',
    signedIn,
    atomicRoute(async (req: AuthRequest, res) => {
      const p = z.object({ endpoint: z.string().max(1000) }).parse(req.body);
      await run(
        'DELETE FROM push_subscriptions WHERE endpoint=? AND user_id=?',
        p.endpoint,
        req.user!.id,
      );
      res.json({ ok: true });
    }),
  );
}
