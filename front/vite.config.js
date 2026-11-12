import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // "localhost" (no 127.0.0.1): es el origen que hay que autorizar en Google.
    host: process.env.HOST || 'localhost',
    port: 5173,
    strictPort: true,
    proxy: { '/api': `http://127.0.0.1:${process.env.API_PORT || 3001}` },
  },
});
