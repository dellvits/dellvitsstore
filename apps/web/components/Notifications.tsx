'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  Bell,
  BellOff,
  BellPlus,
  CalendarDays,
  Inbox,
  MailOpen,
  BellRing,
  Check,
  CheckCheck,
  CreditCard,
  Mail,
  Package,
  Settings2,
  Trash2,
  Truck,
  Volume2,
  VolumeX,
  Wallet,
} from 'lucide-react';
import { ago, api, date, label } from '@/lib/api';
import {
  disableSystemNotifications,
  enableSystemNotifications,
  notificationsSupported,
  systemNotificationsOn,
} from '@/lib/notify';
import { useData } from '@/lib/useData';
import type { AppNotification } from '@/lib/types';
import { useApp } from './Provider';
import { Badge, Confirm, DataTable, Empty, IconAction, PageTitle, Stat, Toggle, PageLoading } from './UI';
import type { User } from '@/lib/types';

/** Where an account reads its notifications: inside its portal, or on the store for customers. */
export const inboxPath = (user: Pick<User, 'role'>) =>
  user.role === 'admin' ? '/admin?tab=notifications' : user.role === 'customer' ? '/notifications' : `/portal/${user.role}?tab=notifications`;
/** The kinds of notification an account can silence, and who receives them. */
const kinds: { type: string; title: string; hint: string; roles?: User['role'][] }[] = [
  { type: 'order', title: 'Orders', hint: 'New orders and every change of status' },
  { type: 'delivery', title: 'Deliveries', hint: 'Pick-ups, hand-overs and delays', roles: ['admin', 'rider', 'outlet'] },
  { type: 'payment', title: 'Payments', hint: 'Payment checks, rejections and refunds', roles: ['admin', 'customer', 'outlet'] },
  { type: 'earning', title: 'Earnings', hint: 'What you earn on each delivery', roles: ['rider'] },
  { type: 'payout', title: 'Payouts', hint: 'Payout requests and payments', roles: ['admin', 'rider'] },
  { type: 'message', title: 'Messages', hint: 'Support chat and contact messages' },
];

const icons: Record<string, typeof Bell> = {
  order: Package,
  delivery: Truck,
  payment: CreditCard,
  earning: Wallet,
  payout: Wallet,
  message: Mail,
};
function TypeIcon({ type }: { type: string }) {
  const I = icons[type] || Bell;
  return (
    <span className={'n-icon ' + type}>
      <I size={16} />
    </span>
  );
}
async function mark(id: string, read: boolean) {
  await api('/notifications/' + id, { method: 'PATCH', body: JSON.stringify({ read }) });
}

/**
 * How the account is alerted. Sound and pop-ups belong to this browser; the kinds switched off
 * belong to the account and apply on every device. With `full`, each kind has its own switch.
 */
