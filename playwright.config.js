import { defineConfig, devices } from '@playwright/test'

const e2eFrontendPort = Number(process.env.PW_E2E_PORT || 4173)
const e2eApiPort = Number(process.env.PW_E2E_API_PORT || 8000)
const frontendUrl = `http://127.0.0.1:${e2eFrontendPort}`
const apiHealthUrl = `http://127.0.0.1:${e2eApiPort}/health`
const runCrossBrowser = process.env.PW_E2E_CROSS_BROWSER === '1'
const configuredWorkersRaw = process.env.PW_E2E_WORKERS
const configuredWorkers = configuredWorkersRaw ? Number(configuredWorkersRaw) : null
const workers =
  Number.isFinite(configuredWorkers) && configuredWorkers > 0
    ? configuredWorkers
    : 1
const reuseExistingServer = process.env.PW_E2E_REUSE_SERVER
  ? process.env.PW_E2E_REUSE_SERVER === '1'
  : !process.env.CI

const projects = [
  {
    name: 'chromium',
    use: { ...devices['Desktop Chrome'] },
  },
]

if (runCrossBrowser) {
  projects.push(
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
    {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 5'] },
    }
  )
}

/**
 * Playwright E2E Test Configuration
 *
 * To install Playwright:
 * npm install -D @playwright/test
 *
 * To run tests:
 * npm run test:e2e
 */

export default defineConfig({
  testDir: './src/front/__tests__/e2e',
  testMatch: '**/*.spec.ts',

  // Timeout for each test
  timeout: 30000,

  // Timeout for entire test run
  globalTimeout: 600000,

  // Run tests in parallel
  fullyParallel: true,

  // Fail on console errors
  forbidOnly: !!process.env.CI,

  // Retry failing tests
  retries: process.env.CI ? 2 : 0,

  // Number of workers
  // Default to a single worker. The dev + API servers are shared and we saw
  // flakiness/crashes with high parallelism under load.
  workers,

  // Reporter configurations
  reporter: [
    ['html', { open: 'never' }],
    ['json', { outputFile: 'test-results/results.json' }],
    ['junit', { outputFile: 'test-results/junit.xml' }],
  ],

  // Shared settings for all browsers
  use: {
    // Base URL for requests
    baseURL: frontendUrl,

    // Take screenshot on failure
    screenshot: 'only-on-failure',

    // Record traces for debugging
    trace: 'on-first-retry',

    // Video on failure
    video: 'retain-on-failure',
  },

  // Configure different browsers
  projects,

  // Web Server configuration for running tests against dev server
  webServer: [
    {
      command: `env -u NO_COLOR -u FORCE_COLOR VITE_API_URL=http://127.0.0.1:${e2eApiPort} npm run dev -- --host 127.0.0.1 --port ${e2eFrontendPort} --strictPort`,
      url: frontendUrl,
      reuseExistingServer,
      timeout: 120000,
    },
    {
      // Make webserver logs deterministic for transcript verification:
      // - suppress per-request access logs (client ephemeral ports + query params)
      // - suppress INFO startup logs (per-run PIDs)
      command: `env -u NO_COLOR -u FORCE_COLOR BORING_UI_PTY_CLAUDE_COMMAND=bash PYTHONPATH=src/back BORING_UI_WORKSPACE_ROOT=$PWD python3 -m uvicorn boring_ui.runtime:app --host 127.0.0.1 --port ${e2eApiPort} --log-level warning --no-access-log`,
      url: apiHealthUrl,
      reuseExistingServer,
      timeout: 120000,
    },
  ],
})
