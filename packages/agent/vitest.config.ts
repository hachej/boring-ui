import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@hachej/boring-bash/agent": fileURLToPath(new URL("../boring-bash/src/agent/index.ts", import.meta.url)),
      "@hachej/boring-bash/server": fileURLToPath(new URL("../boring-bash/src/server/index.ts", import.meta.url)),
      "@hachej/boring-agent/core": fileURLToPath(new URL("./src/core/index.ts", import.meta.url)),
      "@hachej/boring-agent/front": fileURLToPath(new URL("./src/front/index.ts", import.meta.url)),
      "@hachej/boring-agent/server": fileURLToPath(new URL("./src/server/index.ts", import.meta.url)),
      "@hachej/boring-agent/shared": fileURLToPath(new URL("./src/shared/index.ts", import.meta.url)),
      "@agent-test-host": fileURLToPath(new URL("./test-host/sandbox.ts", import.meta.url)),
      "@hachej/boring-sandbox/shared": fileURLToPath(new URL("../boring-sandbox/src/shared/index.ts", import.meta.url)),
      "@hachej/boring-sandbox/providers/direct": fileURLToPath(new URL("../boring-sandbox/src/providers/direct/index.ts", import.meta.url)),
      "@hachej/boring-sandbox/providers/bwrap": fileURLToPath(new URL("../boring-sandbox/src/providers/bwrap/index.ts", import.meta.url)),
      "@hachej/boring-sandbox/providers/node-workspace": fileURLToPath(new URL("../boring-sandbox/src/providers/node-workspace/index.ts", import.meta.url)),
      "@hachej/boring-sandbox/providers/vercel-sandbox": fileURLToPath(new URL("../boring-sandbox/src/providers/vercel-sandbox/index.ts", import.meta.url)),
    },
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
