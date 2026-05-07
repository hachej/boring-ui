import { defineConfig } from "vitest/config"
import { resolve } from "node:path"

const PACKAGES = resolve(__dirname, "..")

export default defineConfig({
  resolve: {
    alias: {
      "@boring/agent/server": resolve(PACKAGES, "agent/src/server/index.ts"),
      "@": resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
})
