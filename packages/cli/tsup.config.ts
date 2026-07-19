import { defineConfig } from "tsup"

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/server/cli.ts",
    "src/server/agentCommands.ts",
    "src/server/agentCommandDeps.ts",
    "src/server/agentCommandSafe.ts",
    "src/server/agentCommandTypes.ts",
    "src/server/agentDevCommand.ts",
    "src/server/agentValidateCommand.ts",
    "src/server/staticAssets.ts",
    "src/server/localWorkspaces.ts",
    "src/server/modeApps.ts",
    "src/server/pluginDiscovery.ts",
    "src/server/pluginFrontRuntime.ts",
    "src/server/workspacePluginRoutes.ts",
  ],
  format: ["esm"],
  target: "node20",
  bundle: false,
  dts: true,
  clean: true,
  banner: { js: "#!/usr/bin/env node" },
})
