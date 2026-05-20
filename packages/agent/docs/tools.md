> The boring-ui agent has a built-in tool catalog. Ask it to use or extend these tools.

# Agent Tools

The agent runtime ships a catalog of tools for interacting with the workspace filesystem and shell.

## Built-in tools

| tool | description |
|---|---|
| `read` | Read a file's contents |
| `write` | Write or overwrite a file |
| `edit` | Apply a targeted string replacement to a file |
| `bash` | Execute a shell command |
| `find` | Find files by name pattern |
| `grep` | Search file contents |
| `ls` | List directory contents |
| `exec_ui` | Post a command to the workspace UI (open panels, navigate, etc.) |
| `get_ui_state` | Read what panels are currently open |

## exec_ui

The primary tool for interacting with the workspace frontend. See [bridge.md](../../workspace/docs/bridge.md) for the full command reference.

```json
{
  "kind": "openSurface",
  "params": { "kind": "my-plugin.open", "target": "item-123" }
}
```

## Adding custom tools

For statically composed app/server integrations, contribute tools from a
workspace server plugin:

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

For hot-reloadable chat behavior in user plugin packages, prefer Pi-native
resources declared in `package.json#pi` (`extensions`, `skills`, `prompts`, and
`systemPrompt`). Those participate in the `/reload` path and are the right
place for tools/skills that should update without restarting the workspace
server.

## Runtime modes

See [runtime.md](./runtime.md) for how tool execution is sandboxed.
