import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "shared/index": "src/shared/index.ts",
    "runtime-modes/index": "src/runtime-modes/index.ts",
    "providers/index": "src/providers/index.ts",
    "providers/registry": "src/providers/registry/index.ts",
    "providers/direct/index": "src/providers/direct/index.ts",
    "providers/bwrap/index": "src/providers/bwrap/index.ts",
    "providers/node-workspace/index": "src/providers/node-workspace/index.ts",
    "providers/blaxel/index": "src/providers/blaxel/index.ts",
    "providers/vercel-sandbox/index": "src/providers/vercel-sandbox/index.ts",
    "providers/runsc/index": "src/providers/runsc/index.ts",
    "providers/remote-worker/index": "src/providers/remote-worker/index.ts",
    "providers/remote-worker/legacy": "src/providers/remote-worker/legacy/index.ts",
  },
  format: ["esm"],
  dts: true,
  // Preserve descriptor-level dynamic imports in the published package so a
  // registry consumer does not eagerly load every provider SDK.
  splitting: true,
  clean: true,
  outDir: "dist",
  target: "es2022",
});
