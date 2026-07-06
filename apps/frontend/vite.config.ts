import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  // @chat/contract ships ESM in dist; make sure Vite pre-bundles it cleanly.
  optimizeDeps: { include: ['@chat/contract'] },
});
