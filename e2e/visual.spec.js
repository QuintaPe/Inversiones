// Capturas de cada sección, para comparar antes y después de un cambio de estilos.
// Solo con VISUAL=1 (npm run e2e:visual / e2e:visual:base).
import { test, expect } from '@playwright/test';
import { settled, SECTIONS, APPLE } from './helpers.js';

test.skip(!process.env.VISUAL, 'Comparación visual solo con VISUAL=1');

const PAGES = [...SECTIONS.map(([r]) => [r, `/${r}`]), ['activo', `/activo/${APPLE}`]];

for (const [name, url] of PAGES) {
  test(`captura: ${name}`, async ({ page }) => {
    await page.goto(url);
    await settled(page);
    // Las listas largas solo pintan lo cercano a la pantalla (content-visibility); en la captura
    // de página completa se pinta todo.
    await page.addStyleTag({ content: '.ops-m{content-visibility:visible!important}' });
    await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true });
  });
}
