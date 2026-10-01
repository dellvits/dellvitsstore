import type { Express, RequestHandler } from 'express';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { z } from 'zod';
import { atomicRoute } from './atomic-route.js';
import { all, one, run, afterCommit, type Row } from './db.js';
import { requireRole, type AuthRequest } from './security.js';
import { notify, adminsWith } from './notifications.js';
import { can, records } from './platform.js';
import { objects } from './storage.js';

/**
 * Support chat
 *
 * Every signed-in customer, outlet and rider has one conversation with the support team. Either
 * side may attach a picture or a PDF. Files are private: only the account the conversation
 * belongs to and administrators with the Messages module can open them.
 */
function fail(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}
const now = () => new Date().toISOString();
const members = ['customer', 'outlet', 'rider'] as const;

/** Stores an attached picture (re-encoded as WebP) or PDF and describes it for the message row. */
async function attachment(file?: { buffer: Buffer; originalname: string }) {
  if (!file) return null;
  const id = randomUUID();
  const name = file.originalname.replace(/[^\w. ()-]/g, '_').slice(-120) || 'file';
  if (file.buffer.subarray(0, 5).toString() === '%PDF-') {
    await objects.put('support/' + id + '.pdf', file.buffer, 'application/pdf');
    return { file: id + '.pdf', name, type: 'application/pdf', size: file.buffer.length };
  }
  let image: Buffer;
  try {
    image = await sharp(file.buffer, { limitInputPixels: 24000000 })
      .rotate()
      .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
  } catch {
    fail('Attach a picture (PNG, JPEG or WebP) or a PDF, up to 4 MB.');
  }
  await objects.put('support/' + id + '.webp', image, 'image/webp');
  return { file: id + '.webp', name, type: 'image/webp', size: image.length };
}

/** Adds a message to an account's conversation and keeps the conversation's summary up to date. */
async function post(owner: Row, sender: Row, staff: boolean, req: AuthRequest) {
  const body = z.string().trim().max(2000).default('').parse(req.body?.body);
  const file = await attachment(req.file);
  if (!body && !file) fail('Write a message or attach a file.');
  const at = now();
  const preview = (
    body || (file!.type === 'image/webp' ? 'Sent a picture' : 'Sent a document')
  ).slice(0, 140);
  // A new message always reopens the conversation. Replying takes an unassigned one.
  // Saved in one statement, so sending costs a single round trip. Writing also means the
  // sender has seen everything before it.
  const mine = staff ? 'staff' : 'user';
  const id = randomUUID();
  const thread = (await one(
    `WITH t AS (
       INSERT INTO support_threads AS t(user_id,status,assigned_to,staff_unread,user_unread,last_text,last_staff,last_at,created_at,${mine}_read_at,${mine}_delivered_at)
       VALUES(?,'open',?,?,?,?,?,?,?,?,?)
       ON CONFLICT(user_id) DO UPDATE SET status='open',assigned_to=COALESCE(t.assigned_to,excluded.assigned_to),
         staff_unread=${staff ? '0' : 't.staff_unread+1'},user_unread=${staff ? 't.user_unread+1' : '0'},
         last_text=excluded.last_text,last_staff=excluded.last_staff,last_at=excluded.last_at,
         ${mine}_read_at=excluded.last_at,${mine}_delivered_at=excluded.last_at
       RETURNING staff_unread,user_unread
     ), m AS (
       INSERT INTO support_messages(id,user_id,sender_id,staff,body,file,file_name,file_type,file_size,created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?) RETURNING id
     )
     SELECT t.staff_unread,t.user_unread FROM t,m`,
    owner.id,
    staff ? sender.id : null,
    staff ? 0 : 1,
    staff ? 1 : 0,
    preview,
    Number(staff),
    at,
    at,
    at,
    at,
    id,
    owner.id,
    sender.id,
    Number(staff),
    body,
    file?.file || '',
    file?.name || '',
    file?.type || '',
    file?.size || 0,
    at,
  ))!;
  // One alert for the first unread message, not one for each line typed.
  if (!staff && thread.staff_unread === 1)
    await notify(await adminsWith('messages'), {
      type: 'message',
      title: 'New support message',
      body: `${owner.name}: ${preview}`,
      link: '/admin?tab=messages&chat=' + owner.id,
    });
  if (staff && thread.user_unread === 1)
    await notify([owner.id], {
      type: 'message',
      title: 'Support replied',
      body: preview,
      link: owner.role === 'customer' ? '/support' : `/portal/${owner.role}?tab=support`,
    });
  return {
    id,
    staff: Number(staff),
    body,
    file_name: file?.name || '',
    file_type: file?.type || '',
    file_size: file?.size || 0,
    created_at: at,
  };
}

