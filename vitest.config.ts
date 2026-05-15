import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./packages/agent/src', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'node',
  },
})
