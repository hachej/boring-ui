import { defineConfig } from "vitest/config"
import { resolve } from "node:path"
import react from "@vitejs/plugin-react"

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@hachej/boring-workspace/shared": resolve(__dirname, "../../packages/workspace/src/shared/index.ts"),
      "@hachej/boring-workspace/server": resolve(__dirname, "../../packages/workspace/src/server/index.ts"),
      "@hachej/boring-workspace/events": resolve(__dirname, "../../packages/workspace/src/front/events/index.ts"),
      "@hachej/boring-workspace/plugin": resolve(__dirname, "../../packages/workspace/src/plugin.ts"),
      "@hachej/boring-workspace": resolve(__dirname, "../../packages/workspace/src/index.ts"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
    include: ["**/*.test.{ts,tsx}"],
    // The ask-user server tests exercise one blocking in-process coordinator
    // and pending-question store semantics. Running files in parallel makes
    // timing assertions depend on CPU load in CI; keep this package serial.
    fileParallelism: false,
    testTimeout: 30_000,
  },
})
