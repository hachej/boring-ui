import { defineConfig } from "tsup";

const EXTERNALS = ["react", "react-dom"];
const DEV_BUNDLE_EXTERNALS = ["@vitejs/plugin-react", "@babel/core"];

export default defineConfig([
  {
    entry: {
      "shared/index": "src/shared/index.ts",
      "server/index": "src/server/index.ts",
      "front/index": "src/front/index.ts",
      "eval/index": "src/eval/index.ts",
    },
    format: ["esm"],
    dts: true,
    splitting: true,
    clean: true,
    outDir: "dist",
    target: "es2022",
    external: [...EXTERNALS, ...DEV_BUNDLE_EXTERNALS],
  },
  {
    entry: { "bin/boring-agent": "src/bin/boring-agent.ts" },
    format: ["esm"],
    banner: { js: "#!/usr/bin/env node" },
    outDir: "dist",
    target: "es2022",
    platform: "node",
    external: DEV_BUNDLE_EXTERNALS,
  },
]);
