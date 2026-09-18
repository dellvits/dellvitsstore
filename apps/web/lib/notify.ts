'use client';
import { api } from './api';

let audio: AudioContext | null = null;
/** Browsers only allow audio after a user gesture; call this from any interaction. */
export function unlockAudio() {
  try {
    audio ??= new (window.AudioContext || (window as any).webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
  } catch {}
}
/** A short two-note chime generated with Web Audio (no audio file needed). */
export function playChime() {
  try {
    unlockAudio();
    if (!audio) return;
    const t = audio.currentTime;
    [880, 1318.5].forEach((freq, i) => {
      const osc = audio!.createOscillator();
      const gain = audio!.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t + i * 0.14);
      gain.gain.exponentialRampToValueAtTime(0.25, t + i * 0.14 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.14 + 0.45);
      osc.connect(gain).connect(audio!.destination);
      osc.start(t + i * 0.14);
      osc.stop(t + i * 0.14 + 0.5);
    });
  } catch {}
}
export const notificationsSupported = () =>
  typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator;

export async function registerWorker() {
  if (!notificationsSupported() || !window.isSecureContext) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js');
  } catch {
    return null;
  }
}
function keyBytes(base64: string) {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
/** Asks for permission and subscribes this device to Web Push. */
export async function enableSystemNotifications() {
  if (!notificationsSupported())
    throw new Error('This browser does not support system notifications.');
  if (!window.isSecureContext)
    throw new Error('System notifications need HTTPS (or localhost).');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notification permission was not granted.');
  const reg = (await registerWorker()) || (await navigator.serviceWorker.ready);
  if ('PushManager' in window) {
    try {
      const { publicKey } = await api<{ publicKey: string }>('/notifications/push-key');
      const sub =
        (await reg.pushManager.getSubscription()) ||
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyBytes(publicKey),
        }));
      await api('/notifications/subscribe', { method: 'POST', body: JSON.stringify(sub.toJSON()) });
    } catch {
      /* Push may be unavailable (for example in some private windows); pop-ups still work while open. */
    }
  }
  localStorage.setItem('dellvit-system-notifications', 'on');
}
export async function disableSystemNotifications() {
  localStorage.setItem('dellvit-system-notifications', 'off');
  if (!notificationsSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager?.getSubscription();
  if (sub) {
    await api('/notifications/unsubscribe', {
      method: 'POST',
      body: JSON.stringify({ endpoint: sub.endpoint }),
    }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
}
export function systemNotificationsOn() {
  try {
    return (
      notificationsSupported() &&
      Notification.permission === 'granted' &&
      localStorage.getItem('dellvit-system-notifications') !== 'off'
    );
  } catch {
    return false;
  }
}
export async function showSystemNotification(n: {
  id: string;
  title: string;
  body: string;
  link: string;
}) {
  if (!systemNotificationsOn()) return;
  const reg = await navigator.serviceWorker.getRegistration();
  const options = {
    body: n.body,
    icon: '/images/app-logo.webp',
    badge: '/images/app-logo.webp',
    tag: n.id,
    data: { link: n.link || '/' },
  };
  if (reg) reg.showNotification(n.title, options);
  else new Notification(n.title, options);
}
