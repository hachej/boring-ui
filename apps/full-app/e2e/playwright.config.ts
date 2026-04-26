import { defineConfig, devices } from '@playwright/test'

const apiPort = Number(process.env.FULL_APP_SMOKE_PORT ?? 3900)
const apiOrigin = `http://127.0.0.1:${apiPort}`
const baseURL = process.env.FULL_APP_SMOKE_BASE_URL ?? 'http://127.0.0.1:5173'
const isCI = process.env.CI === 'true' || process.env.CI === '1'

export default defineConfig({
  testDir: '.',
  testMatch: ['smoke.spec.ts', 'collaboration.spec.ts'],
  fullyParallel: false,
  workers: 1,
  retries: isCI ? 1 : 0,
  timeout: 60_000,
  reporter: isCI ? [['line'], ['html', { open: 'never' }]] : 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  webServer: {
    command: `PORT=${apiPort} BETTER_AUTH_URL=${apiOrigin} pnpm dev`,
    url: baseURL,
    timeout: 180_000,
    reuseExistingServer: !isCI,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
