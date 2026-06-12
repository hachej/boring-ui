# `@hachej/boring-workspace`

`@hachej/boring-workspace` is the workspace UI and bridge package.

## What it owns

- layouts and Dockview shell behavior
- plugin registries
- panel contracts
- UI bridge client/runtime
- plugin-owned commands, catalogs, tabs, and surface resolvers
- app composition helpers for agent-enabled workspace shells

## What it is for

Use workspace when you need:

- IDE-style structure
- pluggable panels and tabs
- command/catalog surfaces
- a bridge between backend intent and frontend workspace actions

## Key contracts

Workspace plugin outputs include:

- `panel`
- `left-tab`
- `command`
- `catalog`
- `binding`
- `provider`
- `surface-resolver`
- `agent-tool`

## Important boundary

Workspace base front/shared code should not value-import `@hachej/boring-agent`.

Agent-aware composition belongs in app composition layers, not in the package-neutral workspace base.

## Typical usage

```tsx
import { WorkspaceProvider, IdeLayout } from '@hachej/boring-workspace'
import { ChatPanel } from '@hachej/boring-agent'

<WorkspaceProvider chatPanel={ChatPanel}>
  <IdeLayout />
</WorkspaceProvider>
```

## Related docs

- canonical interfaces: `packages/workspace/docs/INTERFACES.md`
- package docs: `packages/workspace/docs/`
- [Package map](../architecture/package-map.md)