/** The latest messages of a conversation, oldest first. Staff names are for administrators only. */
async function conversation(userId: string, forStaff: boolean) {
  return (
    await all(
      `SELECT m.id,m.staff,m.body,m.file_name,m.file_type,m.file_size,m.created_at${forStaff ? ',u.name sender_name' : ''}
       FROM support_messages m${forStaff ? ' LEFT JOIN users u ON u.id=m.sender_id' : ''}
       WHERE m.user_id=? ORDER BY m.created_at DESC,m.id LIMIT 300`,
      userId,
    )
  ).reverse();
}

/**
 * Marks the other side's messages as having reached this side's device. Called whenever a
 * signed-in account or the support team checks for news; it changes nothing once up to date.
 */
export async function markDelivered(userId?: string) {
  const side = userId ? 'user' : 'staff';
  await run(
    `UPDATE support_threads SET ${side}_delivered_at=? WHERE ${side}_unread>0 AND (${side}_delivered_at IS NULL OR ${side}_delivered_at<last_at)${userId ? ' AND user_id=?' : ''}`,
    ...[now(), ...(userId ? [userId] : [])],
  );
}

/** Removes an account's conversation and its files, for when the account is deleted. */
export async function deleteSupport(userId: string) {
  const files = await all("SELECT file FROM support_messages WHERE user_id=? AND file<>''", userId);
  await run('DELETE FROM support_messages WHERE user_id=?', userId);
  await run('DELETE FROM support_threads WHERE user_id=?', userId);
  if (files.length)
    await afterCommit(async () => {
      for (const f of files) await objects.delete('support/' + f.file);
    });
}

