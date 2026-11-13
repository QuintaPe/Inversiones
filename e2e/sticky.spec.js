// Cabecera fija: en Posiciones, Operaciones, Dividendos, Fiscalidad y Efectivo el título (y sus
// pestañas o filtros) se queda arriba sin moverse; en Resumen, el tipo de activo y el periodo.
import { test, expect } from '@playwright/test';
import { settled } from './helpers.js';

const CASES = [
  ['posiciones', 'Posiciones', '.sticky-sub .utabs'],
  ['operaciones', 'Operaciones', '.sticky-sub .seg'],
  ['dividendos', 'Dividendos', null],
  ['fiscalidad', 'Fiscalidad', '.sticky-sub .utabs'],
  ['efectivo', 'Efectivo', null],
];
const box = (page, sel) => page.locator(sel).first().evaluate((el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; });

for (const [route, title, sub] of CASES) {
  test(`${route}: título${sub ? ' y pestañas' : ''} fijos al bajar`, async ({ page }) => {
    await page.goto(`/${route}`);
    await settled(page);
    // Las animaciones de entrada desplazan los bloques unos píxeles mientras duran.
    await page.evaluate(() => document.getAnimations().forEach((a) => a.finish()));
    await page.evaluate(() => window.scrollTo(0, 900));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(400);
    const bar = await box(page, '.bar');
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeInViewport();
    const h = await box(page, '.page-h');
    expect(Math.abs(h.top - bar.bottom)).toBeLessThan(1.5);
    if (sub) {
      const s = await box(page, '.sticky-sub');
      expect(Math.abs(s.top - h.bottom)).toBeLessThan(1.5);
    }
  });
}

test('el título no se mueve al hacer scroll', async ({ page }) => {
  await page.goto('/posiciones');
  await settled(page);
  const top = () => page.getByRole('heading', { level: 1 }).evaluate((e) => e.getBoundingClientRect().top);
  const t0 = await top();
  for (const y of [10, 60, 400]) {
    await page.evaluate((v) => window.scrollTo(0, v), y);
    await page.waitForTimeout(50);
    expect(Math.abs((await top()) - t0)).toBeLessThan(1);
  }
});

test('en Resumen se quedan fijos el tipo de activo y el periodo, que afectan a toda la página', async ({ page }) => {
  await page.goto('/resumen');
  await settled(page);
  const period = page.getByRole('group', { name: 'Periodo' });
  await expect(period).toHaveCount(1); // uno solo: ya no está también bajo la gráfica
  await page.evaluate(() => document.getAnimations().forEach((a) => a.finish()));
  await page.evaluate(() => window.scrollTo(0, 1200));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(600);
  await expect(period).toBeInViewport();
  const bar = await box(page, '.bar'), h = await box(page, '.page-h');
  expect(Math.abs(h.top - bar.bottom)).toBeLessThan(1.5);
  await period.getByRole('button', { name: '1A' }).click();
  await expect(page).toHaveURL('/resumen?periodo=1a');
  await expect(page.getByText(/Periodo: en un año|Resultado/).first()).toBeAttached();
});
