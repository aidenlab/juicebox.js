import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./test/setup.js'],
    include: ['test/**/*.js'],
    exclude: ['test/utils/**', 'test/setup.js', 'test/data/**'],
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './'),
    },
  },
});

