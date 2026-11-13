// Gestos en móvil: deslizar hacia abajo desde arriba del todo para actualizar.
import { test, expect } from '@playwright/test';
import { settled } from './helpers.js';

/** Arrastra el dedo en vertical con eventos táctiles reales (protocolo de Chrome). */
async function drag(page, x, y0, y1, steps = 12) {
  const cdp = await page.context().newCDPSession(page);
  const at = (y) => [{ x, y, id: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(y0) });
  for (let k = 1; k <= steps; k++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(y0 + ((y1 - y0) * k) / steps) });
  return () => cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

test.describe('móvil', () => {
  test.beforeEach(({ isMobile }) => test.skip(!isMobile, 'Solo en pantallas táctiles'));

  test('deslizar hacia abajo vuelve a pedir los datos', async ({ page }) => {
    await page.goto('/posiciones');
    await settled(page);
    const release = await drag(page, 200, 140, 400);
    const ptr = page.locator('.ptr');
    await expect(ptr).toHaveClass(/ready/);
    await expect(ptr).toHaveAttribute('aria-label', 'Suelta para actualizar');
    const reload = page.waitForResponse((r) => r.url().endsWith('/api/portfolio') && r.ok());
    await release();
    await reload;
    await expect(ptr).toHaveCount(0);
  });

  test('un tirón corto no actualiza', async ({ page }) => {
    await page.goto('/posiciones');
    await settled(page);
    let asked = false;
    page.on('request', (r) => { if (r.url().endsWith('/api/portfolio')) asked = true; });
    const release = await drag(page, 200, 140, 200);
    await expect(page.locator('.ptr')).not.toHaveClass(/ready/);
    await release();
    await expect(page.locator('.ptr')).toHaveCount(0);
    expect(asked).toBe(false);
  });

  test('con la página bajada, deslizar hace scroll normal', async ({ page }) => {
    await page.goto('/posiciones');
    await settled(page);
    await page.evaluate(() => window.scrollTo(0, 300));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    const release = await drag(page, 200, 300, 500);
    await expect(page.locator('.ptr')).toHaveCount(0);
    await release();
  });
});
