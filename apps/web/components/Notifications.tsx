'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  Bell,
  BellOff,
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
import { Badge, Confirm, DataTable, Empty, IconAction, Loading, PageTitle, Toggle } from './UI';

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

export function NotificationSettings() {
  const { sound, setSound, notice } = useApp();
  const [system, setSystem] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => setSystem(systemNotificationsOn()), []);
  return (
    <div className="n-settings">
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
          <Link href="/notifications" className="n-foot" onClick={() => setOpen(false)}>
            View all notifications
          </Link>
        </div>
      )}
    </div>
  );
}

export function NotificationsPage() {
  const { user, ready, refreshNotifications, notice } = useApp();
  const { data, loading, error, refresh } = useData<{ items: AppNotification[]; total: number }>(
    user ? '/notifications?limit=100' : null,
    20000,
  );
  const [clear, setClear] = useState(false);
  const router = useRouter();
  const reload = () => {
    refresh();
    refreshNotifications();
  };
  if (!ready) return <Loading />;
  if (!user)
    return (
      <div className="container page">
        <Empty title="Sign in to see notifications" href="/login?next=/notifications" action="Log in" />
      </div>
    );
  return (
    <div className="container page">
      <PageTitle
        eyebrow="Inbox"
        title="Notifications"
        actions={
          <>
            <button
              className="button ghost"
              onClick={async () => {
                await api('/notifications/read-all', { method: 'POST' });
                reload();
              }}
            >
              <CheckCheck size={16} /> Mark all read
            </button>
            <button className="button ghost" onClick={() => setClear(true)}>
              <Trash2 size={16} /> Clear read
            </button>
          </>
        }
      />
      <div className="card settings-card">
        <div>
          <strong>Alert preferences</strong>
          <small className="muted">Applies to this browser and device.</small>
        </div>
        <NotificationSettings />
      </div>
      <DataTable
        rows={data?.items}
        loading={loading}
        error={error}
        onRetry={refresh}
        rowKey={(n) => n.id}
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
            options: ['order', 'delivery', 'payment', 'earning', 'payout', 'message'].map((t) => ({
              value: t,
              label: label(t),
            })),
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
      <Confirm
        open={clear}
        title="Clear read notifications?"
        confirm="Clear"
        danger
        onClose={() => setClear(false)}
        onConfirm={async () => {
          await api('/notifications', { method: 'DELETE' });
          setClear(false);
          reload();
          notice('Read notifications cleared.');
        }}
      >
        Unread notifications are kept.
      </Confirm>
    </div>
  );
}
