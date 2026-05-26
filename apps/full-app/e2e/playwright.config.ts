import { defineConfig, devices } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const apiPort = Number(process.env.FULL_APP_E2E_PORT ?? 3900)
const apiOrigin = `http://127.0.0.1:${apiPort}`
const baseURL = process.env.FULL_APP_E2E_BASE_URL ?? apiOrigin
const isCI = process.env.CI === 'true' || process.env.CI === '1'
const authSecret = process.env.BETTER_AUTH_SECRET ?? 'a'.repeat(64)
const settingsKey = process.env.WORKSPACE_SETTINGS_ENCRYPTION_KEY ?? 'b'.repeat(64)
const providedDatabaseUrl = process.env.FULL_APP_E2E_DATABASE_URL ?? process.env.DATABASE_URL

if (isCI && !providedDatabaseUrl) {
  throw new Error('FULL_APP_E2E_DATABASE_URL or DATABASE_URL is required for full-app Playwright runs in CI')
}

const databaseUrl =
  providedDatabaseUrl ??
  // Requires the standard local boring-ui-v2 test Postgres used elsewhere on this VM.
  'postgres://ubuntu:test@127.0.0.1/boring_ui_test'
const googleClientId = process.env.FULL_APP_E2E_GOOGLE_CLIENT_ID ?? 'test-google-client-id'
const googleClientSecret = process.env.FULL_APP_E2E_GOOGLE_CLIENT_SECRET ?? 'test-google-client-secret'
const mailTransportUrl = process.env.FULL_APP_E2E_MAIL_TRANSPORT_URL ?? 'smtp://test:test@127.0.0.1:2525'
const webServerScript = fileURLToPath(new URL('./google-auth-webserver.sh', import.meta.url))
const webServerEnv = Object.fromEntries(
  Object.entries({
    ...process.env,
    DATABASE_URL: databaseUrl,
    BETTER_AUTH_SECRET: authSecret,
    WORKSPACE_SETTINGS_ENCRYPTION_KEY: settingsKey,
    BETTER_AUTH_URL: apiOrigin,
    GOOGLE_CLIENT_ID: googleClientId,
    GOOGLE_CLIENT_SECRET: googleClientSecret,
    MAIL_FROM: 'noreply@test.local',
    MAIL_TRANSPORT_URL: mailTransportUrl,
    PORT: String(apiPort),
    CSP_ENABLED: 'true',
  }).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
)

export default defineConfig({
  testDir: '.',
  testMatch: ['smoke.spec.ts', 'csp.spec.ts', 'workspace-lifecycle.spec.ts', 'google-signup.spec.ts'],
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
    command: webServerScript,
    env: webServerEnv,
    url: apiOrigin,
    timeout: 360_000,
    reuseExistingServer: false,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
