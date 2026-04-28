import { defineConfig } from "@playwright/test"

const PORT = Number(process.env.E2E_PORT ?? 5200)
const API_PORT = Number(process.env.E2E_API_PORT ?? 5210)
const HOST = process.env.E2E_HOST ?? "127.0.0.1"

const externalServer =
  process.env.E2E_EXTERNAL_SERVER === "1" ||
  process.env.CI === "true"

export default defineConfig({
  testDir: ".",
  // Order matters for the catalog/chart specs (they share localStorage seeds
  // implicitly via Vite's HMR cache). Keep serial; the suite is small.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 60_000,
  expect: { timeout: 8_000 },
  use: {
    baseURL: `http://${HOST}:${PORT}`,
    headless: true,
    viewport: { width: 1500, height: 950 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  // The dev server is heavy (Fastify + Vite + ClickHouse warm-up). When
  // E2E_EXTERNAL_SERVER is set, we assume the user already has it running
  // (faster local iteration). Otherwise we boot it ourselves and wait for
  // the api to come up.
  webServer: externalServer
    ? undefined
    : {
        command: "pnpm dev",
        url: `http://${HOST}:${PORT}`,
        reuseExistingServer: true,
        timeout: 60_000,
        stdout: "ignore",
        stderr: "pipe",
        env: {
          API_PORT: String(API_PORT),
          FRONTEND_PORT: String(PORT),
        },
      },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
})
