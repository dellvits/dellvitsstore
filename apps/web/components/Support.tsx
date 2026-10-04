'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Fragment, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCheck,
  Clock,
  Eye,
  FileText,
  Headphones,
  Inbox,
  Mail,
  MessagesSquare,
  Paperclip,
  Phone,
  Reply,
  RotateCcw,
  Search,
  Send,
  Trash2,
  UserCheck,
  X,
} from 'lucide-react';
import { ago, api, date, label } from '@/lib/api';
import { useData } from '@/lib/useData';
import { useApp } from './Provider';
import { Badge, Confirm, DataTable, Empty, ErrorBox, IconAction, Loading, Modal, PageLoading, PageTitle, Stat } from './UI';

export type ChatMessage = {
  id: string;
  staff: number;
  body: string;
  file_name: string;
  file_type: string;
  file_size: number;
  created_at: string;
  /** Who on the support team wrote it; only administrators receive this. */
  sender_name?: string;
};
const fileUrl = (m: ChatMessage) => '/api/support/files/' + m.id;
const fileSize = (n: number) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
const time = (v: string) => new Date(v).toLocaleTimeString('en-PK', { hour: 'numeric', minute: '2-digit' });
function day(v: string) {
  const d = new Date(v);
  const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(v).setHours(0, 0, 0, 0)) / 86400000);
  return days === 0
    ? 'Today'
    : days === 1
      ? 'Yesterday'
      : d.toLocaleDateString('en-PK', { weekday: 'short', day: 'numeric', month: 'short', year: days > 300 ? 'numeric' : undefined });
}
const MAX_FILE = 4 * 1024 * 1024;

/** A message that has been written but not yet confirmed by the server. */
type Pending = { id: string; body: string; file: File | null; created_at: string; failed?: string };
type Receipt = 'sent' | 'delivered' | 'seen';
const receiptText: Record<Receipt, string> = { sent: 'Sent', delivered: 'Delivered', seen: 'Seen' };
/** One tick for sent, two for delivered, two blue ticks once it has been read. */
function Ticks({ state }: { state: Receipt }) {
  const Icon = state === 'sent' ? Check : CheckCheck;
  return (
    <span className={'chat-ticks ' + state} title={receiptText[state]} aria-label={receiptText[state]}>
      <Icon size={14} strokeWidth={2.4} />
    </span>
  );
}

/**
 * A conversation and the box to write in. `side` says who is looking: their own messages sit on
 * the right. A message appears the moment it is sent, with a clock until the server has it, then
 * ticks for sent, delivered and seen. Enter sends; Shift+Enter starts a new line.
 */
