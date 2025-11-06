import { defineConfig } from 'vite';
import { resolve } from 'path';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { versionPlugin } from './vite-plugin-version.js';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  server: {
    port: 3000,
    open: '/dashboard.html',
  },
  preview: {
    port: 3000,
    open: '/dashboard.html',
  },
  css: {
    preprocessorOptions: {
      scss: {
        // SCSS options if needed
      },
    },
  },
  build: {
    lib: {
      entry: 'js/index.js',
      name: 'juicebox',
      formats: ['es', 'umd'],
      fileName: (format) => {
        if (format === 'es') return 'juicebox.esm.js';
        return 'juicebox.min.js';
      },
    },
    outDir: 'dist',
    minify: true, // Use esbuild (faster, built into Vite)
    sourcemap: true,
    cssCodeSplit: false, // Extract all CSS into a single file
    rollupOptions: {
      output: {
        assetFileNames: (assetInfo) => {
          // Ensure CSS is named juicebox.css
          if (assetInfo.name && assetInfo.name.endsWith('.css')) {
            return 'css/juicebox.css';
          }
          return assetInfo.name || 'assets/[name][extname]';
        },
      },
    },
  },
  plugins: [
    versionPlugin(),
    viteStaticCopy({
      targets: [
        { src: 'css/img', dest: 'css/' },
      ],
    }),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, './'),
    },
  },
});
