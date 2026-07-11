import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "shared/index": "src/shared/index.ts",
    "runtime-mode": "src/runtimeModeSelection.ts",
    "providers/index": "src/providers/index.ts",
    "providers/direct/index": "src/providers/direct/index.ts",
    "providers/bwrap/index": "src/providers/bwrap/index.ts",
    "providers/node-workspace/index": "src/providers/node-workspace/index.ts",
    "providers/remote-worker/index": "src/providers/remote-worker/index.ts",
    "providers/runsc/index": "src/providers/runsc/index.ts",
    "providers/vercel-sandbox/index": "src/providers/vercel-sandbox/index.ts",
  },
  format: ["esm"],
  dts: true,
  splitting: true,
  clean: true,
  outDir: "dist",
  target: "es2022",
});
