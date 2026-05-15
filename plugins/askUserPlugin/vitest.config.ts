import { defineConfig } from "vitest/config"
import { resolve } from "node:path"

export default defineConfig({
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "react",
  },
  resolve: {
    alias: {
      "@hachej/boring-workspace/server": resolve(__dirname, "../../packages/workspace/src/server/index.ts"),
      "@hachej/boring-workspace": resolve(__dirname, "../../packages/workspace/src/index.ts"),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: [resolve(__dirname, "../../packages/workspace/vitest.setup.ts")],
    include: ["**/*.test.{ts,tsx}"],
  },
})
