import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        classic2d: resolve(__dirname, '2d.html'),
        netTest: resolve(__dirname, 'net-test.html'),
      },
    },
  },
});
