// CANONICAL server/index.ts for advanced boring-ui server integration.
// This is boot-time/static composition only for .pi/extensions plugins:
// /reload does NOT hot-register these routes or agent tools. Prefer
// pi.extensions for hot-reloadable agent behavior.
// Copy this shape only when the host will compose/restart the plugin.

import { defineServerPlugin, type WorkspaceServerPlugin } from "@hachej/boring-workspace/server"

export default function (
  _options: unknown,
  ctx: { workspaceRoot: string; bridge: unknown },
): WorkspaceServerPlugin {
  return defineServerPlugin({
    id: "<kebab-name>", // contribution namespace; matching package name is recommended
    agentTools: [
      {
        name: "<snake_case_tool_name>",
        description: "<what the tool does>",
        parameters: { type: "object", properties: {} },
        async execute() {
          return { content: [{ type: "text", text: "..." }] }
        },
      },
    ],
    systemPrompt: "Use <snake_case_tool_name> when …",
  })
}

// Key rules — agents commonly get these wrong:
//   - Method is `execute` (NOT `handler`).
//   - Return shape MUST be `{ content: [{ type: "text", text: "..." }] }`
//     (NOT a bare string and NOT `{ result: ... }`).
//   - Import from `@hachej/boring-workspace/server`
//     (NOT `@hachej/boring-pi` and NOT `@boring-ui/*`).
//   - Default-export a FUNCTION that returns the plugin object —
//     do NOT `export const eval_cross_ping = { ... }`.
//   - package.json must set `boring.server: "server/index.ts"`
//     (a relative path string). NOT `true` — the manifest validator
//     rejects `true` with `INVALID_PLUGIN_METADATA`. Valid values:
//     a path string, OR `false` (no server), OR omit.
//   - For .pi/extensions user plugins, /reload only refreshes front/Pi
//     assets. Server entries require static composition plus restart.
