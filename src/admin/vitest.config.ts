// Vitest config for React component tests (jsdom environment).
// Separate from root vitest.config.ts which uses node environment for unit tests.
// NOTE: resolve.dedupe for React prevents duplicate React instance errors when recharts
// pulls in its own react copy under src/admin/node_modules/react.
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const adminRoot = __dirname.replace(/\\/g, '/')

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: false,
    include: [`${adminRoot}/src/**/*.test.{ts,tsx}`],
    setupFiles: [`${adminRoot}/src/test-setup.ts`],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
    dedupe: ['react', 'react-dom'],
  },
})
