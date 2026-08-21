import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";
import { sandboxSourceAlias } from "../../scripts/vite-sandbox-alias.ts";

export default defineConfig({
  resolve: {
    alias: [
      { find: "@", replacement: fileURLToPath(new URL("./src", import.meta.url)) },
      { find: "@hachej/boring-bash/agent", replacement: fileURLToPath(new URL("../boring-bash/src/agent/index.ts", import.meta.url)) },
      { find: "@hachej/boring-bash/server", replacement: fileURLToPath(new URL("../boring-bash/src/server/index.ts", import.meta.url)) },
      { find: "@hachej/boring-agent/core", replacement: fileURLToPath(new URL("./src/core/index.ts", import.meta.url)) },
      { find: "@hachej/boring-agent/front", replacement: fileURLToPath(new URL("./src/front/index.ts", import.meta.url)) },
      { find: "@hachej/boring-agent/server", replacement: fileURLToPath(new URL("./src/server/index.ts", import.meta.url)) },
      { find: "@hachej/boring-agent/shared", replacement: fileURLToPath(new URL("./src/shared/index.ts", import.meta.url)) },
      { find: "@agent-test-host", replacement: fileURLToPath(new URL("./test-host/sandbox.ts", import.meta.url)) },
      sandboxSourceAlias,
    ],
  },
  test: {
    globals: true,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "src/**/*.test-d.ts"],
    typecheck: {
      enabled: true,
      include: ["src/**/*.test-d.ts"],
    },
    environment: "node",
  },
});
