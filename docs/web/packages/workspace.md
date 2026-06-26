# `@hachej/boring-workspace`

`@hachej/boring-workspace` is the workspace UI and bridge package.

## What it owns

- layouts and Dockview shell behavior
- plugin registries
- panel contracts
- UI bridge client/runtime
- plugin-owned commands, catalogs, tabs, and surface resolvers
- app composition helpers for agent-enabled workspace shells
- the two-tier plugin model: trusted boot-time app/internal plugins vs local runtime/generated plugins

## What it is for

Use workspace when you need:

- IDE-style structure
- pluggable panels and tabs
- command/catalog surfaces
- a bridge between backend intent and frontend workspace actions

## Key contracts

**Front plugin authoring** uses `definePlugin({ ... })` with:

- `panels`
- `leftTabs`
- `commands`
- `catalogs`
- `bindings`
- `providers`
- `surfaceResolvers`

**Trusted server plugins** separately contribute routes, `agentTools`, provisioning,
and prompt/resources at boot time through `defineServerPlugin({ ... })`.

**Runtime/generated plugins** live under `.pi/extensions/*`, hot-reload front + Pi
resources, and stay route-free.

## Important boundary

Workspace base front/shared code should not value-import `@hachej/boring-agent`.

Agent-aware composition belongs in app composition layers, not in the package-neutral workspace base.

## Typical usage

Common app-front path:

```tsx
import { WorkspaceAgentFront } from '@hachej/boring-workspace/app/front'

<WorkspaceAgentFront workspaceId="demo" plugins={[]} />
```

Lower-level composition is still available through `WorkspaceProvider` + layout
components when an app needs custom wiring.

## Related docs

- canonical docs: `packages/workspace/docs/README.md`
- [Design FAQ](../reference/design-faq.md)
- [Troubleshooting map](../reference/troubleshooting.md)
- [Package map](../architecture/package-map.md)
