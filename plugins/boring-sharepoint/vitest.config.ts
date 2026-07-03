import { defineConfig } from "vitest/config"
import { resolve } from "node:path"

export default defineConfig({
  resolve: {
    alias: {
      "@hachej/boring-workspace/plugin": resolve(__dirname, "../../packages/workspace/src/plugin.ts"),
      "@hachej/boring-workspace/server": resolve(__dirname, "../../packages/workspace/src/server/index.ts"),
      "@hachej/boring-workspace": resolve(__dirname, "../../packages/workspace/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts"],
  },
})
