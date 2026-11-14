// Efectivo: pestañas de resumen, gastos (categorías, comercios, recurrentes, pagos), movimientos y análisis.
import { test, expect } from '@playwright/test';
import { watchErrors, settled, ownAccount } from './helpers.js';

const tab = (page, name) => page.getByRole('tab', { name }).click();

test('resumen: salud del efectivo, este mes e ingresos y gastos', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/efectivo');
  await settled(page);
  for (const k of ['Colchón', 'Gasto medio al mes', 'Tasa de ahorro', 'Rentabilidad del efectivo']) {
    await expect(page.locator('.kpi-l', { hasText: k })).toBeVisible();
  }
  await expect(page.getByRole('group', { name: 'Ingresos y gastos por mes' })).toBeVisible();
  await expect(page.locator('.mon-h')).not.toContainText(/[−-]0,00/);
  expect(errors).toEqual([]);
});

test('gastos: por categoría, comercios, recurrentes y cambiar la categoría de un comercio', async ({ browser }, testInfo) => {
  const page = await ownAccount(browser, testInfo);
  const errors = watchErrors(page);
  await page.goto('/efectivo');
  await settled(page);
  await tab(page, 'Gastos');
  await expect(page).toHaveURL(/ver=gastos/);
  await expect(page.locator('.cat-l li').first()).toBeVisible();
  await expect(page.locator('.top-m').first()).toContainText('Mercadona');
  await expect(page.locator('.rec')).toContainText('Netflix.com');

  // Mes anterior y filtro por categoría.
  const title = page.locator('.month-t');
  const before = await title.textContent();
  await page.getByRole('button', { name: 'Mes anterior' }).click();
  await expect(title).not.toHaveText(before);
  await page.locator('.cat-l button', { hasText: 'Supermercado' }).click();
  for (const t of await page.locator('.pay-d .cat-pick').allTextContents()) expect(t).toContain('Supermercado');

  // Mercadona pasa a «Hogar y suministros» en todos sus pagos, y se puede volver a la automática.
  const pick = page.getByRole('combobox', { name: 'Categoría de Mercadona' }).first();
  await pick.selectOption('home');
  await page.getByRole('button', { name: /Supermercado/ }).filter({ has: page.locator('svg') }).click().catch(() => {});
  await expect(page.locator('.top-m').first().locator('li', { hasText: 'Mercadona' })).toContainText('Hogar y suministros');
  await page.getByRole('combobox', { name: 'Categoría de Mercadona' }).first().selectOption('super');
  await expect(page.locator('.top-m').first().locator('li', { hasText: 'Mercadona' })).toContainText('Supermercado');
  expect(errors).toEqual([]);
});

test('movimientos: extracto filtrable por tipo y con búsqueda', async ({ page }) => {
  await page.goto('/efectivo?ver=movimientos');
  await settled(page);
  const st = page.locator('section.st');
  await st.getByRole('group', { name: 'Tipo de movimiento' }).getByRole('button', { name: 'Rentas' }).click();
  await expect(page).toHaveURL(/mov=rent/);
  for (const k of await st.locator('.st-c').allTextContents()) expect(k).toMatch(/Dividendo|Intereses|Saveback/);
  await st.getByRole('group', { name: 'Tipo de movimiento' }).getByRole('button', { name: 'Todo' }).click();
  await page.getByRole('searchbox', { name: 'Buscar movimiento' }).fill('netflix');
  for (const k of await st.locator('.st-c').allTextContents()) expect(k.toLowerCase()).toContain('netflix');
});

test('análisis: mapa de gasto por categoría y mes', async ({ page }) => {
  await page.goto('/efectivo?ver=analisis');
  await settled(page);
  await expect(page.getByRole('heading', { name: 'Gasto por categoría y mes' })).toBeVisible();
  await expect(page.locator('.heat tbody tr').first()).toBeVisible();
});

test('gastos: topes al mes, total y por categoría', async ({ browser }, testInfo) => {
  const page = await ownAccount(browser, testInfo);
  const errors = watchErrors(page);
  await page.goto('/efectivo?ver=gastos');
  await settled(page);
  await page.getByRole('button', { name: /topes de gasto/ }).click();
  await page.getByLabel('Tope de Todo el mes (€)').fill('5000');
  await page.getByLabel('Tope de Todo el mes (€)').press('Enter');
  await expect(page.locator('.bud')).toContainText(/Te quedan .* de tu tope de 5\.000,00/);
  await page.getByLabel('Tope de Todo el mes (€)').fill('1');
  await page.getByLabel('Tope de Todo el mes (€)').press('Enter');
  await expect(page.locator('.bud.over')).toContainText('Te has pasado');
  // Se guarda en la cuenta: sigue ahí al recargar. Vacío lo quita.
  await page.reload();
  await settled(page);
  await expect(page.locator('.bud.over')).toBeVisible();
  await page.getByRole('button', { name: /topes de gasto/ }).click();
  await page.getByLabel('Tope de Todo el mes (€)').fill('');
  await page.getByLabel('Tope de Todo el mes (€)').press('Enter');
  await expect(page.locator('.bud')).toHaveCount(0);
  expect(errors).toEqual([]);
});
