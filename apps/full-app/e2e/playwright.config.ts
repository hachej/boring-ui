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
    // The harness boots the production bundle (NODE_ENV=production) but runs
    // the agent in the local auto-detected direct mode on purpose — there is
    // no vercel-sandbox/blaxel backend in a local or CI e2e run. Opt out of
    // the production agent-mode gate (src/server/productionSafety.ts)
    // explicitly; without this the webServer refuses to start at all.
    BORING_ALLOW_UNSAFE_AGENT_MODE: '1',
  }).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
)

export default defineConfig({
  testDir: '.',
  testMatch: ['smoke.spec.ts', 'csp.spec.ts', 'workspace-lifecycle.spec.ts', 'google-signup.spec.ts', 'runtime-readiness.spec.ts', 'mobile-auth-card.spec.ts'],
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
    // The webServer script runs the whole dependency build chain (nine
    // packages, declaration builds included — core's DTS pass alone is ~3
    // minutes), migrates, and builds the app before listening. A cold run
    // measured well past 15 minutes on a normal dev machine, so budget 30.
    // CI does not run this suite, so this only bounds local runs.
    timeout: 1_800_000,
    reuseExistingServer: false,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
