// Avisos en este dispositivo (Web Push): los recibe el service worker aunque la app esté cerrada.
import * as api from '../api.js';

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

const registration = async () => (pushSupported() ? (await navigator.serviceWorker.getRegistration()) ?? null : null);
const toBytes = (b64) => Uint8Array.from(atob(b64.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

/** ¿Están activados los avisos en este dispositivo? */
export async function pushEnabled() {
  const reg = await registration().catch(() => null);
  return !!(reg && Notification.permission === 'granted' && (await reg.pushManager.getSubscription()));
}

export async function enablePush(key) {
  const reg = await registration();
  if (!reg) throw new Error('Los avisos solo funcionan en la app publicada (con HTTPS), no en modo desarrollo.');
  if ((await Notification.requestPermission()) !== 'granted') throw new Error('El navegador tiene bloqueadas las notificaciones para esta página.');
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toBytes(key) });
  await api.pushSubscribe(sub.toJSON());
  await api.pushTest().catch(() => {});
}

export async function disablePush() {
  const sub = await (await registration().catch(() => null))?.pushManager.getSubscription();
  if (!sub) return;
  await api.pushUnsubscribe(sub.endpoint).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}
