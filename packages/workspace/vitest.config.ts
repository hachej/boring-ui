import { defineConfig } from "vitest/config"
import { resolve } from "node:path"

export default defineConfig({
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "react",
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
      "@hachej/boring-workspace/server": resolve(__dirname, "src/server/index.ts"),
      "@hachej/boring-workspace": resolve(__dirname, "src/index.ts"),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
})
