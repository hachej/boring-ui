import { defineConfig, devices } from '@playwright/test'

const apiPort = Number(process.env.FULL_APP_E2E_PORT ?? 3900)
const apiOrigin = `http://127.0.0.1:${apiPort}`
const baseURL = process.env.FULL_APP_E2E_BASE_URL ?? apiOrigin
const isCI = process.env.CI === 'true' || process.env.CI === '1'
const authSecret = process.env.BETTER_AUTH_SECRET ?? 'a'.repeat(64)
const settingsKey = process.env.WORKSPACE_SETTINGS_ENCRYPTION_KEY ?? 'b'.repeat(64)
const databaseUrl =
  process.env.DATABASE_URL ??
  'postgres://placeholder:placeholder@127.0.0.1:5432/placeholder'
const sharedEnv = [
  `DATABASE_URL=${databaseUrl}`,
  `BETTER_AUTH_SECRET=${authSecret}`,
  `WORKSPACE_SETTINGS_ENCRYPTION_KEY=${settingsKey}`,
  `BETTER_AUTH_URL=${apiOrigin}`,
  'MAIL_FROM=noreply@test.local',
  'MAIL_TRANSPORT_URL=smtp://test:test@127.0.0.1:2525',
  `PORT=${apiPort}`,
  'CSP_ENABLED=true',
].join(' ')

export default defineConfig({
  testDir: '.',
  testMatch: ['smoke.spec.ts', 'csp.spec.ts'],
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
    command: `pnpm --filter @boring/core exec tsup --no-dts && pnpm --filter @boring/core exec sh -c "cp src/front/theme.css dist/front/theme.css" && ${sharedEnv} pnpm build && NODE_ENV=production ${sharedEnv} pnpm start`,
    url: apiOrigin,
    timeout: 180_000,
    reuseExistingServer: false,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
