import { defineConfig } from '@playwright/test'

const port = Number(process.env.PROOF_PORT ?? '5614')
const outputDir = process.env.PROOF_OUTPUT_DIR ?? 'docs/issues/1544/browser-proof/test-results'

export default defineConfig({
  testDir: '.',
  testMatch: 'chat-event-ownership.spec.ts',
  // Cold source transforms in the isolated exact-SHA sandbox can exceed 30s;
  // the stream journey itself remains bounded to six deterministic seconds.
  timeout: 90_000,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: `${outputDir}/results.json` }]],
  outputDir,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'on',
    screenshot: 'on',
    video: 'on',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: {
    command: `pnpm exec vite --config vite.config.ts --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
