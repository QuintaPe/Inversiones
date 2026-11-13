// Una sola cartera de ejemplo para todas las pruebas (el back limita los accesos por IP).
import { test as setup, expect } from '@playwright/test';

export const STATE = 'test-results/.auth.json';

setup('sesión con la cartera de ejemplo', async ({ request }) => {
  const res = await request.post('/api/auth/demo');
  expect(res.ok()).toBeTruthy();
  // Sin cotizaciones en vivo, precios fijos para que todas las cifras y gráficas tengan valores.
  const prices = {
    IE00B4L5Y983: 112.4, IE00BK5BQT80: 141.9, US0378331005: 238.15, US5949181045: 402.3, US67066G1040: 171.2,
    NL0010273215: 915.6, ES0144580Y14: 17.42, ES0148396007: 48.9, DE0008404005: 371.5, US1912161007: 61.05,
  };
  expect((await request.put('/api/prices', { data: { prices } })).ok()).toBeTruthy();
  await request.storageState({ path: STATE });
});
