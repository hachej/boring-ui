import { defineConfig } from "@playwright/test"
import { resolve } from "node:path"
import { getUiReviewSpec } from "./src/registry"

const spec = getUiReviewSpec(process.env.UI_REVIEW_SPEC ?? "")
const repoRoot = resolve(import.meta.dirname, "../..")
const port = Number(process.env.UI_REVIEW_VITE_PORT) || spec.target.defaultPort
const allowed = ["PATH", "HOME", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "COREPACK_HOME", ...spec.target.serverEnvironmentKeys]
  .flatMap((name) => process.env[name] ? [`${name}=${shell(process.env[name]!)}`] : [])
const [server, ...args] = spec.target.serverCommand
const command = `env -i ${allowed.join(" ")} COREPACK_ENABLE_DOWNLOAD_PROMPT=0 ${[server, ...args].map(shell).join(" ")}`

export default defineConfig({
  testDir: "e2e",
  testMatch: ["review.spec.ts"],
  timeout: 120_000,
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  updateSnapshots: process.env.UI_REVIEW_UPDATE_SNAPSHOTS === "1" ? "all" : "missing",
  snapshotPathTemplate: "{testDir}/../src/review-specs/{arg}-{projectName}-{platform}{ext}",
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  use: { baseURL: `http://127.0.0.1:${port}`, headless: true },
  webServer: {
    command,
    cwd: resolve(repoRoot, spec.target.root),
    port,
    reuseExistingServer: false,
    timeout: 300_000,
  },
})

function shell(value: string): string { return `'${value.replaceAll("'", `'\\''`)}'` }
