# Repo Commands

Run from repo root unless stated otherwise.

```bash
pnpm install
pnpm dev
pnpm build
pnpm typecheck
pnpm lint
pnpm test
pnpm lint:invariants
pnpm ci
```

Scoped examples:

```bash
pnpm --filter @hachej/boring-workspace run test
pnpm --filter @hachej/boring-agent run test
pnpm --filter @hachej/boring-workspace run typecheck
pnpm --filter workspace-playground dev
pnpm --filter agent-playground dev
pnpm --filter full-app dev
```

Apps that consume `@hachej/boring-workspace` from source need workspace built
once first:

```bash
pnpm --filter @hachej/boring-workspace build && pnpm --filter workspace-playground test
```

## Package Docs

Start at [`docs/README.md`](../../README.md), then descend into the relevant
package:

- Core: `packages/core/docs/README.md`
- Agent: `packages/agent/docs/README.md`
- Workspace: `packages/workspace/docs/README.md`
- Plugin system: `packages/workspace/docs/PLUGIN_SYSTEM.md`
- Plugin layout/code patterns: `packages/workspace/docs/PLUGIN_STRUCTURE.md`
