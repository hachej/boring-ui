import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/front/**/*.integration.test.{js,jsx,ts,tsx}'],
    testTimeout: 30_000,
    hookTimeout: 15_000,
  },
})
