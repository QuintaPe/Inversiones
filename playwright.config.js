// Pruebas de extremo a extremo: el front compilado servido por el back real, con la cartera de
// ejemplo, base de datos en memoria y sin proveedores externos (cotizaciones, logos, avisos).
//   npm run e2e                  recorre la app (rutas, consola, desbordes, accesibilidad básica)
//   npm run e2e:visual:base      guarda capturas de referencia de cada sección
//   npm run e2e:visual           compara con esas capturas (para refactorizar CSS sin sorpresas)
// La cartera de ejemplo se fecha desde hoy: las capturas solo valen para comparar el mismo día,
// por eso no se versionan.
import { defineConfig, devices } from '@playwright/test';

const PORT = 3101;
const STATE = 'test-results/.auth.json';

export default defineConfig({
  testDir: 'e2e',
  snapshotPathTemplate: 'e2e/.snapshots/{projectName}/{arg}{ext}',
  fullyParallel: true,
  reporter: [['list']],
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.002, animations: 'disabled', caret: 'hide' } },
  use: { baseURL: `http://127.0.0.1:${PORT}`, locale: 'es-ES', timezoneId: 'Europe/Madrid', serviceWorkers: 'block' },
  projects: [
    { name: 'sesion', testMatch: /auth\.setup\.js/ },
    { name: 'escritorio-oscuro', use: { storageState: STATE, ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 }, colorScheme: 'dark' } , dependencies: ['sesion'] },
    { name: 'escritorio-claro', use: { storageState: STATE, ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 }, colorScheme: 'light' } , dependencies: ['sesion'] },
    { name: 'tableta-oscuro', use: { storageState: STATE, ...devices['Desktop Chrome'], viewport: { width: 820, height: 1180 }, colorScheme: 'dark' } , dependencies: ['sesion'] },
    { name: 'tableta-claro', use: { storageState: STATE, ...devices['Desktop Chrome'], viewport: { width: 820, height: 1180 }, colorScheme: 'light' } , dependencies: ['sesion'] },
    { name: 'movil-oscuro', use: { storageState: STATE, ...devices['Pixel 7'], colorScheme: 'dark' } , dependencies: ['sesion'] },
    { name: 'movil-claro', use: { storageState: STATE, ...devices['Pixel 7'], colorScheme: 'light' } , dependencies: ['sesion'] },
  ],
  webServer: {
    command: 'npm run build --prefix front && node back/src/index.js',
    url: `http://127.0.0.1:${PORT}/api/health`,
    timeout: 180_000,
    reuseExistingServer: false,
    env: {
      PORT: String(PORT), HOST: '127.0.0.1', TURSO_DATABASE_URL: ':memory:',
      LIVE_QUOTES: '0', LOGOS: '0', PUSH: '0', SESSION_SECRET: 'e2e', ALERT_SWEEP_MIN: '0', RATE_LIMIT: '0',
    },
  },
});
