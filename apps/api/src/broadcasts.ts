import { atomicRoute } from './atomic-route.js';
import type { Express } from 'express';
import { z } from 'zod';
import { all, one, run, afterCommit } from './db.js';
import { requireRole, type AuthRequest } from './security.js';
import { sendBrowserPushes } from './notifications.js';
import { pushConfigured, sendEach } from './fcm.js';

/** Who an announcement can go to. Administrators are not included. */
export const broadcastRoles = ['customer', 'rider', 'outlet'] as const;

/** Where each kind of account reads its inbox on the website, for an announcement without a link. */
const inbox = (role: string) =>
  role === 'customer' ? '/account?tab=notifications' : `/portal/${role}?tab=notifications`;

const roleList = (roles: readonly string[]) => roles.map(() => '?').join(',');
const reachable = 'u.active=1 AND u.deleted_at IS NULL';

/**
 * Announcements from the administrators: "Dellvit updates" for customers, riders, outlets or all
 * of them. Each one reaches every inbox at once with a single insert, then goes out as browser
 * pop-ups and to the app's notification centre on each phone. People who switched off "Dellvit
 * updates" still find it in their inbox, without the pop-up.
 * The routes sit under /api/admin/broadcasts, which the Messages permission opens (platform.ts).
 */
export function installBroadcasts(app: Express) {
  const admin = requireRole('admin');

  app.get('/api/admin/broadcasts', admin, async (_req, res) => {
    const [items, audience] = await Promise.all([
      all(
        `SELECT b.*,u.name sent_by_name,
          (SELECT COUNT(*) FROM notifications n WHERE n.broadcast_id=b.id AND n.read=1) opened
         FROM broadcasts b LEFT JOIN users u ON u.id=b.sent_by ORDER BY b.created_at DESC LIMIT 500`,
      ),
      all(
        `SELECT u.role,COUNT(*) people,
          COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM device_tokens d WHERE d.user_id=u.id)) phones
         FROM users u WHERE ${reachable} AND u.role IN (${roleList(broadcastRoles)}) GROUP BY u.role`,
        ...broadcastRoles,
      ),
    ]);
    res.json({
      items: items.map((b) => ({ ...b, audience: JSON.parse(b.audience) })),
      audience: Object.fromEntries(
        broadcastRoles.map((r) => {
          const row = audience.find((a) => a.role === r);
          return [r, { people: Number(row?.people || 0), phones: Number(row?.phones || 0) }];
        }),
      ),
      phone_push: pushConfigured(),
    });
  });

  app.post(
    '/api/admin/broadcasts',
    admin,
    atomicRoute(async (req: AuthRequest, res) => {
      const p = z
        .object({
          // Made by the browser, so pressing Send twice cannot send it twice.
          id: z.uuid(),
          title: z.string().trim().min(1, 'Write a title.').max(80),
          body: z.string().trim().max(500).default(''),
          link: z
            .string()
            .trim()
            .max(300)
            .refine(
              (v) => !v || (v.startsWith('/') && !v.startsWith('//')) || /^https:\/\/[^\s]+$/.test(v),
              'The link must be a page of this site, such as /search, or start with https://',
            )
            .default(''),
          audience: z.array(z.enum(broadcastRoles)).min(1, 'Choose who receives it.').max(3),
        })
        .parse(req.body);
      const roles = [...new Set(p.audience)];
      const at = new Date().toISOString();
      const created = await run(
        'INSERT INTO broadcasts(id,title,body,link,audience,sent_by,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING',
        p.id,
        p.title,
        p.body,
        p.link,
        JSON.stringify(roles),
        req.user!.id,
        at,
      );
      if (!created.changes) {
        const sent = await one('SELECT recipients FROM broadcasts WHERE id=?', p.id);
        return res.json({ ok: true, recipients: Number(sent?.recipients || 0), repeated: true });
      }
      // Everyone's copy in one statement. Its id ends in the account id, so the copy a phone or
      // browser opens is the one marked as read.
      const { changes: recipients } = await run(
        `INSERT INTO notifications(id,user_id,type,title,body,link,read,created_at,broadcast_id)
         SELECT CAST(? AS TEXT)||':'||u.id,u.id,'update',CAST(? AS TEXT),CAST(? AS TEXT),CAST(? AS TEXT),0,CAST(? AS TEXT),CAST(? AS TEXT)
         FROM users u WHERE ${reachable} AND u.role IN (${roleList(roles)})`,
        p.id,
        p.title,
        p.body,
        p.link,
        at,
        p.id,
        ...roles,
      );
      await run('UPDATE broadcasts SET recipients=? WHERE id=?', recipients, p.id);
      if (process.env.NODE_ENV !== 'test')
        await afterCommit(async () => {
          // Accounts that switched off "Dellvit updates" keep it in the inbox only.
          const muted = `%"update"%`;
          const [phones, browsers] = await Promise.all([
            all(
              `SELECT d.token,d.user_id FROM device_tokens d JOIN users u ON u.id=d.user_id
               WHERE ${reachable} AND u.role IN (${roleList(roles)}) AND u.notify_muted NOT LIKE ?`,
              ...roles,
              muted,
            ),
            all(
              `SELECT s.endpoint,s.p256dh,s.auth,s.user_id,u.role FROM push_subscriptions s JOIN users u ON u.id=s.user_id
               WHERE ${reachable} AND u.role IN (${roleList(roles)}) AND u.notify_muted NOT LIKE ?`,
              ...roles,
              muted,
            ),
          ]);
          const [dead, sentToBrowsers] = await Promise.all([
            sendEach(
              phones.map((d) => ({
                token: d.token,
                message: { id: `${p.id}:${d.user_id}`, type: 'update', title: p.title, body: p.body, link: p.link },
              })),
            ).catch((error) => {
              console.error('Phone notifications failed:', error);
              return [] as string[];
            }),
            sendBrowserPushes(
              browsers.map((s) => ({
                endpoint: s.endpoint,
                p256dh: s.p256dh,
                auth: s.auth,
                payload: { id: `${p.id}:${s.user_id}`, title: p.title, body: p.body, link: p.link || inbox(s.role) },
              })),
            ),
          ]);
          if (dead.length) await run(`DELETE FROM device_tokens WHERE token IN (${roleList(dead)})`, ...dead);
          await run(
            'UPDATE broadcasts SET phones=?,browsers=? WHERE id=?',
            phones.length - dead.length,
            sentToBrowsers,
            p.id,
          );
        });
      res.status(201).json({ ok: true, recipients });
    }),
  );

  /** Takes an announcement back out of every inbox. Pop-ups already shown cannot be recalled. */
  app.delete(
    '/api/admin/broadcasts/:id',
    admin,
    atomicRoute(async (req: AuthRequest, res) => {
      const id = String(req.params.id);
      const { changes } = await run(
        'UPDATE broadcasts SET withdrawn_at=? WHERE id=? AND withdrawn_at IS NULL',
        new Date().toISOString(),
        id,
      );
      if (!changes) return res.status(404).json({ error: 'This announcement was not found or is already withdrawn.' });
      const { changes: removed } = await run('DELETE FROM notifications WHERE broadcast_id=?', id);
      res.json({ ok: true, removed });
    }),
  );
}
