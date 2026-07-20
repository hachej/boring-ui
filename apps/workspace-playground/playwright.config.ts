import { defineConfig } from "@playwright/test"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const APP_DIR = dirname(fileURLToPath(import.meta.url))
const E2E_WORKSPACE_ROOT = resolve(process.env.BORING_AGENT_WORKSPACE_ROOT || resolve(APP_DIR, "e2e/fixtures/workspace"))
const E2E_SESSION_ROOT = resolve(process.env.BORING_AGENT_SESSION_ROOT || resolve(APP_DIR, "e2e/fixtures/sessions"))
const VITE_PORT = 5380
const AGENT_API_PORT = 5390
const SERVER_HOME = resolve(process.env.HOME || resolve(APP_DIR, "e2e/fixtures/home"))
const SERVER_CONFIG = resolve(process.env.XDG_CONFIG_HOME || resolve(SERVER_HOME, ".config"))
const SERVER_CACHE = resolve(process.env.XDG_CACHE_HOME || resolve(SERVER_HOME, ".cache"))
const COREPACK_HOME = resolve(process.env.COREPACK_HOME || resolve(process.env.HOME || SERVER_HOME, ".cache/node/corepack"))
const shell = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`

export default defineConfig({
  testDir: "../..",
  testMatch: [
    "apps/workspace-playground/e2e/**/*.spec.ts",
    "plugins/ask-user/e2e/**/*.spec.ts",
  ],
  timeout: 30_000,
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
    baseURL: `http://127.0.0.1:${VITE_PORT}`,
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
    command: `cd ${shell(APP_DIR)} && env -i ${[
      `PATH=${shell(process.env.PATH || "")}`,
      `HOME=${shell(SERVER_HOME)}`,
      `XDG_CONFIG_HOME=${shell(SERVER_CONFIG)}`,
      `XDG_CACHE_HOME=${shell(SERVER_CACHE)}`,
      `COREPACK_HOME=${shell(COREPACK_HOME)}`,
      "COREPACK_ENABLE_DOWNLOAD_PROMPT=0",
      `PORT=${VITE_PORT}`,
      `AGENT_API_PORT=${AGENT_API_PORT}`,
      `BORING_AGENT_WORKSPACE_ROOT=${shell(E2E_WORKSPACE_ROOT)}`,
      `BORING_AGENT_SESSION_ROOT=${shell(E2E_SESSION_ROOT)}`,
      "pnpm exec vite",
    ].join(" ")}`,
    port: VITE_PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
  },
})
