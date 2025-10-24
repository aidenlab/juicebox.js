import { build } from 'vite'
import { resolve } from 'path'

// Build minified UMD version
await build({
  build: {
    lib: {
      entry: resolve(process.cwd(), 'js/index.js'),
      name: 'juicebox',
      formats: ['umd'],
      fileName: () => 'juicebox.min.js'
    },
    rollupOptions: {
      external: []
    },
    outDir: 'dist',
    sourcemap: true,
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
        pure_funcs: ['console.log', 'debug', 'assert.*']
      }
    },
    // Don't clean the dist directory
    emptyOutDir: false
  }
})

console.log('Minified build complete!')
