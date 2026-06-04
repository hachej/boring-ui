import { defineConfig } from "tsup"

export default defineConfig({
  entry: ["src/index.ts", "src/bin.ts"],
  format: ["esm"],
  target: "node20",
  dts: true,
  sourcemap: false,
  clean: true,
  external: ["playwright"],
})
