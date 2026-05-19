import { defineConfig } from "tsup"

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/server/cli.ts",
    "src/server/localWorkspaces.ts",
    "src/server/scaffoldPlugin.ts",
  ],
  format: ["esm"],
  target: "node20",
  bundle: false,
  clean: true,
  banner: { js: "#!/usr/bin/env node" },
})
