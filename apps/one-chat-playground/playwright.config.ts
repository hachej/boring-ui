import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig } from '@playwright/test'

const APP_DIR = dirname(fileURLToPath(import.meta.url))
const FRONT_PORT = Number(process.env.ONE_CHAT_PORT) || 5330
const SAMPLE_APP_PORT = Number(process.env.SAMPLE_APP_PORT) || 5331
const TEST_APPS_ROOT = process.env.ONE_CHAT_APPS_ROOT ?? `/var/tmp/one-chat-playwright-${process.pid}`

export default defineConfig({
  testDir: resolve(APP_DIR, 'e2e'),
  timeout: 180_000,
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: `http://127.0.0.1:${FRONT_PORT}`,
    headless: true,
    viewport: { width: 1280, height: 800 },
    colorScheme: 'light',
  },
  webServer: {
    command: 'pnpm run dev:app',
    cwd: APP_DIR,
    env: {
      ONE_CHAT_PORT: String(FRONT_PORT),
      SAMPLE_APP_PORT: String(SAMPLE_APP_PORT),
      ONE_CHAT_APPS_ROOT: TEST_APPS_ROOT,
      ONE_CHAT_APP_PORT_RANGE: `${SAMPLE_APP_PORT}-${SAMPLE_APP_PORT + 8}`,
      // The layout smoke never sends a turn, but model discovery still runs.
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? 'smoke-not-a-real-key',
    },
    port: FRONT_PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})
