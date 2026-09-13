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
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data as T;
}
export const money = (amount: number) =>
  new Intl.NumberFormat('en-PK', {
    style: 'currency',
    currency: 'PKR',
    maximumFractionDigits: 0,
  }).format(amount / 100);
export const date = (value: string) =>
  new Date(value).toLocaleString('en-PK', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
export const label = (value: string) => value.replaceAll('_', ' ');
