import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * - Precarga la fuente principal, que si no se descubre tarde (al leer el CSS).
 * - Escribe asset-manifest.json con todos los JS y CSS del build: el service worker los
 *   guarda de antemano para que cualquier sección abra sin conexión, también las que se
 *   cargan bajo demanda.
 */
function shell() {
  return {
    name: 'cartera-shell',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(_html, { bundle }) {
        const font = Object.keys(bundle ?? {}).find((f) => /inter-latin-wght-normal.*\.woff2$/.test(f));
        return font ? [{ tag: 'link', attrs: { rel: 'preload', href: `/${font}`, as: 'font', type: 'font/woff2', crossorigin: '' }, injectTo: 'head' }] : [];
      },
    },
    generateBundle(_opts, bundle) {
      const files = Object.keys(bundle).filter((f) => /\.(js|css)$/.test(f)).map((f) => `/${f}`).sort();
      this.emitFile({ type: 'asset', fileName: 'asset-manifest.json', source: JSON.stringify({ files }) });
    },
  };
}

export default defineConfig({
  // React Compiler: memoriza componentes y cálculos sin useMemo/useCallback a mano, para que
  // un cambio de precio no vuelva a pintar lo que no depende de él.
  plugins: [react(process.env.REACT_COMPILER === '0' ? {} : { babel: { plugins: ['babel-plugin-react-compiler'] } }), shell()],
  server: {
    // "localhost" (no 127.0.0.1): es el origen que hay que autorizar en Google.
    host: process.env.HOST || 'localhost',
    port: 5173,
    strictPort: true,
    proxy: { '/api': `http://127.0.0.1:${process.env.API_PORT || 3001}` },
  },
});
