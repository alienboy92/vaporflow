import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  root: import.meta.dirname,
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@bali-hub-pos/core': path.resolve(import.meta.dirname, '../core/src'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
