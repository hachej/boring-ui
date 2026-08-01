import { resolve } from "node:path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@hachej/boring-agent/front": resolve(__dirname, "../../packages/agent/src/front/index.ts"),
      "@hachej/boring-agent/server": resolve(__dirname, "../../packages/agent/src/server/index.ts"),
      "@hachej/boring-agent/shared": resolve(__dirname, "../../packages/agent/src/shared/index.ts"),
      "@hachej/boring-workspace/plugin": resolve(__dirname, "../../packages/workspace/src/plugin.ts"),
      "@hachej/boring-workspace/server": resolve(__dirname, "../../packages/workspace/src/server/index.ts"),
      "@hachej/boring-workspace": resolve(__dirname, "../../packages/workspace/src/index.ts"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
})
