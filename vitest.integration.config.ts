import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/front/**/*.integration.test.{js,jsx,ts,tsx}'],
    testTimeout: 30_000,
    hookTimeout: 15_000,
    css: true,
  },
})
