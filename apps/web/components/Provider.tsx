'use client';
import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';
import Link from 'next/link';
import { Bell, CheckCircle2, X } from 'lucide-react';
import { api, currentPosition, distanceKm } from '@/lib/api';
import {
  playChime,
  unlockAudio,
  registerWorker,
  showSystemNotification,
} from '@/lib/notify';
import type { User, Location, CartItem, Product, AppNotification } from '@/lib/types';

type AreaStatus = 'loading' | 'detecting' | 'ready' | 'outside' | 'unknown';
type Toast = { id: string; title: string; body?: string; link?: string; kind: 'info' | 'alert' };
type Context = {
  user: User | null;
  setUser: (u: User | null) => void;
  ready: boolean;
  locations: Location[];
  area: Location | null;
  areaStatus: AreaStatus;
  coords: { lat: number; lng: number } | null;
  setArea: (a: Location) => void;
  detectArea: () => Promise<void>;
  cart: CartItem[];
  inCart: (id: string) => boolean;
  add: (p: Product, q?: number) => boolean;
  quantity: (id: string, q: number) => void;
  clear: () => void;
  notice: (s: string) => void;
  logout: () => Promise<void>;
  locationOpen: boolean;
  openLocation: (v: boolean) => void;
  notifications: AppNotification[];
  unread: number;
  refreshNotifications: () => void;
  sound: boolean;
  setSound: (v: boolean) => void;
};
const State = createContext<Context | null>(null);
export const useApp = () => useContext(State)!;

