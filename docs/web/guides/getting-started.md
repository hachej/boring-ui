# Getting started

This is the shortest path to understanding the repo.

## 1. Learn the three foundation packages

- `@hachej/boring-core` — foundation
- `@hachej/boring-agent` — coding agent
- `@hachej/boring-workspace` — workspace UI

Start with:
- `packages/core/docs/README.md`
- `packages/agent/docs/README.md`
- `packages/workspace/docs/README.md`

(See the [Package map](../architecture/package-map.md) for the supporting packages, plugins, and example apps.)

## 2. Understand the intended composition

A typical app shell usually starts from the composed core surfaces:

- `createCoreWorkspaceAgentServer()` for the server
- `CoreWorkspaceAgentFront` for the frontend

Underneath that:
- core owns DB, auth, config, and app identity
- agent owns runtime, tools, and chat
- workspace owns layout, plugins, and the UI bridge

## 3. Know the main package boundaries

- core owns persistence and identity
- agent owns runtime and tools
- workspace owns layouts, plugins, and UI bridge

## 4. Pick the right entrypoint

### If you are building an app shell
Start from `@hachej/boring-core/app/server` and `@hachej/boring-core/app/front`.

### If you want a standalone coding agent
Start from agent.

### If you want IDE-like UI structure and plugin surfaces
Start from workspace.

## 5. Read the package docs

- [Core package](../packages/core.md)
- [Agent package](../packages/agent.md)
- [Workspace package](../packages/workspace.md)
- [Design FAQ](../reference/design-faq.md)
- [Troubleshooting map](../reference/troubleshooting.md)

## 6. Build and test from the root

The repo is a pnpm workspace (`pnpm-workspace.yaml` globs `packages/*`, `plugins/*`, `apps/*`, plus agent examples and workspace test fixtures). Common root scripts:

```bash
pnpm build          # build every workspace (-r)
pnpm build:packages # build only packages/* and plugins/*
pnpm typecheck      # build packages then typecheck all
pnpm test           # build packages then run all unit tests
pnpm lint           # generated-artifact + import-boundary audits
pnpm e2e            # agent end-to-end tests
pnpm ci             # lint + typecheck + test + invariants + e2e
```

To run a playground app, filter to it, e.g. `pnpm --filter workspace-playground dev` (see [proof-of-work](../../kanzen/procedures/proof-of-work.md) for the port convention).

## 7. Watch the invariants

Important examples:

- shared code stays platform-agnostic
- workspace and sandbox must share the same filesystem substrate
- `UiBridge.postCommand` is the dispatch source
- workspace base code must not value-import `@hachej/boring-agent`

## Next steps

- [Composition guide](./composition.md)
- [Architecture overview](../architecture/overview.md)
- [Design FAQ](../reference/design-faq.md)
- [Troubleshooting map](../reference/troubleshooting.md)
- [Glossary](../reference/glossary.md)
