import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "shared/index": "src/shared/index.ts",
    "server/index": "src/server/index.ts",
    "modes/index": "src/modes/index.ts",
  },
  format: ["esm"],
  dts: true,
  splitting: false,
  clean: true,
  outDir: "dist",
  target: "es2022",
});
