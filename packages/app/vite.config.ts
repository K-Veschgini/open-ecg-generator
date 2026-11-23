import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// Public base path. Production mode (`vite build` and `vite preview`, which both
// default to mode 'production') targets GitHub Pages at /open-ecg-generator/, so the
// preview server serves the build at the same path it was built for. The dev server
// (mode 'development') uses '/'. Override with VITE_BASE (e.g. VITE_BASE=/ npm run build,
// and the same VITE_BASE for `npm run preview`) when hosting elsewhere.
const GH_PAGES_BASE = '/open-ecg-generator/'

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: process.env.VITE_BASE || (mode === 'production' ? GH_PAGES_BASE : '/'),
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    target: 'esnext',
    outDir: 'dist',
  },
}))
