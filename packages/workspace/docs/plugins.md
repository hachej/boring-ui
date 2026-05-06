> boring-ui can create plugins. Ask it to build one for your use case.

# Plugins

Plugins are the primary extension point. A plugin contributes panels, commands, catalogs, left-tabs, and surface resolvers to the workspace shell.

**Key capabilities:**
- **Panels** — center/right/bottom panes opened programmatically by the agent or user
- **Commands** — entries in the command palette (`cmd+k`)
- **Left tabs** — persistent tabs in the left sidebar
- **Catalogs** — data explorer tabs with search + row selection
- **Surface resolvers** — map agent-emitted `openSurface` requests to concrete panel opens
- **Bindings / providers** — React components mounted in the provider tree

## Table of Contents

- [Minimal plugin](#minimal-plugin)
- [Output types](#output-types)
- [System prompt](#system-prompt)
- [Composing plugins](#composing-plugins)
- [Server plugins](#server-plugins)
- [Registering with the shell](#registering-with-the-shell)
- [Plugin folder layout](#plugin-folder-layout)
- [Invariants](#invariants)

---

## Minimal plugin

```ts
import { defineFrontPlugin, definePanel } from '@boring/workspace'

export const myPlugin = defineFrontPlugin({
  id: 'my-plugin',
  label: 'My Plugin',
  systemPrompt: "You can open the widget panel with the 'open-panel' tool.",
  outputs: [
    {
      type: 'panel',
      panel: definePanel({
        id: 'my-widget',
        title: 'Widget',
        placement: 'center',
        component: () => import('./WidgetPane').then(m => ({ default: m.WidgetPane })),
      }),
    },
  ],
})
```

---

## Output types

| type | contributes |
|---|---|
| `panel` | a center/right/bottom pane opened programmatically |
| `left-tab` | a persistent tab in the left sidebar |
| `command` | an entry in the command palette |
| `catalog` | a data explorer tab with search + row selection |
| `surface-resolver` | maps a `SurfaceOpenRequest` kind → panel id |
| `binding` | a React component mounted in the provider tree |
| `provider` | same as binding but receives `apiBaseUrl`, `authHeaders`, etc. |

---

## System prompt

The `systemPrompt` field on a plugin is injected into the agent's context. Use it to teach the agent what panels exist and when to open them.

```ts
defineFrontPlugin({
  id: 'contract-review',
  systemPrompt: `
    You can open the contract review panel when the user asks to review a contract.
    Use exec_ui with kind "openSurface" and kind "contract-review.open".
  `,
  ...
})
```

All plugin `systemPrompt` strings are concatenated and passed as `systemPromptAppend` to the agent harness.

---

## Composing plugins

```ts
import { composePlugins } from '@boring/workspace'

export const myPlugin = composePlugins({
  id: 'my-plugin',
  plugins: [panelsPlugin, catalogPlugin, surfacePlugin],
})
```

`composePlugins` flattens child panels, commands, catalogs, bindings, and outputs into one `WorkspaceFrontPlugin`. Child ownership adopts to the parent plugin id by default.

---

## Server plugins

Server plugins contribute agent tools, routes, and pi package declarations:

```ts
import { defineServerPlugin } from '@boring/workspace/server'

export const myServerPlugin = defineServerPlugin({
  id: 'my-plugin',
  tools: [myAgentTool],
  promptText: 'You have access to the my_tool tool.',
})
```

Compose server plugins with `composeServerPlugins()`.

---

## Registering with the shell

```tsx
import { WorkspaceAgentFront } from '@boring/workspace'

<WorkspaceAgentFront plugins={[myPlugin]} />
```

---

## Plugin folder layout

```
src/plugins/myPlugin/
  front/
    index.tsx          ← defineFrontPlugin(), public front exports
    panels.tsx         ← panel definitions
    surfaceResolver.ts ← openSurface kind → panel resolution
  server/
    index.ts           ← defineServerPlugin(), public server exports
    tools.ts           ← agent tools
  shared/
    constants.ts       ← plugin id, surface kinds
    types.ts           ← platform-neutral shared types
```

Use only the files the plugin needs.

---

## Invariants

```bash
pnpm --filter @boring/workspace run lint:plugin-invariants
```

Rejects cross-layer imports, legacy file names, and plugin-domain imports from workspace chrome.

See [panels.md](./panels.md) for panel component API.
See [bridge.md](./bridge.md) for how to open panels from the agent.
