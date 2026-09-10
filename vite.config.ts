import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  base: '/routemapper/',
  plugins: [react()],
  test: {
    include: ['src/**/*.test.ts', 'tools/**/*.test.mjs'],
  },
  optimizeDeps: {
    exclude: ['maplibre-gl'],
  },
})
