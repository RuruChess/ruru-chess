import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const serverPort = Number(process.env.KNIGHTBASE_PORT ?? 4747);

export default defineConfig({
  plugins: [react()],
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist/web',
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
  },
  server: {
    port: 5317,
    strictPort: false,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${serverPort}`,
        changeOrigin: true,
        // τα Server-Sent Events δεν πρέπει να «μαζεύονται»
        configure: (proxy) => {
          // ο server δέχεται μόνο το δικό του Origin (guard.ts): του δίνεται μόνο για αιτήματα της σελίδας του Vite
          proxy.on('proxyReq', (out, req) => {
            if (req.headers.origin === `http://${req.headers.host}`) out.setHeader('origin', `http://127.0.0.1:${serverPort}`);
          });
          proxy.on('proxyRes', (res) => {
            if (res.headers['content-type']?.includes('text/event-stream')) res.headers['cache-control'] = 'no-cache';
          });
        },
      },
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
