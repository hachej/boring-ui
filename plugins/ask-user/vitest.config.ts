import { defineConfig } from "vitest/config"
import { resolve } from "node:path"
import react from "@vitejs/plugin-react"

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@hachej/boring-workspace/server": resolve(__dirname, "../../packages/workspace/src/server/index.ts"),
      "@hachej/boring-workspace/events": resolve(__dirname, "../../packages/workspace/src/front/events/index.ts"),
      "@hachej/boring-workspace": resolve(__dirname, "../../packages/workspace/src/index.ts"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: [resolve(__dirname, "../_shared/vitest.setup.ts")],
    include: ["**/*.test.{ts,tsx}"],
  },
})
