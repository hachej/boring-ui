import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "shared/index": "src/shared/index.ts",
    "providers/index": "src/providers/index.ts",
    "providers/direct/index": "src/providers/direct/index.ts",
    "providers/bwrap/index": "src/providers/bwrap/index.ts",
    "providers/node-workspace/index": "src/providers/node-workspace/index.ts",
    "providers/runsc/index": "src/providers/runsc/index.ts",
  },
  format: ["esm"],
  dts: true,
  splitting: true,
  clean: true,
  outDir: "dist",
  target: "es2022",
});