export function ChatView({
  messages,
  side,
  onSend,
  deliveredAt,
  seenAt,
  placeholder = 'Write a message…',
  quick = [],
  empty,
}: {
  messages: ChatMessage[];
  side: 'user' | 'staff';
  onSend: (body: string, file: File | null) => Promise<void>;
  /** Up to when the other side has received, and has read, this side's messages. */
  deliveredAt?: string | null;
  seenAt?: string | null;
  placeholder?: string;
  /** Ready-made lines offered above the box. */
  quick?: string[];
  empty?: React.ReactNode;
}) {
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [error, setError] = useState('');
  const list = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const count = useRef(0);
  const total = messages.length + pending.length;
  // Follow the conversation: jump to the newest message when one arrives or is written.
  useEffect(() => {
    const el = list.current;
    if (!el || total === count.current) return;
    el.scrollTo({ top: el.scrollHeight, behavior: count.current ? 'smooth' : 'auto' });
    count.current = total;
  }, [total]);
  async function deliver(p: Pending) {
    setPending((rows) => rows.map((x) => (x.id === p.id ? { ...x, failed: undefined } : x)));
    try {
      await onSend(p.body, p.file);
      setPending((rows) => rows.filter((x) => x.id !== p.id));
    } catch (e) {
      setPending((rows) => rows.map((x) => (x.id === p.id ? { ...x, failed: (e as Error).message } : x)));
    }
  }
  function send(e?: FormEvent) {
    e?.preventDefault();
    const body = text.trim();
    if (!body && !file) return;
    // Shown at once; the box is free for the next message while this one is on its way.
    const p: Pending = { id: crypto.randomUUID(), body, file, created_at: new Date().toISOString() };
    setPending((rows) => [...rows, p]);
    setText('');
    setFile(null);
    setError('');
    deliver(p);
  }
  function choose(f?: File) {
    if (picker.current) picker.current.value = '';
    if (!f) return;
    if (f.size > MAX_FILE) return setError('That file is larger than 4 MB.');
    setError('');
    setFile(f);
  }
  const receipt = (m: ChatMessage): Receipt =>
    seenAt && seenAt >= m.created_at ? 'seen' : deliveredAt && deliveredAt >= m.created_at ? 'delivered' : 'sent';
  return (
    <div className="chat">
      <div className="chat-list" ref={list} aria-live="polite">
        {!total && empty}
        {messages.map((m, i) => {
          const mine = side === 'staff' ? !!m.staff : !m.staff;
          const newDay = !i || day(messages[i - 1].created_at) !== day(m.created_at);
          return (
            <Fragment key={m.id}>
              {newDay && <div className="chat-day">{day(m.created_at)}</div>}
              <div className={'chat-msg ' + (mine ? 'mine' : 'theirs')}>
                <div className="chat-bubble">
                  {m.file_name &&
                    (m.file_type === 'application/pdf' ? (
                      <a className="chat-file" href={fileUrl(m)}>
                        <FileText size={20} />
                        <span>
                          <strong>{m.file_name}</strong>
                          <small>PDF · {fileSize(m.file_size)}</small>
                        </span>
                      </a>
                    ) : (
                      <a className="chat-image" href={fileUrl(m)} target="_blank" rel="noreferrer">
                        <img src={fileUrl(m)} alt={m.file_name} loading="lazy" />
                      </a>
                    ))}
                  {m.body && <p>{m.body}</p>}
                </div>
                <small className="chat-meta">
                  {/* Customers see "Support"; the team sees which colleague replied. */}
                  {m.staff ? (side === 'staff' ? m.sender_name || 'Support' : 'Support') + ' · ' : ''}
                  {time(m.created_at)}
                  {mine && <Ticks state={receipt(m)} />}
                </small>
              </div>
            </Fragment>
          );
        })}
        {pending.map((p) => (
          <div className={'chat-msg mine ' + (p.failed ? 'failed' : 'pending')} key={p.id}>
            <div className="chat-bubble">
              {p.file && (
                <span className="chat-file">
                  <Paperclip size={18} />
                  <span>
                    <strong>{p.file.name}</strong>
                    <small>{fileSize(p.file.size)}</small>
                  </span>
                </span>
              )}
              {p.body && <p>{p.body}</p>}
            </div>
            {p.failed ? (
              <small className="chat-meta failed">
                <AlertCircle size={13} /> Not sent. {p.failed}
                <button type="button" className="link" onClick={() => deliver(p)}>
                  Try again
                </button>
                <button type="button" className="link" onClick={() => setPending((rows) => rows.filter((x) => x.id !== p.id))}>
                  Remove
                </button>
              </small>
            ) : (
              <small className="chat-meta">
                {time(p.created_at)}
                <span className="chat-ticks" title="Sending" aria-label="Sending">
                  <Clock size={12} />
                </span>
              </small>
            )}
          </div>
        ))}
      </div>
      {!!quick.length && (
        <div className="chat-quick">
          {quick.map((q) => (
            <button type="button" key={q} onClick={() => setText((t) => (t ? t + ' ' : '') + q)}>
              {q}
            </button>
          ))}
        </div>
      )}
      {error && <ErrorBox error={error} />}
      {file && (
        <div className="chat-attached">
          <Paperclip size={14} />
          <span>
            {file.name} · {fileSize(file.size)}
          </span>
          <button type="button" className="icon-action" aria-label="Remove file" onClick={() => setFile(null)}>
            <X size={14} />
          </button>
        </div>
      )}
      <form className="chat-compose" onSubmit={send}>
        <input
          ref={picker}
          type="file"
          hidden
          accept="image/png,image/jpeg,image/webp,application/pdf"
          onChange={(e) => choose(e.target.files?.[0])}
        />
        <button type="button" className="header-icon" aria-label="Attach a picture or PDF" title="Attach a picture or PDF (up to 4 MB)" onClick={() => picker.current?.click()}>
          <Paperclip size={18} />
        </button>
        <textarea
          rows={Math.min(4, Math.max(1, text.split('\n').length))}
          maxLength={2000}
          value={text}
          placeholder={placeholder}
          aria-label="Message"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button className="button" disabled={!text.trim() && !file} aria-label="Send message">
          <Send size={16} /> <span className="hide-sm">Send</span>
        </button>
      </form>
    </div>
  );
}

