'use client';
import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { api } from '@/lib/api';
import type { User, Location, CartItem, Product } from '@/lib/types';
type Context = {
  user: User | null;
  setUser: (u: User | null) => void;
  ready: boolean;
  locations: Location[];
  area: Location | null;
  setArea: (a: Location) => void;
  cart: CartItem[];
  add: (p: Product, q?: number) => boolean;
  quantity: (id: string, q: number) => void;
  clear: () => void;
  notice: (s: string) => void;
  logout: () => Promise<void>;
  locationOpen: boolean;
  openLocation: (v: boolean) => void;
};
const State = createContext<Context | null>(null);
export const useApp = () => useContext(State)!;
export default function Provider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [locations, setLocations] = useState<Location[]>([]);
  const [area, setAreaState] = useState<Location | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [toast, setToast] = useState('');
  const [locationOpen, openLocation] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('dellvit-cart') || '[]');
      if (Array.isArray(saved))
        setCart(
          saved.filter((x) => x.product?.id && Number.isInteger(x.quantity) && x.quantity > 0),
        );
    } catch {}
    setHydrated(true);
    Promise.all([api<{ user: User | null }>('/session'), api<Location[]>('/locations')])
      .then(([s, l]) => {
        setUser(s.user);
        setLocations(l);
        let saved = '';
        try {
          saved = localStorage.getItem('dellvit-area') || '';
        } catch {}
        setAreaState(
          l.find((a) => a.id === saved) ||
            l.find((a) => a.id === s.user?.location_id) ||
            l[0] ||
            null,
        );
      })
      .catch((e) => setToast(e.message))
      .finally(() => setReady(true));
  }, []);
  useEffect(() => {
    if (hydrated)
      try {
        localStorage.setItem('dellvit-cart', JSON.stringify(cart));
      } catch {}
  }, [cart, hydrated]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 5000);
    return () => clearTimeout(t);
  }, [toast]);
  const notice = useCallback((s: string) => setToast(s), []);
  const setArea = (a: Location) => {
    setAreaState(a);
    try {
      localStorage.setItem('dellvit-area', a.id);
    } catch {}
    openLocation(false);
  };
  function add(p: Product, q = 1) {
    if (p.stock === 0) {
      notice('This item is sold out.');
      return false;
    }
    if (cart.length && cart[0].product.outlet_id !== p.outlet_id) {
      notice('Your basket has items from another outlet. Clear it in Cart to start a new order.');
      return false;
    }
    if (area && p.location_id !== area.id) {
      notice('Choose this product’s delivery area first.');
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
    notice('Added to your basket.');
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
        setArea,
        cart,
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
      }}
    >
      {children}
      {toast && (
        <div className="toast" role="status">
          {toast}
          <button aria-label="Dismiss message" onClick={() => setToast('')}>
            ×
          </button>
        </div>
      )}
    </State.Provider>
  );
}