export function NotificationSettings({ full = false }: { full?: boolean }) {
  const { sound, setSound, notice, user, setUser, refreshNotifications } = useApp();
  const [system, setSystem] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => setSystem(systemNotificationsOn()), []);
  const muted = user?.notify_muted || [];
  async function mute(type: string, on: boolean) {
    if (!user) return;
    const next = on ? muted.filter((t) => t !== type) : [...muted, type];
    setUser({ ...user, notify_muted: next });
    try {
      await api('/notifications/preferences', { method: 'PUT', body: JSON.stringify({ muted: next }) });
    } catch (e) {
      setUser({ ...user, notify_muted: muted });
      notice((e as Error).message);
    }
  }
  return (
    <div className={'n-settings' + (full ? ' full' : '')}>
      <Toggle
        checked={sound}
        onChange={setSound}
        label={
          <span className="toggle-copy">
            {sound ? <Volume2 size={16} /> : <VolumeX size={16} />} Sound alerts
          </span>
        }
      />
      <Toggle
        checked={system}
        disabled={busy || !notificationsSupported()}
        onChange={async (v) => {
          setBusy(true);
          try {
            if (v) await enableSystemNotifications();
            else await disableSystemNotifications();
            setSystem(v);
            notice(v ? 'System notifications enabled on this device.' : 'System notifications turned off.');
          } catch (e) {
            notice((e as Error).message);
            setSystem(false);
          } finally {
            setBusy(false);
          }
        }}
        label={
          <span className="toggle-copy">
            {system ? <BellRing size={16} /> : <BellOff size={16} />} Desktop & mobile pop-ups
          </span>
        }
      />
      {full && user && (
        <>
          <div className="n-kinds">
            <small className="muted">Alert me about</small>
            {kinds
              .filter((k) => !k.roles || k.roles.includes(user.role))
              .map((k) => (
                <Toggle
                  key={k.type}
                  checked={!muted.includes(k.type)}
                  onChange={(v) => mute(k.type, v)}
                  label={
                    <span className="cell-stack">
                      <strong>{k.title}</strong>
                      <small>{k.hint}</small>
                    </span>
                  }
                />
              ))}
            <small className="muted">A kind you switch off still arrives in your inbox, without the sound or the pop-up.</small>
          </div>
          <div>
            <button
              type="button"
              className="button ghost small"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api('/notifications/test', { method: 'POST' });
                  refreshNotifications();
                } catch (e) {
                  notice((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <BellPlus size={15} /> Send a test notification
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function NotificationBell() {
  const { notifications, unread, refreshNotifications, user } = useApp();
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  if (!user) return null;
  return (
    <div className="bell" ref={ref}>
      <button
        className={'header-icon' + (open ? ' active' : '')}
        aria-label={`Notifications, ${unread} unread`}
        onClick={() => {
          setOpen(!open);
          setSettings(false);
        }}
      >
        <Bell size={19} />
        {unread > 0 && <span className="dot-count">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="dropdown n-panel">
          <div className="n-head">
            <strong>Notifications</strong>
            <div>
              <button
                className="icon-action"
                title="Mark all as read"
                aria-label="Mark all as read"
                disabled={!unread}
                onClick={async () => {
                  await api('/notifications/read-all', { method: 'POST' });
                  refreshNotifications();
                }}
              >
                <CheckCheck size={16} />
              </button>
              <button
                className={'icon-action' + (settings ? ' on' : '')}
                title="Notification settings"
                aria-label="Notification settings"
                onClick={() => setSettings(!settings)}
              >
                <Settings2 size={16} />
              </button>
            </div>
          </div>
          {settings && <NotificationSettings />}
          <div className="n-list">
            {!notifications.length ? (
              <div className="n-empty">
                <Bell size={22} />
                You’re all caught up.
              </div>
            ) : (
              notifications.map((n) => (
                <button
                  key={n.id}
                  className={'n-item' + (n.read ? '' : ' unread')}
                  onClick={async () => {
                    setOpen(false);
                    if (!n.read) await mark(n.id, true).catch(() => {});
                    refreshNotifications();
                    if (n.link) router.push(n.link);
                  }}
                >
                  <TypeIcon type={n.type} />
                  <span className="n-text">
                    <strong>{n.title}</strong>
                    {n.body && <small>{n.body}</small>}
                    <em>{ago(n.created_at)}</em>
                  </span>
                </button>
              ))
            )}
          </div>
          <Link href={inboxPath(user)} className="n-foot" onClick={() => setOpen(false)}>
            View all notifications
          </Link>
        </div>
      )}
    </div>
  );
}

/** The account's inbox. `embedded` shows it inside a portal, without the page frame. */
export function NotificationsPage({ embedded = false }: { embedded?: boolean }) {
  const { user, ready, refreshNotifications, notice } = useApp();
  // The inbox loads a hundred at a time; older ones are fetched on request.
  const [limit, setLimit] = useState(100);
  const { data, loading, error, refresh } = useData<{ items: AppNotification[]; total: number; unread: number }>(
    user ? '/notifications?limit=' + limit : null,
    20000,
    'notifications',
  );
  const [clear, setClear] = useState<'read' | 'all' | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const reload = () => {
    refresh();
    refreshNotifications();
  };
  if (!ready) return <PageLoading />;
  if (!user)
    return (
      <div className="container page">
        <Empty title="Sign in to see notifications" href="/login?next=/notifications" action="Log in" />
      </div>
    );
  const items = data?.items || [];
  const today = new Date().setHours(0, 0, 0, 0);
  const statsBusy = loading && !data;
  const actions = (
    <>
      <button
        className="button ghost"
        disabled={!data?.unread}
        onClick={async () => {
          await api('/notifications/read-all', { method: 'POST' });
          reload();
        }}
      >
        <CheckCheck size={16} /> Mark all read
      </button>
      <button className="button ghost" disabled={!items.some((n) => n.read)} onClick={() => setClear('read')}>
        <Trash2 size={16} /> Clear read
      </button>
      <button className="button ghost" disabled={!items.length} onClick={() => setClear('all')}>
        <Trash2 size={16} /> Clear all
      </button>
    </>
  );
  return (
    <div className={embedded ? 'stack' : 'container page stack'}>
      {embedded ? <div className="page-actions">{actions}</div> : <PageTitle eyebrow="Inbox" title="Notifications" actions={actions} />}
      <div className="stats">
        <Stat
          icon={<MailOpen size={20} />}
          label="Unread"
          value={data?.unread ?? 0}
          hint="Waiting for you"
          tone="orange"
          quiet={!data?.unread}
          loading={statsBusy}
        />
        <Stat
          icon={<CalendarDays size={20} />}
          label="Today"
          value={items.filter((n) => new Date(n.created_at).getTime() >= today).length}
          hint="Received since midnight"
          tone="blue"
          loading={statsBusy}
        />
        <Stat icon={<Inbox size={20} />} label="In your inbox" value={data?.total ?? 0} hint="Read and unread" tone="purple" loading={statsBusy} />
      </div>
      <div className="notify-layout">
        <DataTable
          rows={data?.items}
          loading={loading}
          error={error}
          onRetry={refresh}
          rowKey={(n) => n.id}
          pageSize={15}
          dateFilter={{ get: (n) => n.created_at }}
          search={(n) => n.title + ' ' + n.body}
          searchPlaceholder="Search notifications"
          filters={[
            {
              key: 'status',
              label: 'Statuses',
              options: [
                { value: 'unread', label: 'Unread' },
                { value: 'read', label: 'Read' },
              ],
              test: (n, v) => (v === 'unread' ? !n.read : !!n.read),
            },
            {
              key: 'type',
              label: 'Types',
              options: kinds
                .filter((k) => !k.roles || k.roles.includes(user.role))
                .map((k) => ({ value: k.type, label: k.title })),
              test: (n, v) => n.type === v,
            },
          ]}
          onRowClick={async (n) => {
            if (!n.read) await mark(n.id, true).catch(() => {});
            reload();
            if (n.link) router.push(n.link);
          }}
          empty="No notifications yet."
          columns={[
            {
              key: 'title',
              header: 'Notification',
              render: (n) => (
                <div className="cell-main">
                  <TypeIcon type={n.type} />
                  <span>
                    <strong className={n.read ? '' : 'unread-text'}>{n.title}</strong>
                    <small>{n.body}</small>
                  </span>
                </div>
              ),
            },
            { key: 'type', header: 'Type', render: (n) => label(n.type) },
            {
              key: 'status',
              header: 'Status',
              render: (n) => <Badge tone={n.read ? 'neutral' : 'info'}>{n.read ? 'Read' : 'Unread'}</Badge>,
            },
            {
              key: 'date',
              header: 'Received',
              sort: (n) => n.created_at,
              render: (n) => <span title={date(n.created_at)}>{ago(n.created_at)}</span>,
            },
          ]}
          actions={(n) => (
            <>
              <IconAction
                label={n.read ? 'Mark as unread' : 'Mark as read'}
                onClick={async () => {
                  await mark(n.id, !n.read);
                  reload();
                }}
              >
                <Check size={16} />
              </IconAction>
              <IconAction
                label="Delete"
                tone="danger"
                onClick={async () => {
                  await api('/notifications/' + n.id, { method: 'DELETE' });
                  reload();
                }}
              >
                <Trash2 size={16} />
              </IconAction>
            </>
          )}
        />
        <aside className="card">
          <div className="card-head">
            <h3>Alert preferences</h3>
          </div>
          <NotificationSettings full />
        </aside>
      </div>
      {!!data && data.total > items.length && limit < 500 && (
        <div className="load-more">
          <button className="button ghost" onClick={() => setLimit((n) => Math.min(500, n + 100))}>
            Load older notifications ({data.total - items.length} more)
          </button>
        </div>
      )}
      <Confirm
        open={!!clear}
        title={clear === 'all' ? 'Clear every notification?' : 'Clear read notifications?'}
        confirm="Clear"
        danger
        busy={busy}
        onClose={() => setClear(null)}
        onConfirm={async () => {
          setBusy(true);
          try {
            await api('/notifications' + (clear === 'all' ? '?all=1' : ''), { method: 'DELETE' });
            setClear(null);
            reload();
            notice(clear === 'all' ? 'Inbox cleared.' : 'Read notifications cleared.');
          } catch (e) {
            notice((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {clear === 'all' ? 'Unread notifications are removed too. This cannot be undone.' : 'Unread notifications are kept.'}
      </Confirm>
    </div>
  );
}
