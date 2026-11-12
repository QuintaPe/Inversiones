// Logotipos por ISIN. Se descargan una vez desde fuentes públicas y se guardan en la
// base de datos; el navegador solo habla con este servidor.
import crypto from 'node:crypto';

const PARQET = (isin) => `https://assets.parqet.com/logos/isin/${isin}?format=png&size=128`;
const FMP = (symbol) => `https://financialmodelingprep.com/image-stock/${encodeURIComponent(symbol)}.png`;
const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}\d$/;
const hash = (buf) => crypto.createHash('sha1').update(buf).digest('hex');

export function createLogos({ db, fetchImpl = fetch }) {
  let chain = Promise.resolve(); // descargas de una en una
  let placeholder; // huella de la imagen genérica que devuelve la fuente cuando no conoce el ISIN

  async function grab(url) {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(10_000) });
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok || !type.startsWith('image/')) return null;
    const data = Buffer.from(await res.arrayBuffer());
    return data.length > 100 && data.length < 300_000 ? { type, data } : null;
  }

  async function download(isin) {
    placeholder ??= await grab(PARQET('XX0000000000')).then((p) => (p ? hash(p.data) : 'none'), () => 'none');
    const a = await grab(PARQET(isin)).catch(() => null);
    if (a && hash(a.data) !== placeholder) return a;
    const symbol = (await db.getSymbols())[isin]?.symbol;
    return symbol ? grab(FMP(symbol)).catch(() => null) : null;
  }

  return {
    /** { type, data } o null si no hay logotipo para ese ISIN. */
    async get(isin) {
      if (!ISIN_RE.test(isin)) return null;
      const hit = await db.getLogo(isin);
      if (hit !== undefined) return hit;
      const run = async () => {
        const again = await db.getLogo(isin); // otra petición pudo traerlo mientras esperaba
        if (again !== undefined) return again;
        const logo = await download(isin);
        await db.saveLogo(isin, logo);
        return logo;
      };
      const p = chain.then(run, run);
      chain = p.catch(() => {});
      return p;
    },
  };
}
