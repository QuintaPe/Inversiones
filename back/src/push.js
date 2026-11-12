// Avisos al navegador o al móvil (Web Push) aunque la app esté cerrada.
// Las claves VAPID se generan la primera vez y se guardan en la base de datos,
// así no hay nada que configurar; PUSH_SUBJECT permite indicar un contacto real.
import webpush from 'web-push';

export async function createPush({ db, subject = process.env.PUSH_SUBJECT || 'mailto:avisos@cartera.invalid', send = webpush.sendNotification.bind(webpush) }) {
  let keys = JSON.parse((await db.getSetting('vapid')) ?? 'null');
  if (!keys) {
    keys = webpush.generateVAPIDKeys();
    await db.setSetting('vapid', JSON.stringify(keys));
  }
  const options = { vapidDetails: { subject, publicKey: keys.publicKey, privateKey: keys.privateKey }, TTL: 6 * 3600 };
  return {
    publicKey: keys.publicKey,
    /** Envía { title, body, url } a todos los dispositivos del usuario. Devuelve cuántos lo recibieron. */
    async notify(userId, payload) {
      let sent = 0;
      for (const s of await db.getPushSubs(userId)) {
        try {
          await send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), options);
          sent++;
        } catch (err) {
          // 404/410: el dispositivo ya no existe o retiró el permiso.
          if (err?.statusCode === 404 || err?.statusCode === 410) await db.deletePushSub(s.endpoint).catch(() => {});
        }
      }
      return sent;
    },
  };
}