export function installSupport(
  app: Express,
  { upload, writeLimit }: { upload: RequestHandler; writeLimit: RequestHandler },
) {
  const signedIn = requireRole(...members);
  /** Only registered accounts chat; a customer must also have confirmed their email. */
  const verified: RequestHandler = (req: AuthRequest, res, next) => {
    if (req.user!.role === 'customer' && !req.user!.email_verified_at)
      return res.status(403).json({ error: 'Verify your email before contacting support.' });
    next();
  };

  const staff = requireRole('admin');

  /** The signed-in account's conversation. Opening it marks the support team's replies as read. */
  app.get('/api/support', signedIn, verified, async (req: AuthRequest, res) => {
    const uid = req.user!.id;
    const [thread, messages] = await Promise.all([
      one(
        'SELECT status,user_unread,last_at,staff_delivered_at,staff_read_at FROM support_threads WHERE user_id=?',
        uid,
      ),
      conversation(uid, false),
    ]);
    if (thread?.user_unread)
      await run(
        'UPDATE support_threads SET user_unread=0,user_read_at=?,user_delivered_at=? WHERE user_id=?',
        now(),
        now(),
        uid,
      );
    res.json({
      thread: thread
        ? {
            status: thread.status,
            last_at: thread.last_at,
            // Up to when the support team has received and read this account's messages.
            delivered_at: thread.staff_delivered_at,
            seen_at: thread.staff_read_at,
          }
        : null,
      messages,
    });
  });
  app.post(
    '/api/support/messages',
    signedIn,
    verified,
    writeLimit,
    upload,
    atomicRoute(async (req: AuthRequest, res) => {
      if ((await records('settings', true))[0]?.chat_enabled === false)
        fail('Support chat is closed right now. Please use the contact page.', 403);
      res.status(201).json(await post(req.user!, req.user!, false, req));
    }),
  );
  /** An attached file, for the account it belongs to and for the support team. */
  app.get(
    '/api/support/files/:id',
    requireRole('admin', ...members),
    async (req: AuthRequest, res) => {
      const m = await one(
        "SELECT user_id,file,file_name,file_type FROM support_messages WHERE id=? AND file<>''",
        String(req.params.id),
      );
      const allowed =
        m &&
        (m.user_id === req.user!.id ||
          (req.user!.role === 'admin' && (await can(req.user, 'messages'))));
      if (!allowed) return res.status(404).json({ error: 'File not found.' });
      const stored = await objects.get('support/' + m!.file);
      if (!stored) return res.status(404).json({ error: 'File not found.' });
      // A stored file never changes, so the browser may keep its own private copy.
      res.setHeader('Cache-Control', 'private, max-age=86400, immutable');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (m!.file_type === 'application/pdf') res.attachment(m!.file_name);
      res.type(m!.file_type).send(stored.body);
    },
  );

  /** Every conversation, newest first, with who it is with and who is handling it. */
  app.get('/api/admin/support', staff, async (req: AuthRequest, res) => {
    const [threads, contact, team] = await Promise.all([
      all(
        `SELECT t.user_id,t.status,t.assigned_to,t.staff_unread,t.user_unread,t.last_text,t.last_staff,t.last_at,t.created_at,t.staff_delivered_at,t.user_read_at,
           u.name,u.email,u.phone,u.role,o.name outlet_name,a.name assigned_name
         FROM support_threads t JOIN users u ON u.id=t.user_id
         LEFT JOIN outlets o ON o.user_id=u.id LEFT JOIN users a ON a.id=t.assigned_to
         ORDER BY t.last_at DESC LIMIT 500`,
      ),
      one("SELECT COUNT(*) total,COUNT(*) FILTER (WHERE status='new') fresh FROM messages"),
      all(
        "SELECT u.id,u.name,a.super,a.permissions FROM users u JOIN admin_access a ON a.user_id=u.id WHERE u.role='admin' AND u.active=1",
      ),
    ]);
    // The inbox is on screen, so everything waiting has now reached the support team.
    if (threads.some((t) => t.staff_unread > 0 && !(t.staff_delivered_at >= t.last_at)))
      await markDelivered();
    res.json({
      me: req.user!.id,
      threads: threads.map(({ staff_delivered_at, ...t }) => t),
      contact: { total: Number(contact!.total), fresh: Number(contact!.fresh) },
      // Colleagues a conversation can be handed to.
      team: team
        .filter((a) => a.super || (JSON.parse(a.permissions) as string[]).includes('messages'))
        .map((a) => ({ id: a.id, name: a.name })),
    });
  });
  const owner = async (id: string) => {
    const u = await one(
      `SELECT u.id,u.name,u.email,u.phone,u.role,u.active,u.created_at,o.name outlet_name,
         (SELECT COUNT(*) FROM orders WHERE user_id=u.id) orders
       FROM users u LEFT JOIN outlets o ON o.user_id=u.id
       WHERE u.id=? AND u.role IN ('customer','outlet','rider') AND u.deleted_at IS NULL`,
      id,
    );
    if (!u) fail('Account not found.', 404);
    return u;
  };
  /** One conversation. Opening it marks the account's messages as read. */
  app.get('/api/admin/support/:id', staff, async (req, res) => {
    const id = String(req.params.id);
    const [user, thread, messages] = await Promise.all([
      owner(id),
      one(
        'SELECT status,assigned_to,staff_unread,last_at,user_delivered_at,user_read_at FROM support_threads WHERE user_id=?',
        id,
      ),
      conversation(id, true),
    ]);
    if (thread?.staff_unread)
      await run(
        'UPDATE support_threads SET staff_unread=0,staff_read_at=?,staff_delivered_at=? WHERE user_id=?',
        now(),
        now(),
        id,
      );
    res.json({
      user: { ...user, orders: Number(user.orders) },
      thread: thread
        ? {
            status: thread.status,
            assigned_to: thread.assigned_to,
            last_at: thread.last_at,
            // Up to when the account has received and read the support team's replies.
            delivered_at: thread.user_delivered_at,
            seen_at: thread.user_read_at,
          }
        : null,
      messages,
    });
  });
  app.post(
    '/api/admin/support/:id/messages',
    staff,
    upload,
    atomicRoute(async (req: AuthRequest, res) => {
      res.status(201).json(await post(await owner(String(req.params.id)), req.user!, true, req));
    }),
  );
  /** Closes or reopens a conversation, or hands it to a colleague. */
  app.patch(
    '/api/admin/support/:id',
    staff,
    atomicRoute(async (req, res) => {
      const id = String(req.params.id);
      const p = z
        .object({
          status: z.enum(['open', 'closed']).optional(),
          assigned_to: z.string().max(100).nullable().optional(),
        })
        .parse(req.body);
      if (p.assigned_to && !(await one("SELECT id FROM users WHERE id=? AND role='admin' AND active=1", p.assigned_to)))
        fail('Choose an active administrator.');
      const { changes } = await run(
        `UPDATE support_threads SET status=COALESCE(?,status),assigned_to=${p.assigned_to === undefined ? 'assigned_to' : '?'} WHERE user_id=?`,
        ...[p.status ?? null, ...(p.assigned_to === undefined ? [] : [p.assigned_to]), id],
      );
      if (!changes) fail('Conversation not found.', 404);
      res.json({ ok: true });
    }),
  );
  app.delete(
    '/api/admin/support/:id',
    staff,
    atomicRoute(async (req, res) => {
      await deleteSupport(String(req.params.id));
      res.json({ ok: true });
    }),
  );
  /** Works a contact form message through new, read and resolved, with a private note. */
  app.patch(
    '/api/admin/messages/:id',
    staff,
    atomicRoute(async (req, res) => {
      const p = z
        .object({
          status: z.enum(['new', 'read', 'resolved']).optional(),
          note: z.string().max(1000).optional(),
        })
        .parse(req.body);
      const { changes } = await run(
        'UPDATE messages SET status=COALESCE(?,status),note=COALESCE(?,note) WHERE id=?',
        p.status ?? null,
        p.note ?? null,
        String(req.params.id),
      );
      if (!changes) fail('Message not found.', 404);
      res.json({ ok: true });
    }),
  );
}
