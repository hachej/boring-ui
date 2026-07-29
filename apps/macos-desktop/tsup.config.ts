import { defineConfig } from "tsup"

export default defineConfig({
  entry: ["src/main.ts", "src/smoke-main.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  bundle: true,
  external: ["electron", "@hachej/boring-ui-cli/server"],
  clean: true,
  sourcemap: true,
})
