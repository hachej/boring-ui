import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: {
      shared: "src/shared/index.ts",
      server: "src/server/index.ts",
      front: "src/front/index.ts",
    },
    format: ["esm"],
    dts: true,
    splitting: true,
    clean: true,
    target: "es2022",
    external: ["react", "react-dom"],
  },
  {
    entry: { "bin/boring-agent": "src/bin/boring-agent.ts" },
    format: ["esm"],
    banner: { js: "#!/usr/bin/env node" },
    target: "es2022",
    platform: "node",
  },
]);
