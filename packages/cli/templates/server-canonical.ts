// CANONICAL server/index.ts for a boring-ui plugin (only when
// the plugin has a server side — agent tools and/or HTTP routes).
// Copy this shape — replace <kebab-name> and the tool name.

import { defineServerPlugin, type WorkspaceServerPlugin } from "@hachej/boring-workspace/server"

export default function (
  _options: unknown,
  ctx: { workspaceRoot: string; bridge: unknown },
): WorkspaceServerPlugin {
  return defineServerPlugin({
    id: "<kebab-name>", // MUST match package.json#name
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
//     a path string, OR `false` (no server), OR omit (uses convention).
