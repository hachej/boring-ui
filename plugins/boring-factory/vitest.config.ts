import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Sandbox and packaging tests spawn processes; CI runners need more than the 5s default.
    testTimeout: 30_000,
    environment: 'node',
  },
})
