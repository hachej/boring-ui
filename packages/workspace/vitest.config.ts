import { defineConfig } from "vitest/config"
import { resolve } from "node:path"
import { sandboxSourceAlias } from '../../scripts/vite-sandbox-alias.ts'

const PACKAGES = resolve(import.meta.dirname, "..")

export default defineConfig({
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "react",
  },
  resolve: {
    alias: [
      { find: "@hachej/boring-bash/agent", replacement: resolve(PACKAGES, "boring-bash/src/agent/index.ts") },
      { find: "@hachej/boring-bash/server", replacement: resolve(PACKAGES, "boring-bash/src/server/index.ts") },
      { find: "@hachej/boring-ui-plugin-cli/plugin-sources", replacement: resolve(PACKAGES, "plugin-cli/src/server/pluginSources.ts") },
      { find: "@hachej/boring-agent/server/agent-host/testing/compositionRouteProof", replacement: resolve(PACKAGES, "agent/src/server/agent-host/testing/compositionRouteProof.ts") },
      { find: "@hachej/boring-agent/server", replacement: resolve(PACKAGES, "agent/src/server/index.ts") },
      { find: "@hachej/boring-agent/shared", replacement: resolve(PACKAGES, "agent/src/shared/index.ts") },
      { find: "@hachej/boring-ui-kit", replacement: resolve(PACKAGES, "ui/src/index.ts") },
      { find: "@boring/agent/server", replacement: resolve(PACKAGES, "agent/src/server/index.ts") },
      sandboxSourceAlias,
      { find: "@", replacement: resolve(import.meta.dirname, "src") },
      { find: "@hachej/boring-workspace/runtime-server", replacement: resolve(import.meta.dirname, "src/server/runtimeBackend/defineRuntimeServerPlugin.ts") },
      { find: "@hachej/boring-workspace/server", replacement: resolve(import.meta.dirname, "src/server/index.ts") },
      { find: "@hachej/boring-workspace", replacement: resolve(import.meta.dirname, "src/index.ts") },
    ],
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
})