function message(body: string, file: File | null) {
  const form = new FormData();
  form.set('body', body);
  if (file) form.set('file', file);
  return form;
}

type MyChat = {
  thread: { status: string; last_at: string; delivered_at?: string | null; seen_at?: string | null } | null;
  messages: ChatMessage[];
};
/** Adds a message the server has just saved, unless a refresh already brought it. */
const withMessage = (list: ChatMessage[], m: ChatMessage) => (list.some((x) => x.id === m.id) ? list : [...list, m]);
/**
 * The signed-in customer's, outlet's or rider's conversation with the support team. On a phone it
 * takes the whole screen, and `onBack` leaves it.
 */
export function SupportChat({ onBack }: { onBack: () => void }) {
  const { refreshNotifications } = useApp();
  const { data, setData, error, loading, refresh } = useData<MyChat>('/support', 3000);
  const { data: site } = useData<{ settings: Record<string, any> | null }>('/site');
  const off = site?.settings?.chat_enabled === false;
  // Reading the conversation clears the header badge.
  const total = data?.messages.length || 0;
  useEffect(() => {
    if (total) refreshNotifications();
  }, [total, refreshNotifications]);
  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox error={error} retry={refresh} />;
  return (
    <section className="card chat-card chat-full">
      <div className="chat-head">
        <button className="header-icon chat-exit" onClick={onBack} aria-label="Leave the chat">
          <ArrowLeft size={18} />
        </button>
        <span className="chat-avatar support">
          <Headphones size={18} />
        </span>
        <div>
          <strong>Dellvit support</strong>
          <small>
            {data?.thread?.status === 'closed'
              ? 'This conversation was closed. Send a message to open it again.'
              : site?.settings?.chat_greeting || 'Ask us anything. You can attach a picture or a PDF.'}
          </small>
        </div>
      </div>
      {off && <div className="chat-closed">Support chat is closed right now, so new messages cannot be sent. Please use the contact page.</div>}
      <ChatView
        side="user"
        messages={data?.messages || []}
        quick={total ? [] : ['Where is my order?', 'I have a problem with a payment.', 'I need to change my delivery details.']}
        empty={
          <div className="chat-empty">
            <MessagesSquare size={28} />
            <strong>How can we help?</strong>
            <span>Write your question below. Our support team replies here, and you get a notification.</span>
          </div>
        }
        deliveredAt={data?.thread?.delivered_at}
        seenAt={data?.thread?.seen_at}
        onSend={async (body, file) => {
          const m = await api<ChatMessage>('/support/messages', { method: 'POST', body: message(body, file) });
          setData((d) => d && { thread: d.thread || { status: 'open', last_at: m.created_at }, messages: withMessage(d.messages, m) });
          refresh();
        }}
      />
    </section>
  );
}

/** The storefront's support page. */
export function SupportPage() {
  const { user, ready } = useApp();
  const router = useRouter();
  if (!ready) return <PageLoading />;
  return (
    <div className="container page narrow">
      <PageTitle eyebrow="Help" title="Support chat">
        Talk to our support team about an order, a payment or your account.
      </PageTitle>
      {!user ? (
        <Empty title="Log in to chat with support" href={'/login?next=' + encodeURIComponent('/support')} action="Log in" icon={<MessagesSquare size={26} />}>
          No account yet? <Link href="/contact">Send us a message from the contact page.</Link>
        </Empty>
      ) : user.role === 'admin' ? (
        <Empty title="You are on the support team" href="/admin?tab=messages" action="Open the inbox" icon={<Inbox size={26} />} />
      ) : (
        <SupportChat onBack={() => (window.history.length > 1 ? router.back() : router.push('/'))} />
      )}
    </div>
  );
}

/** The header's message icon, with the number of messages waiting. */
export function MessageButton() {
  const { user, supportUnread } = useApp();
  if (!user) return null;
  const href =
    user.role === 'admin' ? '/admin?tab=messages' : user.role === 'customer' ? '/account?tab=support' : `/portal/${user.role}?tab=support`;
  return (
    <Link href={href} className="header-icon" aria-label={`Messages, ${supportUnread} unread`} title="Messages">
      <MessagesSquare size={19} />
      {supportUnread > 0 && <span className="dot-count">{supportUnread > 99 ? '99+' : supportUnread}</span>}
    </Link>
  );
}

