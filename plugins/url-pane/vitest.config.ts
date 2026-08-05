import { resolve } from "node:path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@hachej/boring-ui-kit": resolve(import.meta.dirname, "../../packages/ui/src/index.ts"),
      "@hachej/boring-workspace/plugin": resolve(import.meta.dirname, "../../packages/workspace/src/plugin.ts"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
  },
})
