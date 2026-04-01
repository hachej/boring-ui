import { defineConfig, devices } from '@playwright/test'

// Smoke test config — no webServer, points at an already-running dev server.
// Usage: PW_CHAT_SMOKE_URL=http://100.68.199.114:5173 npx playwright test --config=playwright.smoke.config.js

const baseURL = process.env.PW_CHAT_SMOKE_URL || 'http://127.0.0.1:5173'

export default defineConfig({
  testDir: './src/front/__tests__/e2e',
  testMatch: '**/chat-{centered-smoke,agent-interaction}.spec.ts',
  timeout: 30000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
})
