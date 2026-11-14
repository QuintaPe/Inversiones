// Alertas de precio: se comprueban cuando el usuario refresca sus cotizaciones y,
// además, las vigila el servidor cada pocos minutos para avisar con la app cerrada.

const eur = (n) => n.toLocaleString('es-ES', { maximumFractionDigits: 2 });
const pct = (n) => n.toLocaleString('es-ES', { maximumFractionDigits: 2, signDisplay: 'always' });
// 'above' y 'below': el precio cruza un nivel en euros. 'move': la variación del día, hacia
// arriba o hacia abajo, llega al porcentaje guardado en `price`.
const hit = (al, q) => {
  if (al.dir === 'move') return Number.isFinite(q.info?.dayPct) && Math.abs(q.info.dayPct) >= al.price;
  return al.dir === 'above' ? q.price >= al.price : q.price <= al.price;
};

export function alertText(al, name, current, dayPct) {
  if (al.dir === 'move') return `${name} se mueve un ${pct(dayPct)} % hoy, hasta ${eur(current)} € (alerta en ±${eur(al.price)} %).`;
  return `${name} ha ${al.dir === 'above' ? 'subido hasta' : 'bajado hasta'} ${eur(current)} € (alerta en ${eur(al.price)} €).`;
}

export function createAlertWatcher({ db, quotes, push = null, log = console }) {
  /**
   * Marca como saltadas las alertas de un usuario que se cumplen con estas cotizaciones.
   * @param found  { ISIN: { price } }
   * @param names  { ISIN: nombre }
   * @param notify enviar además el aviso a sus dispositivos
   */
  async function fire(userId, alerts, found, names, notify) {
    const fired = alerts.filter((al) => !al.triggered_at && found[al.isin] && hit(al, found[al.isin]))
      .map((al) => ({ ...al, name: names[al.isin] ?? al.isin, current: found[al.isin].price, dayPct: found[al.isin].info?.dayPct ?? null }));
    await db.triggerAlerts(userId, fired.map((al) => al.id));
    if (notify && push) {
      for (const al of fired) {
        await push.notify(userId, { title: 'Alerta de precio', body: alertText(al, al.name, al.current, al.dayPct), url: `/activo/${al.isin}`, tag: `alert-${al.id}` });
      }
    }
    return fired;
  }

  let running = false;
  /** Una pasada: cotiza solo los valores con alertas pendientes. Devuelve cuántas han saltado. */
  async function sweep() {
    if (running || !quotes) return 0;
    running = true;
    try {
      const pending = await db.getPendingAlerts();
      if (!pending.length) return 0;
      const isins = [...new Set(pending.map((al) => al.isin))];
      const { quotes: found, resolved } = await quotes.quoteIsins(isins, await db.getSymbols());
      await db.saveSymbols(resolved);
      await db.setLivePrices(found);
      const names = await db.getNames(isins);
      const byUser = Map.groupBy(pending, (al) => al.user_id);
      let n = 0;
      for (const [userId, alerts] of byUser) n += (await fire(userId, alerts, found, names, true)).length;
      return n;
    } finally {
      running = false;
    }
  }

  return {
    fire, sweep,
    /** Vigila cada `minutes` minutos. Devuelve la función que lo detiene. */
    start(minutes) {
      const id = setInterval(() => sweep().catch((err) => log.error('Alertas:', err.message)), minutes * 60_000);
      id.unref();
      return () => clearInterval(id);
    },
  };
}
