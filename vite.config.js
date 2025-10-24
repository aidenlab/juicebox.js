import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  plugins: [],
  
  // Suppress source map warnings for dependencies
  optimizeDeps: {
    exclude: ['igv', 'igv-ui']
  },
  
  // Library mode configuration
  build: {
    lib: {
      entry: resolve(__dirname, 'js/index.js'),
      name: 'juicebox',
      formats: ['es', 'umd'],
      fileName: (format) => {
        if (format === 'es') return 'juicebox.esm.js'
        if (format === 'umd') return 'juicebox.js'
      }
    },
    
    rollupOptions: {
      // External dependencies that shouldn't be bundled
      external: [],
      onwarn(warning, warn) {
        // Suppress source map warnings for dependencies
        if (warning.code === 'SOURCEMAP_ERROR') {
          return
        }
        warn(warning)
      }
    },
    
    // CSS handling
    cssCodeSplit: false,
    
    // Copy assets
    assetsInclude: ['**/*.png', '**/*.svg', '**/*.jpg', '**/*.jpeg', '**/*.gif'],
    
    // Source maps
    sourcemap: true,
    
    // Minification
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
        pure_funcs: ['console.log', 'debug', 'assert.*']
      }
    }
  },
  
  // CSS preprocessing
  css: {
    preprocessorOptions: {
      scss: {
        additionalData: `@import "${resolve(__dirname, 'css/juicebox.scss')}";`
      }
    }
  },
  
  // Development server configuration
  server: {
    port: 3000,
    open: true,
    cors: true
  },
  
  // Test configuration
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./test/setup.js'],
    include: ['test/test*.js'],
    exclude: ['test/utils/**', 'test/data/**', 'test/setup.js']
  },
  
  // Resolve configuration
  resolve: {
    alias: {
      '@': resolve(__dirname, 'js')
    }
  }
})
