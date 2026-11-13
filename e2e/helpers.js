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
