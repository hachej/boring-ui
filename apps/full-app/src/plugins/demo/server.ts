import { join } from "node:path"
import type { CoreWorkspaceAgentServerPlugin } from "@hachej/boring-core/app/server"
import { definePluginAsset, resolvePluginAssetPath } from "@hachej/boring-workspace/server"

// The plugin owns its SDK: the Python package lives at ./sdk in source and is
// declared here so production/serverless builds can copy it into place.
const demoSdkAsset = definePluginAsset(import.meta.url, "sdk", "./sdk/")
const demoSdkRoot = resolvePluginAssetPath(import.meta.url, demoSdkAsset.target ?? demoSdkAsset.name)

/**
 * Backend half of the demo plugin: provisions the dummy `democli` Python SDK into
 * each workspace and tells the agent the demo CLI + panel exist. Generic Python/uv
 * guidance lives in the agent runtime base prompt, not here.
 */
export const demoServerPlugin: CoreWorkspaceAgentServerPlugin = {
  id: "demo",
  systemPrompt: [
    "## Demo plugin",
    "A demo CLI `democli` is preinstalled in this workspace — try `democli`, `democli info`, or `democli echo hello`.",
    'A "Demo" panel is available (command palette → "Open Demo panel").',
  ].join("\n"),
  assets: [demoSdkAsset],
  provisioning: {
    python: [
      {
        id: "boring-demo-sdk",
        packageName: "boring-demo-sdk",
        projectFile: join(demoSdkRoot, "pyproject.toml"),
        expectedBins: ["democli"],
      },
    ],
  },
}
