import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "../..",
  testMatch: [
    "apps/workspace-playground/e2e/**/*.spec.ts",
    "plugins/askUserPlugin/e2e/**/*.spec.ts",
  ],
  timeout: 30_000,
  retries: 0,
  // The playground tests share a single Vite dev server (one HMR socket,
  // one mockApi state, one localStorage origin). Running tests in
  // parallel makes them step on each other — resize handles get
  // measured mid-drag from another worker, the cmd palette open in one
  // worker fights ⌘K in another. Pin to one worker so the suite stays
  // deterministic.
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: "http://localhost:5380",
    headless: true,
  },
  webServer: {
    // Pin to a non-default port so playwright never reuses an unrelated
    // local dev server that happens to be on :5200 (e.g. boring-macro-v2,
    // which uses the same workspace front shell — tests against it would
    // appear to pass while actually targeting the wrong app, and
    // localStorage keys would diverge from the playground's defaults).
    // AGENT_API_PORT is shifted off its default (5210) too because
    // boring-macro-v2 also binds 5210. The vite proxy reads that env
    // var and forwards /api/v1/agent + /api/v1/ui to the right
    // backend.
    command: "PORT=5380 AGENT_API_PORT=5390 pnpm dev",
    port: 5380,
    reuseExistingServer: !process.env.CI,
    timeout: 150_000,
  },
})
