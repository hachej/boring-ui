import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'e2e/**/*.test.ts'],
    environment: 'node',
    setupFiles: [
      './src/server/__tests__/_setup.ts',
      './src/front/__tests__/_setup.ts',
    ],
    reporters: ['default'],
  },
})
