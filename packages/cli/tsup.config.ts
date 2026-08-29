import { defineConfig } from "tsup"

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/server/cli.ts",
    "src/server/folderModeTaskProviders.ts",
    "src/server/localWorkspaces.ts",
    "src/server/modeApps.ts",
    "src/server/pluginDiscovery.ts",
    "src/server/pluginFrontRuntime.ts",
    // bundle:false emits one file per entry, so the runtime host's own
    // modules have to be listed too or dist/ ships a broken import graph.
    "src/server/pluginFrontRuntime/*.ts",
    "src/server/workspacePluginRoutes.ts",
  ],
  format: ["esm"],
  target: "node20",
  bundle: false,
  clean: true,
  banner: { js: "#!/usr/bin/env node" },
})
