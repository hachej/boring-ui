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

Custom tools are contributed via server plugins:

```ts
import { defineServerPlugin, defineTool } from '@boring/workspace/server'

const myTool = defineTool({
  name: 'my_tool',
  description: 'Does something useful',
  inputSchema: z.object({ id: z.string() }),
  execute: async ({ id }) => ({ result: `processed ${id}` }),
})

export const myServerPlugin = defineServerPlugin({
  id: 'my-plugin',
  tools: [myTool],
  promptText: 'Use my_tool when the user asks to process an item.',
})
```

## Runtime modes

See [runtime.md](./runtime.md) for how tool execution is sandboxed.
