/** Η σελίδα του φίλου (web/) → dist/, που τη σερβίρει το Worker. Πιόνια και ήχοι από το public/ του KnightBase. */
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: here('./web'),
  base: '/',
  publicDir: here('../public'),
  plugins: [react()],
  build: {
    outDir: here('./dist'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 1000,
    // οι άδειες όσων βιβλιοθηκών μπήκαν στο bundle· τις δείχνει το /licenses (web/licenses.tsx)
    license: { fileName: 'libraries.txt' },
  },
});
