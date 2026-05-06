import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@hachej/boring-ui-kit": fileURLToPath(new URL("../ui/src/index.ts", import.meta.url)),
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
