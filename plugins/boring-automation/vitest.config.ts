import { defineConfig } from "vitest/config"
import { resolve } from "node:path"
import react from "@vitejs/plugin-react"

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@hachej/boring-agent/server": resolve(import.meta.dirname, "../../packages/agent/src/server/index.ts"),
      "@hachej/boring-agent/shared": resolve(import.meta.dirname, "../../packages/agent/src/shared/index.ts"),
      "@hachej/boring-agent/core": resolve(import.meta.dirname, "../../packages/agent/src/core/index.ts"),
      "@hachej/boring-bash/agent": resolve(import.meta.dirname, "../../packages/boring-bash/src/agent/index.ts"),
      "@hachej/boring-bash/server": resolve(import.meta.dirname, "../../packages/boring-bash/src/server/index.ts"),
      "@hachej/boring-ui-kit": resolve(import.meta.dirname, "../../packages/ui/src/index.ts"),
      "@hachej/boring-workspace/plugin": resolve(import.meta.dirname, "../../packages/workspace/src/plugin.ts"),
      "@hachej/boring-workspace/server": resolve(import.meta.dirname, "../../packages/workspace/src/server/index.ts"),
      "@hachej/boring-workspace/app/server": resolve(import.meta.dirname, "../../packages/workspace/src/app/server/index.ts"),
      "@hachej/boring-workspace": resolve(import.meta.dirname, "../../packages/workspace/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
})
