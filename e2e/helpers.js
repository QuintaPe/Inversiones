import { expect } from '@playwright/test';

export const SECTIONS = [
  ['resumen', null],
  ['posiciones', 'Posiciones'],
  ['operaciones', 'Operaciones'],
  ['dividendos', 'Dividendos'],
  ['fiscalidad', 'Fiscalidad'],
  ['efectivo', 'Efectivo'],
];
export const APPLE = 'US0378331005';
/** Precios fijos de la cartera de ejemplo. */
export const PRICES = {
  IE00B4L5Y983: 112.4, IE00BK5BQT80: 141.9, US0378331005: 238.15, US5949181045: 402.3, US67066G1040: 171.2,
  NL0010273215: 915.6, ES0144580Y14: 17.42, ES0148396007: 48.9, DE0008404005: 371.5, US1912161007: 61.05,
};

// Con LOGOS=0 y LIVE_QUOTES=0 no hay logotipos ni histórico de precios: esas respuestas son normales.
const EXPECTED = [/^\/api\/logos\//, /^\/api\/assets\/[^/]+\/history$/, /^\/api\/sparks$/, /^\/api\/dividends\/forecast$/];

/** Recoge errores de la consola y de la página para comprobar al final que no hubo ninguno. */
export function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Los fallos de red se miran por URL (abajo); la consola solo repite "Failed to load resource".
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text()); });
  page.on('response', (r) => {
    const u = new URL(r.url()).pathname;
    if (r.status() < 400 || EXPECTED.some((re) => re.test(u))) return;
    errors.push(`${r.status()} ${u}`);
  });
  return errors;
}

/** Espera a que la sección haya pintado: sin esqueletos ni indicadores de carga. */
export async function settled(page) {
  await page.locator('.view').first().waitFor();
  await expect(page.locator('.sk, .sk-t, .spinner')).toHaveCount(0, { timeout: 15_000 });
  await page.evaluate(() => document.fonts.ready);
}

/** Ancho que sobresale de la ventana (0 = sin scroll horizontal). */
export const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/**
 * Página con una cartera de ejemplo propia, para las pruebas que cambian datos de la cuenta
 * (categorías, topes, restaurar una copia): las seis configuraciones corren a la vez y, con la
 * cuenta compartida, se pisarían unas a otras.
 */
export async function ownAccount(browser, testInfo, { prices = false } = {}) {
  const context = await browser.newContext({ ...testInfo.project.use, storageState: undefined });
  const res = await context.request.post('/api/auth/demo');
  expect(res.ok()).toBeTruthy();
  // Sin cotizaciones en vivo, precios fijos para que haya valor de cartera (como en la cuenta compartida).
  if (prices) expect((await context.request.put('/api/prices', { data: { prices: PRICES } })).ok()).toBeTruthy();
  return context.newPage();
}
