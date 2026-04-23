import { defineConfig, devices } from "@playwright/test"
import path from "node:path"

const CI = process.env.CI === "true" || process.env.CI === "1"
const playgroundRoot = path.resolve(__dirname, "../../apps/workspace-playground")

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI ? [["line"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:5200",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "pnpm dev",
    cwd: playgroundRoot,
    port: 5200,
    reuseExistingServer: !CI,
    timeout: 30_000,
  },
})
