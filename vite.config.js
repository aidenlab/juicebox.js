import { defineConfig } from 'vite';
import { resolve } from 'path';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { versionPlugin } from './vite-plugin-version.js';

// Plugin to suppress source map warnings for third-party dependencies
// These warnings occur because igv-ui and igv reference CSS source maps that don't exist
function suppressSourceMapWarnings() {
  return {
    name: 'suppress-sourcemap-warnings',
    configureServer(server) {
      // Intercept WebSocket messages to filter out source map errors
      const originalSend = server.ws.send;
      server.ws.send = function (payload) {
        if (payload.type === 'error' && payload.err) {
          const errorMessage = payload.err.message || payload.err.toString() || '';
          // Suppress warnings about missing CSS source maps for igv dependencies
          if (errorMessage.includes('igv-ui.css.map') || 
              errorMessage.includes('Failed to load source map')) {
            return; // Don't send this error to the client
          }
        }
        return originalSend.call(this, payload);
      };
    },
  };
}

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
    suppressSourceMapWarnings(),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, './'),
    },
  },
  // Custom logger to suppress source map warnings for third-party dependencies
  customLogger: {
    warn(msg, options) {
      // Filter out source map warnings for igv dependencies
      const message = typeof msg === 'string' ? msg : String(msg);
      if (message.includes('igv-ui.css.map') || 
          message.includes('Failed to load source map') ||
          (message.includes('ENOENT') && message.includes('igv'))) {
        return; // Suppress these warnings
      }
      // Use default warning logger for other messages
      console.warn(msg, options);
    },
    error(msg, options) {
      // Filter out source map errors for igv dependencies
      const message = typeof msg === 'string' ? msg : String(msg);
      if (message.includes('igv-ui.css.map') || 
          message.includes('Failed to load source map') ||
          (message.includes('ENOENT') && message.includes('igv'))) {
        return; // Suppress these errors
      }
      // Use default error logger for other messages
      console.error(msg, options);
    },
    info(msg, options) {
      console.info(msg, options);
    },
    clearScreen() {
      // Keep default clear screen behavior
    },
  },
});
