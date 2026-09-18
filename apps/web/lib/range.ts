'use client';
import { useEffect, useMemo, useState } from 'react';

export type RangeKey = 'today' | '6h' | '24h' | '7d' | '30d' | 'all' | 'custom';
/** A time-frame filter. `from`/`to` are `YYYY-MM-DD` dates used only for custom ranges. */
export type Range = { key: RangeKey; from?: string; to?: string };

export const rangeOptions: { value: RangeKey; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: '6h', label: 'Last 6 hours' },
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'all', label: 'All time' },
  { value: 'custom', label: 'Custom range' },
];
const hours: Partial<Record<RangeKey, number>> = { '6h': 6, '24h': 24, '7d': 168, '30d': 720 };

/** Start and end timestamps (ms) for a range; `null` means open-ended. */
export function bounds(r: Range, now = Date.now()): { from: number | null; to: number | null } {
  if (r.key === 'all') return { from: null, to: null };
  if (r.key === 'today') {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return { from: d.getTime(), to: null };
  }
  if (r.key === 'custom') {
    const from = r.from ? new Date(r.from + 'T00:00:00').getTime() : null;
    const to = r.to ? new Date(r.to + 'T23:59:59.999').getTime() : null;
    return { from, to };
  }
  return { from: now - (hours[r.key] || 0) * 3600000, to: null };
}
export function inRange(value: string | null | undefined, r: Range) {
  if (r.key === 'all') return true;
  if (!value) return false;
  const t = new Date(value).getTime();
  const b = bounds(r);
  return (b.from === null || t >= b.from) && (b.to === null || t <= b.to);
}
export function rangeLabel(r: Range) {
  if (r.key !== 'custom') return rangeOptions.find((o) => o.value === r.key)?.label || '';
  const f = (s?: string) =>
    s ? new Date(s + 'T00:00:00').toLocaleDateString('en-PK', { day: 'numeric', month: 'short' }) : '…';
  return `${f(r.from)} – ${f(r.to)}`;
}

/**
 * Range state plus a `?from=&to=` query for the API. Relative ranges are re-evaluated every
 * minute so a dashboard left open keeps a true "last 24 hours" window.
 */
export function useRange(initial: RangeKey = '7d') {
  const [range, setRange] = useState<Range>({ key: initial });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (range.key === 'all' || range.key === 'custom') return;
    const t = setInterval(() => setTick((n) => n + 1), 60000);
    return () => clearInterval(t);
  }, [range.key]);
  const query = useMemo(() => {
    const b = bounds(range, Math.floor(Date.now() / 60000) * 60000);
    const q = new URLSearchParams();
    if (b.from !== null) q.set('from', new Date(b.from).toISOString());
    if (b.to !== null) q.set('to', new Date(b.to).toISOString());
    const s = q.toString();
    return s ? '?' + s : '';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, tick]);
  return { range, setRange, query, label: rangeLabel(range) };
}