/* ---------- Support team inbox ---------- */
type Thread = {
  user_id: string;
  status: 'open' | 'closed';
  assigned_to: string | null;
  assigned_name: string | null;
  staff_unread: number;
  last_text: string;
  last_staff: number;
  last_at: string;
  name: string;
  email: string;
  phone: string;
  role: 'customer' | 'outlet' | 'rider';
  outlet_name: string | null;
};
type InboxData = { me: string; threads: Thread[]; contact: { total: number; fresh: number }; team: { id: string; name: string }[] };
type Chat = {
  user: { id: string; name: string; email: string; phone: string; role: string; active: number; created_at: string; outlet_name: string | null; orders: number };
  thread: { status: string; assigned_to: string | null; delivered_at?: string | null; seen_at?: string | null } | null;
  messages: ChatMessage[];
};
const roleTone: Record<string, string> = { customer: 'info', outlet: 'purple', rider: 'warn' };
const replies = [
  'Thanks for reaching out. I am checking this for you now.',
  'Could you share your order number, please?',
  'This is sorted now. Is there anything else I can help with?',
];
const filters = [
  ['all', 'All'],
  ['waiting', 'Waiting'],
  ['mine', 'Mine'],
  ['closed', 'Closed'],
] as const;

export function SupportInbox() {
  const { notice, refreshNotifications } = useApp();
  const params = useSearchParams();
  const { data, setData, error, loading, refresh } = useData<InboxData>('/admin/support', 8000);
  const [tab, setTab] = useState<'chats' | 'contact'>(params.get('view') === 'contact' ? 'contact' : 'chats');
  const [open, setOpen] = useState<string | null>(params.get('chat'));
  const [filter, setFilter] = useState<(typeof filters)[number][0]>('all');
  const [role, setRole] = useState('');
  const [q, setQ] = useState('');
  const threads = data?.threads || [];
  const waiting = threads.filter((t) => t.staff_unread > 0);
  const shown = threads.filter(
    (t) =>
      (filter === 'all'
        ? true
        : filter === 'waiting'
          ? t.staff_unread > 0
          : filter === 'mine'
            ? t.assigned_to === data?.me && t.status === 'open'
            : t.status === 'closed') &&
      (!role || t.role === role) &&
      `${t.name} ${t.outlet_name || ''} ${t.email} ${t.phone} ${t.last_text}`.toLowerCase().includes(q.trim().toLowerCase()),
  );
  const statsBusy = loading && !data;
  const pick = (f: (typeof filters)[number][0]) => {
    setTab('chats');
    setFilter(f);
  };
  return (
    <div className="stack">
      <div className="stats">
        <Stat
          icon={<Clock size={20} />}
          label="Waiting for a reply"
          value={waiting.length}
          hint={`${waiting.reduce((n, t) => n + t.staff_unread, 0)} unread messages`}
          tone="orange"
          quiet={!waiting.length}
          loading={statsBusy}
          onClick={() => pick('waiting')}
        />
        <Stat
          icon={<MessagesSquare size={20} />}
          label="Open conversations"
          value={threads.filter((t) => t.status === 'open').length}
          hint={`${threads.filter((t) => t.status === 'closed').length} closed`}
          tone="blue"
          loading={statsBusy}
          onClick={() => pick('all')}
        />
        <Stat
          icon={<UserCheck size={20} />}
          label="Assigned to me"
          value={threads.filter((t) => t.assigned_to === data?.me && t.status === 'open').length}
          hint="Open conversations you are handling"
          tone="purple"
          loading={statsBusy}
          onClick={() => pick('mine')}
        />
        <Stat
          icon={<Mail size={20} />}
          label="Contact form"
          value={data?.contact.fresh || 0}
          hint={`New · ${data?.contact.total || 0} in total`}
          tone="green"
          quiet={!data?.contact.fresh}
          loading={statsBusy}
          onClick={() => setTab('contact')}
        />
      </div>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'chats'} className={tab === 'chats' ? 'active' : ''} onClick={() => setTab('chats')}>
          Support chat {waiting.length > 0 && <span className="tab-count">{waiting.length}</span>}
        </button>
        <button role="tab" aria-selected={tab === 'contact'} className={tab === 'contact' ? 'active' : ''} onClick={() => setTab('contact')}>
          Contact form {!!data?.contact.fresh && <span className="tab-count">{data.contact.fresh}</span>}
        </button>
      </div>
      {tab === 'contact' ? (
        <ContactInbox onChange={refresh} />
      ) : error && !data ? (
        <ErrorBox error={error} retry={refresh} />
      ) : (
        <div className={'chat-inbox' + (open ? ' has-open' : '')}>
          <aside className="card chat-threads">
            <div className="input-icon">
              <Search size={15} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, phone or message" aria-label="Search conversations" />
            </div>
            <div className="chat-filters">
              <div className="segmented">
                {filters.map(([value, text]) => (
                  <button type="button" key={value} className={filter === value ? 'selected' : ''} onClick={() => setFilter(value)}>
                    {text}
                  </button>
                ))}
              </div>
              <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Account type">
                <option value="">Everyone</option>
                <option value="customer">Customers</option>
                <option value="outlet">Outlets</option>
                <option value="rider">Riders</option>
              </select>
            </div>
            <div className="chat-thread-list">
              {statsBusy ? (
                <Loading />
              ) : !shown.length ? (
                <p className="muted chat-none">{threads.length ? 'No conversations match.' : 'No conversations yet. Messages from customers, outlets and riders appear here.'}</p>
              ) : (
                shown.map((t) => (
                  <button
                    type="button"
                    key={t.user_id}
                    className={'chat-thread' + (open === t.user_id ? ' selected' : '') + (t.staff_unread ? ' unread' : '')}
                    onClick={() => setOpen(t.user_id)}
                  >
                    <span className={'chat-avatar ' + t.role}>{(t.outlet_name || t.name).slice(0, 1).toUpperCase()}</span>
                    <span className="chat-thread-main">
                      <span className="chat-thread-top">
                        <strong>{t.outlet_name || t.name}</strong>
                        <small>{ago(t.last_at)}</small>
                      </span>
                      <span className="chat-thread-text">
                        {!!t.last_staff && <CheckCheck size={13} />}
                        {t.last_text}
                      </span>
                      <span className="chat-thread-tags">
                        <Badge tone={roleTone[t.role]}>{label(t.role)}</Badge>
                        {t.status === 'closed' && <Badge tone="neutral">Closed</Badge>}
                        {t.assigned_name && <small>{t.assigned_to === data?.me ? 'You' : t.assigned_name}</small>}
                      </span>
                    </span>
                    {t.staff_unread > 0 && <span className="dot-count static">{t.staff_unread}</span>}
                  </button>
                ))
              )}
            </div>
          </aside>
          {open ? (
            <ChatPane
              key={open}
              id={open}
              inbox={data}
              onBack={() => setOpen(null)}
              onRead={() => {
                setData((d) => d && { ...d, threads: d.threads.map((t) => (t.user_id === open ? { ...t, staff_unread: 0 } : t)) });
                refreshNotifications();
              }}
              onChange={refresh}
              onDeleted={() => {
                setOpen(null);
                refresh();
                notice('Conversation deleted.');
              }}
            />
          ) : (
            <section className="card chat-card chat-placeholder">
              <MessagesSquare size={30} />
              <strong>Select a conversation</strong>
              <span className="muted">Replies reach the customer, outlet or rider at once, with a notification.</span>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function ChatPane({
  id,
  inbox,
  onBack,
  onRead,
  onChange,
  onDeleted,
}: {
  id: string;
  inbox: InboxData | null;
  onBack: () => void;
  onRead: () => void;
  onChange: () => void;
  onDeleted: () => void;
}) {
  const { notice } = useApp();
  const { data, setData, error, loading, refresh } = useData<Chat>('/admin/support/' + id, 3000);
  const [remove, setRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  // Opening a conversation, or a new message arriving while it is open, marks it read.
  const total = data?.messages.length || 0;
  useEffect(() => {
    if (total) onRead();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total]);
  async function change(body: { status?: string; assigned_to?: string | null }, done: string) {
    setBusy(true);
    try {
      await api('/admin/support/' + id, { method: 'PATCH', body: JSON.stringify(body) });
      refresh();
      onChange();
      notice(done);
    } catch (e) {
      notice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (loading && !data)
    return (
      <section className="card chat-card chat-placeholder">
        <Loading />
      </section>
    );
  if (error && !data)
    return (
      <section className="card chat-card chat-placeholder">
        <ErrorBox error={error} retry={refresh} />
        <button className="button ghost" onClick={onBack}>
          Back to conversations
        </button>
      </section>
    );
  const u = data!.user;
  const closed = data!.thread?.status === 'closed';
  return (
    <section className="card chat-card chat-full">
      <div className="chat-head">
        <button className="header-icon chat-back" onClick={onBack} aria-label="Back to conversations">
          <ArrowLeft size={18} />
        </button>
        <span className={'chat-avatar ' + u.role}>{(u.outlet_name || u.name).slice(0, 1).toUpperCase()}</span>
        <div>
          <strong>
            {u.outlet_name || u.name} <Badge tone={roleTone[u.role]}>{label(u.role)}</Badge>
            {!u.active && <Badge tone="danger">Blocked</Badge>}
          </strong>
          <small>
            {u.outlet_name && u.name + ' · '}
            {!u.email.endsWith('.invalid') && (
              <a href={'mailto:' + u.email}>
                <Mail size={12} /> {u.email}
              </a>
            )}
            {u.phone && (
              <a href={'tel:' + u.phone}>
                <Phone size={12} /> {u.phone}
              </a>
            )}
            {u.role === 'customer' && <span>{u.orders} order{u.orders === 1 ? '' : 's'}</span>}
          </small>
        </div>
        <div className="chat-actions">
          <select
            value={data!.thread?.assigned_to || ''}
            disabled={busy || !data!.thread}
            aria-label="Handled by"
            onChange={(e) => change({ assigned_to: e.target.value || null }, e.target.value ? 'Conversation assigned.' : 'Conversation unassigned.')}
          >
            <option value="">Unassigned</option>
            {(inbox?.team || []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.id === inbox?.me ? 'Me' : a.name}
              </option>
            ))}
          </select>
          <button
            className="button ghost small"
            disabled={busy || !data!.thread}
            onClick={() => change({ status: closed ? 'open' : 'closed' }, closed ? 'Conversation reopened.' : 'Conversation closed.')}
          >
            {closed ? <RotateCcw size={14} /> : <Check size={14} />} {closed ? 'Reopen' : 'Close'}
          </button>
          <IconAction label="Delete conversation" tone="danger" onClick={() => setRemove(true)}>
            <Trash2 size={16} />
          </IconAction>
        </div>
      </div>
      {closed && <div className="chat-closed">This conversation is closed. A new message from either side opens it again.</div>}
      <ChatView
        side="staff"
        messages={data!.messages}
        quick={replies}
        placeholder={'Reply to ' + (u.outlet_name || u.name) + '…'}
        deliveredAt={data!.thread?.delivered_at}
        seenAt={data!.thread?.seen_at}
        onSend={async (body, file) => {
          const m = await api<ChatMessage>('/admin/support/' + id + '/messages', { method: 'POST', body: message(body, file) });
          setData((d) => d && { ...d, messages: withMessage(d.messages, m) });
          refresh();
          onChange();
        }}
      />
      <Confirm
        open={remove}
        title="Delete this conversation?"
        confirm="Delete"
        danger
        busy={busy}
        onClose={() => setRemove(false)}
        onConfirm={async () => {
          setBusy(true);
          try {
            await api('/admin/support/' + id, { method: 'DELETE' });
            onDeleted();
          } catch (e) {
            notice((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        Every message and file in the conversation with {u.outlet_name || u.name} will be removed for both sides. Close it
        instead to keep the history.
      </Confirm>
    </section>
  );
}

type ContactMessage = { id: string; name: string; email: string; message: string; created_at: string; status: 'new' | 'read' | 'resolved'; note: string };
const contactTone: Record<string, string> = { new: 'warn', read: 'info', resolved: 'success' };
/** Messages sent from the public contact page, worked through from new to resolved. */
function ContactInbox({ onChange }: { onChange: () => void }) {
  const { notice, refreshNotifications } = useApp();
  const { data, setData, error, loading, refresh } = useData<ContactMessage[]>('/admin/messages', 30000);
  const [view, setView] = useState<ContactMessage | null>(null);
  const [note, setNote] = useState('');
  const [remove, setRemove] = useState<ContactMessage | null>(null);
  /** Saves at once on screen; the list reloads only if the save fails. */
  async function update(m: ContactMessage, change: Partial<Pick<ContactMessage, 'status' | 'note'>>, done?: string) {
    setData((rows) => rows && rows.map((x) => (x.id === m.id ? { ...x, ...change } : x)));
    setView((v) => (v && v.id === m.id ? { ...v, ...change } : v));
    try {
      await api('/admin/messages/' + m.id, { method: 'PATCH', body: JSON.stringify(change) });
      if (done) notice(done);
      onChange();
      refreshNotifications();
    } catch (e) {
      notice((e as Error).message);
      refresh();
    }
  }
  function show(m: ContactMessage) {
    setView(m);
    setNote(m.note || '');
    if ((m.status || 'new') === 'new') update(m, { status: 'read' });
  }
  return (
    <>
      <DataTable
        rows={data}
        loading={loading}
        error={error}
        onRetry={refresh}
        rowKey={(m) => m.id}
        onRowClick={show}
        search={(m) => `${m.name} ${m.email} ${m.message} ${m.note || ''}`}
        searchPlaceholder="Search messages"
        empty="Your inbox is clear."
        filters={[
          {
            key: 'status',
            label: 'Statuses',
            options: [
              { value: 'new', label: 'New' },
              { value: 'read', label: 'Read' },
              { value: 'resolved', label: 'Resolved' },
            ],
            test: (m, v) => (m.status || 'new') === v,
          },
        ]}
        columns={[
          {
            key: 'from',
            header: 'From',
            sort: (m) => m.name.toLowerCase(),
            render: (m) => (
              <span className="cell-stack">
                <strong>{m.name}</strong>
                <small>{m.email}</small>
              </span>
            ),
          },
          {
            key: 'message',
            header: 'Message',
            render: (m) => (
              <span className="cell-stack">
                <span className="truncate wide">{m.message}</span>
                {m.note && <small>Note: {m.note}</small>}
              </span>
            ),
          },
          {
            key: 'status',
            header: 'Status',
            sort: (m) => m.status || 'new',
            render: (m) => <Badge tone={contactTone[m.status || 'new']}>{label(m.status || 'new')}</Badge>,
          },
          { key: 'date', header: 'Received', sort: (m) => m.created_at, render: (m) => date(m.created_at) },
        ]}
        actions={(m) => (
          <>
            <IconAction label="Open" onClick={() => show(m)}>
              <Eye size={16} />
            </IconAction>
            {m.status === 'resolved' ? (
              <IconAction label="Reopen" onClick={() => update(m, { status: 'read' }, 'Message reopened.')}>
                <RotateCcw size={16} />
              </IconAction>
            ) : (
              <IconAction label="Mark resolved" onClick={() => update(m, { status: 'resolved' }, 'Message resolved.')}>
                <Check size={16} />
              </IconAction>
            )}
            <IconAction label="Reply by email" href={'mailto:' + m.email}>
              <Reply size={16} />
            </IconAction>
            <IconAction label="Delete" tone="danger" onClick={() => setRemove(m)}>
              <Trash2 size={16} />
            </IconAction>
          </>
        )}
      />
      <Modal
        open={!!view}
        onClose={() => setView(null)}
        title={view?.name || 'Message'}
        footer={
          view && (
            <>
              <button
                className="button ghost"
                onClick={() =>
                  update(view, { status: view.status === 'resolved' ? 'read' : 'resolved' }, view.status === 'resolved' ? 'Message reopened.' : 'Message resolved.')
                }
              >
                {view.status === 'resolved' ? 'Reopen' : 'Mark resolved'}
              </button>
              <a className="button" href={'mailto:' + view.email + '?subject=' + encodeURIComponent('Re: your message to Dellvit')}>
                <Reply size={16} /> Reply by email
              </a>
            </>
          )
        }
      >
        {view && (
          <div className="stack">
            <small className="muted">
              {view.email} · {date(view.created_at)} · <Badge tone={contactTone[view.status || 'new']}>{label(view.status || 'new')}</Badge>
            </small>
            <p className="message-body">{view.message}</p>
            <label>
              Private note
              <textarea rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was done, who called back…" />
            </label>
            <div>
              <button className="button ghost small" disabled={note === (view.note || '')} onClick={() => update(view, { note }, 'Note saved.')}>
                Save note
              </button>
            </div>
          </div>
        )}
      </Modal>
      <Confirm
        open={!!remove}
        title="Delete message?"
        danger
        confirm="Delete"
        onClose={() => setRemove(null)}
        onConfirm={async () => {
          try {
            await api('/admin/messages/' + remove!.id, { method: 'DELETE' });
            setRemove(null);
            refresh();
            onChange();
            notice('Message deleted.');
          } catch (e) {
            notice((e as Error).message);
          }
        }}
      />
    </>
  );
}
