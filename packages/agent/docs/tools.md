> The boring-ui agent has a built-in tool catalog. Ask it to use or extend these tools.

# Agent Tools

The agent runtime ships a catalog of tools for interacting with the workspace filesystem and shell.

## Filesystem + shell tools

These are adapted from `@earendil-works/pi-coding-agent` and bound to the
selected runtime mode (see [runtime.md](./runtime.md)):

| tool | description |
|---|---|
| `read` | Read a file's contents |
| `write` | Write or overwrite a file |
| `edit` | Apply a targeted string replacement to a file |
| `bash` | Execute a shell command |
| `find` | Find files by name pattern |
| `grep` | Search file contents |
| `ls` | List directory contents |

## Tools added by this package

| tool | description |
|---|---|
| `execute_isolated_code` | Run code in an isolated sandbox capability |
| `upload_file` | Upload a workspace file to blob storage |
| `plugin_diagnostics` | Report loaded plugins and any load errors |

## UI-bridge tools (workspace-owned)

`exec_ui` and `get_ui_state` are **not** part of the standalone agent. They are
contributed by `@hachej/boring-workspace` when the agent is mounted via
`createWorkspaceAgentApp`. Standalone `createAgentApp` ships no UI tools. For the
UI command reference see `packages/workspace/docs/PLUGIN_SYSTEM.md`.

## Adding custom tools

Three paths — pick by who owns the tool and how it should update:

| Path | Use when | Lifecycle |
| --- | --- | --- |
| `createAgentApp({ extraTools })` | App shell owns the tool, standalone agent | Boot-time |
| `defineServerPlugin({ agentTools })` | A workspace plugin package contributes it | Boot-time |
| Pi-native `.pi/extensions` | Tool should hot-reload with `/reload` | Hot-reloadable |

**App-shell `extraTools`** — the simplest path for a standalone agent: pass
`extraTools: [myTool]` to `createAgentApp(...)` (or `registerAgentRoutes`).
Runnable example with a custom renderer:
[`examples/with-custom-tool`](../examples/with-custom-tool/README.md).
Collision precedence is built-in → `extraTools` → plugin tools, last wins
(see [PLUGINS.md](./PLUGINS.md)).

**Workspace server plugin** — for statically composed app/server integrations,
contribute tools from a workspace server plugin:

```ts
import { defineServerPlugin } from "@hachej/boring-workspace/server"

export default defineServerPlugin({
  id: "my-plugin",
  systemPrompt: "Use my_tool when the user asks to process an item.",
  agentTools: [
    {
      name: "my_tool",
      description: "Does something useful",
      parameters: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
        additionalProperties: false,
      },
      async execute(params) {
        return {
          content: [{ type: "text", text: `processed ${String(params.id)}` }],
        }
      },
    },
  ],
})
```

Expose that entry with `package.json#boring.server` or pass the plugin object to
`createWorkspaceAgentServer({ plugins: [...] })`. This is static/boot-time
server composition; restart the host process after changing routes or tools.
`execute(params, ctx)` also receives a context (`abortSignal`, `toolCallId`,
`onUpdate`) — full contract in [PLUGINS.md](./PLUGINS.md#tool-contract).

**Pi-native resources** — for hot-reloadable chat behavior in user plugin packages, prefer Pi-native
resources declared in `package.json#pi` (`extensions`, `skills`, `prompts`, and
`systemPrompt`). Those participate in the `/reload` path and are the right
place for tools/skills that should update without restarting the workspace
server.

## Runtime modes

See [runtime.md](./runtime.md) for how tool execution is sandboxed.
