import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/front/__tests__/setup.ts'],
    include: ['src/front/**/*.{test,spec}.{js,jsx,ts,tsx}'],
    exclude: ['src/front/__tests__/e2e/**', 'src/front/**/*.integration.test.*'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/front/components/**', 'src/front/panels/**'],
      exclude: ['src/front/__tests__/**', 'src/front/**/*.d.ts'],
    },
    css: true,
  },
})
