# Pattern: slash commands that open a panel (UI actions)

Two separate command systems exist. Know which one to use:

| System | Where declared | Appears in | Executes |
|--------|---------------|------------|---------|
| `definePlugin.commands` | `front/index.tsx` | boring-ui command palette (Ctrl+K) | Boring-ui opens the panel directly — no agent involved |
| `pi.registerCommand` + `pi.slashCommands` | `agent/index.ts` + `package.json` | Agent slash picker (`/open-…`) | Pi runs the handler; handler calls `openPanel` via UI bridge |

**For a slash command the user types in the agent chat** (`/open-<name>`), use the Pi path. The scaffold already generates this — run it, then customize the placeholders. Do not rewrite from scratch.

The pattern requires two things:

**1. Static declaration in `package.json`** — so the command appears in the picker immediately on plugin load, before any agent code runs:

```jsonc
"pi": {
  "slashCommands": [
    { "name": "open-<kebab-name>", "description": "Open the <Label> panel" }
  ]
}
```

**2. Runtime handler in `agent/index.ts`** — uses `openPanel` from `@hachej/boring-workspace/plugin` (host-provided, do not add to dependencies):

```ts
import { NoWorkspaceUiBridgeError, notify, openPanel } from "@hachej/boring-workspace/plugin"

export default function (pi: any) {
  pi.registerCommand("open-<kebab-name>", {
    description: "Open the <Label> panel",
    handler: async () => {
      try {
        await openPanel({ id: "<kebab-name>.slash-open", component: "<kebab-name>.panel" })
        await notify("Opened <Label>.", "info")    // shows in composer status bar
      } catch (error) {
        if (error instanceof NoWorkspaceUiBridgeError) throw error
        await notify(`Could not open <Label>: ${error instanceof Error ? error.message : String(error)}`, "error").catch(() => {})
        throw error
      }
    },
  })
}
```

Key rules:
- `openPanel` uses the in-process UI bridge — no `BORING_UI_URL`, no `fetch`, no env vars.
- `notify` surfaces a toast in the composer status bar, not a chat message.
- `openPanel` / `notify` are **server/agent-side only** — do not import them in `front/index.tsx`.
