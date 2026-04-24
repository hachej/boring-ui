import { defineConfig } from '@playwright/test'

/**
 * Playwright config for the with-shadcn example app.
 *
 * Expects the dev server to already be running at BASE_URL (defaults to
 * the local dev port). Keep the config intentionally small — this is a
 * single-example scope, not the whole monorepo test harness.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: process.env.BASE_URL ?? 'http://127.0.0.1:5183',
    headless: true,
    colorScheme: 'dark',
    viewport: { width: 1280, height: 800 },
    launchOptions: { args: ['--no-sandbox'] },
    // Data URL attachments persisted to localStorage can be large; give
    // the trace + action timeouts some headroom.
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },
  reporter: [['list']],
})
