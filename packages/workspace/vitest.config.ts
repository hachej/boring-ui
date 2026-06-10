import { defineConfig } from "vitest/config"
import { resolve } from "node:path"

const PACKAGES = resolve(__dirname, "..")

export default defineConfig({
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "react",
  },
  resolve: {
    alias: {
      "@hachej/boring-ui-plugin-cli/plugin-sources": resolve(PACKAGES, "plugin-cli/src/server/pluginSources.ts"),
      "@hachej/boring-agent/server": resolve(PACKAGES, "agent/src/server/index.ts"),
      "@hachej/boring-agent/shared": resolve(PACKAGES, "agent/src/shared/index.ts"),
      "@boring/agent/server": resolve(PACKAGES, "agent/src/server/index.ts"),
      "@": resolve(__dirname, "src"),
      "@hachej/boring-workspace/runtime-server": resolve(__dirname, "src/server/runtimeBackend/defineRuntimeServerPlugin.ts"),
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
