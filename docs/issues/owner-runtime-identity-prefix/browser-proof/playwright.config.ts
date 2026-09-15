import { defineConfig } from "@playwright/test"
import { resolve } from "node:path"

const repoRoot = resolve(import.meta.dirname, "../../../..")

export default defineConfig({
  testDir: ".",
  testMatch: "owner-plugin-pane.spec.ts",
  timeout: 45_000,
  workers: 1,
  use: { baseURL: "http://127.0.0.1:5460", headless: true, trace: "on", video: "on" },
  outputDir: ".artifacts/test-results",
  reporter: [["json", { outputFile: ".artifacts/playwright-results.json" }], ["line"]],
  webServer: [
    { command: "pnpm exec tsx docs/issues/owner-runtime-identity-prefix/browser-proof/server.ts", cwd: repoRoot, port: 5470, reuseExistingServer: false, timeout: 120_000 },
    { command: "pnpm exec vite --config docs/issues/owner-runtime-identity-prefix/browser-proof/vite.config.ts", cwd: repoRoot, port: 5460, reuseExistingServer: false, timeout: 120_000 },
  ],
})
