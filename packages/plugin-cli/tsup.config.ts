import { defineConfig } from "tsup"

export default defineConfig({
  entry: { index: "src/index.ts", bin: "src/bin.ts", "plugin-sources": "src/server/pluginSources.ts" },
  format: ["esm"],
  target: "node20",
  dts: true,
  sourcemap: false,
  clean: true,
})
