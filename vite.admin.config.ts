import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: 'src/admin',
  base: './',
  build: {
    outDir: '../../dist/admin',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/admin/src'),
    },
    dedupe: ['react', 'react-dom'],
  },
  // Phase 63 (AUTH-01): Proxy /api to backend during `npm run dev:admin`.
  // Without this, auth calls from Vite dev server (port 5173) get 404 or CORS errors.
  // DO NOT REMOVE.
  server: {
    proxy: {
      '/api': 'http://localhost:8050',
    },
  },
})
