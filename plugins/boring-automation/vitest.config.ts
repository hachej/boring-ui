import { defineConfig } from "vitest/config"
import { resolve } from "node:path"
import react from "@vitejs/plugin-react"
import { sandboxSourceAlias } from "../../scripts/vite-sandbox-alias.ts"

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: "@hachej/boring-agent/server", replacement: resolve(import.meta.dirname, "../../packages/agent/src/server/index.ts") },
      { find: "@hachej/boring-agent/shared", replacement: resolve(import.meta.dirname, "../../packages/agent/src/shared/index.ts") },
      { find: "@hachej/boring-agent/core", replacement: resolve(import.meta.dirname, "../../packages/agent/src/core/index.ts") },
      { find: "@hachej/boring-bash/agent", replacement: resolve(import.meta.dirname, "../../packages/boring-bash/src/agent/index.ts") },
      { find: "@hachej/boring-bash/server", replacement: resolve(import.meta.dirname, "../../packages/boring-bash/src/server/index.ts") },
      { find: "@hachej/boring-ui-kit", replacement: resolve(import.meta.dirname, "../../packages/ui/src/index.ts") },
      { find: "@hachej/boring-workspace/plugin", replacement: resolve(import.meta.dirname, "../../packages/workspace/src/plugin.ts") },
      { find: "@hachej/boring-workspace/server", replacement: resolve(import.meta.dirname, "../../packages/workspace/src/server/index.ts") },
      { find: "@hachej/boring-workspace/app/server", replacement: resolve(import.meta.dirname, "../../packages/workspace/src/app/server/index.ts") },
      { find: "@hachej/boring-workspace", replacement: resolve(import.meta.dirname, "../../packages/workspace/src/index.ts") },
      sandboxSourceAlias,
    ],
  },
  test: {
    environment: "node",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
})
