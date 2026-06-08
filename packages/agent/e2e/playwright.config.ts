import { defineConfig, devices } from '@playwright/test'

const CI = process.env.CI === 'true' || process.env.CI === '1'

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  // Bombadil specs import their runtime from the bombadil CLI (a types-only
  // package at author time) and run via scripts/run-bombadil-chat.mjs, not the
  // plain Playwright runner. Keep them out of `pnpm e2e`.
  testIgnore: 'bombadil/**',
  fullyParallel: false,
  workers: CI ? 1 : undefined,
  globalTimeout: CI ? 300_000 : undefined,
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
