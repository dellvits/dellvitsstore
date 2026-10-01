/** A failed request. `code` names failures the app reacts to, such as `verify_email`. */
export type ApiError = Error & { code?: string; data?: Record<string, any> };
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch('/api' + path, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...init.headers,
    },
  });
  const data = await response
    .json()
    .catch(() => ({ error: 'Could not read the server response.' }));
  if (!response.ok)
    throw Object.assign(new Error(data.error || 'Request failed.'), { code: data.code, data });
  return data as T;
}
export const money = (amount: number) =>
  new Intl.NumberFormat('en-PK', {
    style: 'currency',
    currency: 'PKR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount / 100);
export const date = (value: string) =>
  new Date(value).toLocaleString('en-PK', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
export const label = (value: string) =>
  value.replaceAll('_', ' ').replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
const clock = (time: string) => {
  const [h, m] = time.split(':').map(Number);
  return `${h % 12 || 12}${m ? ':' + String(m).padStart(2, '0') : ''} ${h < 12 ? 'am' : 'pm'}`;
};
/** An outlet's opening hours, e.g. "9 am – 11:30 pm"; empty when it is open around the clock. */
export const openingHours = (o: { opens_at?: string; closes_at?: string }) =>
  o.opens_at && o.closes_at ? `${clock(o.opens_at)} – ${clock(o.closes_at)}` : '';
export function ago(value: string) {
  const s = Math.max(0, (Date.now() - new Date(value).getTime()) / 1000);
  if (s < 60) return 'Just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return date(value);
}
/** Great-circle distance in kilometres. */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const r = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(r(b.lat - a.lat) / 2) ** 2 +
    Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}
export function currentPosition(): Promise<{ lat: number; lng: number; accuracy: number }> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new Error('Location is not supported here.'));
    navigator.geolocation.getCurrentPosition(
      (p) =>
        resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (e) =>
        reject(
          new Error(
            e.code === e.PERMISSION_DENIED
              ? 'Location permission was denied. Allow it in your browser settings.'
              : 'We could not detect your location. Try again or enter it manually.',
          ),
        ),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  });
}
