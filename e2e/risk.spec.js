// Posiciones → Análisis: riesgo y diversificación.
import { test, expect } from '@playwright/test';
import { watchErrors, settled, overflow, APPLE } from './helpers.js';

// Las pruebas corren sin cotizaciones (no hay histórico): el informe se simula.
const KEYS = ['IE00B4L5Y983', 'IE00BK5BQT80', 'US5949181045', APPLE, 'ES0144580Y14'];
const RISK = {
  weeks: 51, vol: 13.4, weighted: 18.9, ratio: 1.41, effN: 2.9, skipped: ['US1912161007'],
  assets: [[52, 12.1, 47], [28, 12.6, 26], [9, 24.3, 14], [7, 26.8, 12], [4, 17.5, 1]].map(([w, vol, share], i) => ({ key: KEYS[i], w, vol, share })),
  corr: [[1, 0.97, 0.71, 0.68, 0.22], [0.97, 1, 0.7, 0.66, 0.25], [0.71, 0.7, 1, 0.58, -0.05], [0.68, 0.66, 0.58, 1, null], [0.22, 0.25, -0.05, null, 1]],
  pairs: [{ a: KEYS[0], b: KEYS[1], r: 0.97 }, { a: KEYS[0], b: KEYS[2], r: 0.71 }, { a: KEYS[1], b: KEYS[2], r: 0.7 }],
};

test('análisis de riesgo: sin histórico lo explica', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/posiciones?ver=analisis');
  await settled(page);
  await expect(page.getByText('Hace falta al menos tres meses de cotizaciones')).toBeVisible();
  expect(errors).toEqual([]);
});

test('análisis de riesgo: indicadores, reparto del riesgo y correlaciones', async ({ page }) => {
  const errors = watchErrors(page);
  await page.route('**/api/risk', (route) => route.fulfill({ json: { risk: RISK } }));
  await page.goto('/posiciones?ver=analisis');
  await settled(page);
  await expect(page.getByRole('tab', { name: 'Análisis' })).toBeInViewport({ ratio: 1 });
  await expect(page.locator('.kpi', { hasText: 'Volatilidad de la cartera' }).locator('.kpi-v')).toHaveText(/13,40\s%\sanual/);
  await expect(page.locator('.kpi', { hasText: 'Posiciones efectivas' }).locator('.kpi-v')).toHaveText('2,90');
  await expect(page.locator('.card', { hasText: 'Quién aporta el riesgo' }).locator('.rank-row')).toHaveCount(5);
  await expect(page.locator('.corr tbody tr')).toHaveCount(5);
  await expect(page.locator('.corr tbody tr').first().locator('td').nth(1)).toHaveText('0,97');
  await expect(page.getByText('muy parecidos')).toBeVisible();
  await expect(page.getByText(/fuera del cálculo: Coca-Cola/)).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  if (process.env.SHOT) await page.screenshot({ path: `${process.env.SHOT}/risk-${test.info().project.name}.png`, fullPage: true, animations: 'disabled' });
  await page.locator('.rank-row').first().click();
  await expect(page).toHaveURL(/\/activo\/IE00B4L5Y983$/);
  expect(errors).toEqual([]);
});
