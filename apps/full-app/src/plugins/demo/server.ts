import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { CoreWorkspaceAgentServerPlugin } from "@hachej/boring-core/app/server"

// demo-sdk lives at the app root (apps/full-app/demo-sdk). This file runs from
// src/plugins/demo (dev/tsx) or dist/plugins/demo (build) — both three levels
// under the app root.
const here = dirname(fileURLToPath(import.meta.url))
const demoSdkRoot = join(here, "..", "..", "..", "demo-sdk")

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
