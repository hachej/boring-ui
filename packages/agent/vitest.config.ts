import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@hachej/boring-agent/core": fileURLToPath(new URL("./src/core/index.ts", import.meta.url)),
      "@hachej/boring-agent/front": fileURLToPath(new URL("./src/front/index.ts", import.meta.url)),
      "@hachej/boring-agent/server": fileURLToPath(new URL("./src/server/index.ts", import.meta.url)),
      "@hachej/boring-agent/shared": fileURLToPath(new URL("./src/shared/index.ts", import.meta.url)),
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
