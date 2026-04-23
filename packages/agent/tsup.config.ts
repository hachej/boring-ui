import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: {
      "shared/index": "src/shared/index.ts",
      "server/index": "src/server/index.ts",
      "front/index": "src/front/index.ts",
    },
    format: ["esm"],
    dts: true,
    splitting: true,
    clean: true,
    outDir: "dist",
    target: "es2022",
    external: ["react", "react-dom"],
  },
  {
    entry: { "bin/boring-agent": "src/bin/boring-agent.ts" },
    format: ["esm"],
    banner: { js: "#!/usr/bin/env node" },
    outDir: "dist",
    target: "es2022",
    platform: "node",
  },
]);
