import { defineConfig } from "vitest/config"
import { resolve } from "node:path"
import react from "@vitejs/plugin-react"

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@hachej/boring-workspace/shared": resolve(__dirname, "../../packages/workspace/src/shared/index.ts"),
      "@hachej/boring-workspace/app/server": resolve(__dirname, "../../packages/workspace/src/app/server/index.ts"),
      "@hachej/boring-workspace/server": resolve(__dirname, "../../packages/workspace/src/server/index.ts"),
      "@hachej/boring-workspace/plugin": resolve(__dirname, "../../packages/workspace/src/plugin.ts"),
      "@hachej/boring-workspace": resolve(__dirname, "../../packages/workspace/src/index.ts"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
})
