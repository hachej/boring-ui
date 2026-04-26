import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:5200',
    headless: true,
  },
  webServer: {
    command: 'pnpm dev',
    port: 5200,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
