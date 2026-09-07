import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
export default defineConfig({
  resolve: {
    alias: {
      "@hachej/boring-workspace/server": resolve(
        import.meta.dirname,
        "../../packages/workspace/src/server/plugins/defineServerPlugin.ts",
      ),
      "@hachej/boring-workspace/plugin": resolve(
        import.meta.dirname,
        "../../packages/workspace/src/plugin.ts",
      ),
      "@hachej/boring-workspace": resolve(
        import.meta.dirname,
        "../../packages/workspace/src/index.ts",
      ),
    },
  },
  test: { environment: "node" },
});
