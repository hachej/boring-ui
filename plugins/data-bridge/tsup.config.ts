import { defineConfig } from "tsup"

export default defineConfig({
  entry: {
    "front/index": "src/front/index.ts",
    "server/index": "src/server/index.ts",
    "shared/index": "src/shared/index.ts",
  },
  format: ["esm"],
  target: "es2022",
  dts: true,
  sourcemap: false,
  clean: true,
  external: ["@hachej/boring-workspace"],
})
