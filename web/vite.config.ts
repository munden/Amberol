import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The API runs as a separate process in development; both /api and the
// uploaded images are proxied so the browser sees a single origin.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5310,
    host: true, // reachable from a phone or tablet on the same network
    proxy: {
      '/api': { target: 'http://127.0.0.1:4310', changeOrigin: true },
      '/uploads': { target: 'http://127.0.0.1:4310', changeOrigin: true },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
});
