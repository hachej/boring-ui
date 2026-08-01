import { defineConfig } from "vitest/config"
import { resolve } from "node:path"

const PACKAGES = resolve(import.meta.dirname, "..")

export default defineConfig({
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "react",
  },
  resolve: {
    alias: {
      "@hachej/boring-bash/agent": resolve(PACKAGES, "boring-bash/src/agent/index.ts"),
      "@hachej/boring-bash/server": resolve(PACKAGES, "boring-bash/src/server/index.ts"),
      "@hachej/boring-ui-plugin-cli/plugin-sources": resolve(PACKAGES, "plugin-cli/src/server/pluginSources.ts"),
      "@hachej/boring-agent/server/agent-host/testing/compositionRouteProof": resolve(PACKAGES, "agent/src/server/agent-host/testing/compositionRouteProof.ts"),
      "@hachej/boring-agent/server": resolve(PACKAGES, "agent/src/server/index.ts"),
      "@hachej/boring-agent/shared": resolve(PACKAGES, "agent/src/shared/index.ts"),
      "@boring/agent/server": resolve(PACKAGES, "agent/src/server/index.ts"),
      "@hachej/boring-sandbox/shared": resolve(PACKAGES, "boring-sandbox/src/shared/index.ts"),
      "@hachej/boring-sandbox/providers/direct": resolve(PACKAGES, "boring-sandbox/src/providers/direct/index.ts"),
      "@hachej/boring-sandbox/providers/bwrap": resolve(PACKAGES, "boring-sandbox/src/providers/bwrap/index.ts"),
      "@hachej/boring-sandbox/providers/node-workspace": resolve(PACKAGES, "boring-sandbox/src/providers/node-workspace/index.ts"),
      "@hachej/boring-sandbox/providers/vercel-sandbox": resolve(PACKAGES, "boring-sandbox/src/providers/vercel-sandbox/index.ts"),
      "@": resolve(import.meta.dirname, "src"),
      "@hachej/boring-workspace/runtime-server": resolve(import.meta.dirname, "src/server/runtimeBackend/defineRuntimeServerPlugin.ts"),
      "@hachej/boring-workspace/server": resolve(import.meta.dirname, "src/server/index.ts"),
      "@hachej/boring-workspace": resolve(import.meta.dirname, "src/index.ts"),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
})
