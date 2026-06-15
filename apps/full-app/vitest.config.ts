import { defineConfig } from 'vitest/config'

// Unit tests only (server config/guards). The Playwright e2e specs under e2e/
// are run separately via `pnpm e2e`, not vitest.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
