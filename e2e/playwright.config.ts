import { defineConfig, devices } from '@playwright/test'

const CI = process.env.CI === 'true' || process.env.CI === '1'

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  fullyParallel: false,
  workers: CI ? 1 : undefined,
  globalTimeout: CI ? 120_000 : undefined,
  timeout: 45_000,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI ? [['line'], ['html', { open: 'never' }]] : 'list',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