function nearest(locations: Location[], p: { lat: number; lng: number }) {
  let best: { l: Location; km: number } | null = null;
  for (const l of locations) {
    const km = distanceKm(p, l);
    if (!best || km < best.km) best = { l, km };
  }
  return best && best.km <= (best.l.radius ?? 8) ? best.l : null;
}
const read = (k: string) => {
  try {
    return localStorage.getItem(k) || '';
  } catch {
    return '';
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {}
};

export default function Provider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [locations, setLocations] = useState<Location[]>([]);
  const [area, setAreaState] = useState<Location | null>(null);
  const [areaStatus, setAreaStatus] = useState<AreaStatus>('loading');
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [locationOpen, openLocation] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [sound, setSoundState] = useState(true);
  const seen = useRef<Set<string> | null>(null);
  const soundRef = useRef(true);

  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((all) => [...all.slice(-3), { ...t, id }]);
    setTimeout(() => setToasts((all) => all.filter((x) => x.id !== id)), t.kind === 'alert' ? 8000 : 4500);
  }, []);
  const notice = useCallback((s: string) => push({ title: s, kind: 'info' }), [push]);

  const detectWith = useCallback(async (list: Location[], fallback: Location | null) => {
    setAreaStatus('detecting');
    try {
      const p = await currentPosition();
      setCoords({ lat: p.lat, lng: p.lng });
      write('dellvit-coords', JSON.stringify({ lat: p.lat, lng: p.lng }));
      const match = nearest(list, p);
      if (match) {
        setAreaState(match);
        write('dellvit-area', match.id);
        setAreaStatus('ready');
      } else {
        setAreaState(fallback);
        setAreaStatus(fallback ? 'ready' : 'outside');
      }
    } catch {
      setAreaState(fallback);
      setAreaStatus(fallback ? 'ready' : 'unknown');
    }
  }, []);

  useEffect(() => {
    try {
      const saved = JSON.parse(read('dellvit-cart') || '[]');
      if (Array.isArray(saved))
        setCart(
          saved.filter((x) => x.product?.id && Number.isInteger(x.quantity) && x.quantity > 0),
        );
      const c = JSON.parse(read('dellvit-coords') || 'null');
      if (c && typeof c.lat === 'number') setCoords(c);
    } catch {}
    setSoundState(read('dellvit-sound') !== 'off');
    soundRef.current = read('dellvit-sound') !== 'off';
    setHydrated(true);
    registerWorker();
    const unlock = () => unlockAudio();
    window.addEventListener('pointerdown', unlock, { once: true });
    Promise.all([api<{ user: User | null }>('/session'), api<Location[]>('/locations')])
      .then(([s, l]) => {
        setUser(s.user);
        setLocations(l);
        const saved = l.find((a) => a.id === read('dellvit-area'));
        const account = l.find((a) => a.id === s.user?.location_id) || null;
        if (saved) {
          setAreaState(saved);
          setAreaStatus('ready');
        } else detectWith(l, account);
      })
      .catch((e) => {
        notice(e.message);
        setAreaStatus('unknown');
      })
      .finally(() => setReady(true));
    return () => window.removeEventListener('pointerdown', unlock);
  }, [detectWith, notice]);

  useEffect(() => {
    const reload = () => {
      api<Location[]>('/locations')
        .then((l) => {
          setLocations(l);
          setAreaState((a) => (a ? l.find((x) => x.id === a.id) || null : a));
        })
        .catch(() => {});
      api<{ user: User | null }>('/session')
        .then((s) => setUser(s.user))
        .catch(() => {});
    };
    window.addEventListener('focus', reload);
    const timer = setInterval(reload, 60000);
    return () => {
      window.removeEventListener('focus', reload);
      clearInterval(timer);
    };
  }, []);

  const refreshNotifications = useCallback(() => {
    if (!user) return;
    api<{ items: AppNotification[]; unread: number }>('/notifications?limit=8')
      .then((d) => {
        setNotifications(d.items);
        setUnread(d.unread);
        const known = seen.current;
        const fresh = known ? d.items.filter((n) => !n.read && !known.has(n.id)) : [];
        seen.current = new Set([...(known || []), ...d.items.map((n) => n.id)]);
        if (!fresh.length) return;
        if (soundRef.current) playChime();
        for (const n of fresh.slice(0, 3).reverse()) {
          push({ title: n.title, body: n.body, link: n.link, kind: 'alert' });
          if (document.hidden) showSystemNotification(n);
        }
      })
      .catch(() => {});
  }, [user, push]);

  useEffect(() => {
    seen.current = null;
    setNotifications([]);
    setUnread(0);
    if (!user) return;
    refreshNotifications();
    const timer = setInterval(refreshNotifications, 12000);
    window.addEventListener('focus', refreshNotifications);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refreshNotifications);
    };
  }, [user?.id, refreshNotifications]);

  useEffect(() => {
    if (hydrated) write('dellvit-cart', JSON.stringify(cart));
  }, [cart, hydrated]);

  const setArea = (a: Location) => {
    setAreaState(a);
    setAreaStatus('ready');
    write('dellvit-area', a.id);
    openLocation(false);
  };
  function add(p: Product, q = 1) {
    if (p.stock === 0) {
      notice('This item is sold out.');
      return false;
    }
    if (cart.length && cart[0].product.outlet_id !== p.outlet_id) {
      notice('Your cart has items from another outlet. Clear it to order from here.');
      return false;
    }
    if (area && p.location_id !== area.id) {
      notice('This item is not available in your selected area.');
      openLocation(true);
      return false;
    }
    const existing = cart.find((i) => i.product.id === p.id);
    if ((existing?.quantity || 0) + q > p.stock) {
      notice('That quantity is not available.');
      return false;
    }
    setCart((c) => {
      const old = c.find((i) => i.product.id === p.id);
      return old
        ? c.map((i) => (i.product.id === p.id ? { product: p, quantity: i.quantity + q } : i))
        : [...c, { product: p, quantity: q }];
    });
    notice('Added to cart');
    return true;
  }
  async function logout() {
    try {
      await api('/auth/logout', { method: 'POST' });
      setUser(null);
    } catch (e) {
      notice((e as Error).message);
    }
  }
  return (
    <State.Provider
      value={{
        user,
        setUser,
        ready,
        locations,
        area,
        areaStatus,
        coords,
        setArea,
        detectArea: () => detectWith(locations, area),
        cart,
        inCart: (id) => cart.some((i) => i.product.id === id),
        add,
        quantity: (id, q) =>
          setCart((c) =>
            q <= 0
              ? c.filter((i) => i.product.id !== id)
              : c.map((i) =>
                  i.product.id === id ? { ...i, quantity: Math.min(q, i.product.stock, 99) } : i,
                ),
          ),
        clear: () => setCart([]),
        notice,
        logout,
        locationOpen,
        openLocation,
        notifications,
        unread,
        refreshNotifications,
        sound,
        setSound: (v) => {
          setSoundState(v);
          soundRef.current = v;
          write('dellvit-sound', v ? 'on' : 'off');
          if (v) playChime();
        },
      }}
    >
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div className={'toast ' + t.kind} key={t.id}>
            <span className="toast-icon">
              {t.kind === 'alert' ? <Bell size={16} /> : <CheckCircle2 size={16} />}
            </span>
            <div className="toast-body">
              {t.link ? (
                <Link href={t.link} onClick={() => setToasts((a) => a.filter((x) => x.id !== t.id))}>
                  <strong>{t.title}</strong>
                </Link>
              ) : (
                <strong>{t.title}</strong>
              )}
              {t.body && <small>{t.body}</small>}
            </div>
            <button
              aria-label="Dismiss"
              className="toast-close"
              onClick={() => setToasts((a) => a.filter((x) => x.id !== t.id))}
            >
              <X size={15} />
            </button>
          </div>
        ))}
      </div>
    </State.Provider>
  );
}
