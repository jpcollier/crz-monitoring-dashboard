import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  optimizeDeps: {
    // DuckDB-Wasm ships its own workers and WASM; keep it out of Vite's
    // pre-bundling to avoid the optimizer mangling the worker bootstrapping.
    exclude: ['@duckdb/duckdb-wasm'],
  },
  server: {
    headers: {
      // Required for SharedArrayBuffer (used by DuckDB-Wasm multi-threaded bundle).
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
})
