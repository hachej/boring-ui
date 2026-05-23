# Getting started

This is the shortest path to understanding the repo.

## 1. Learn the three packages

- `@boring/core` — foundation
- `@boring/agent` — coding agent
- `@boring/workspace` — workspace UI

Start with:
- `packages/core/docs/CORE.md`
- `packages/agent/docs/plans/agent-package-spec.md`
- `packages/workspace/docs/INTERFACES.md`

## 2. Understand the intended composition

A typical app shell:

- uses core for DB, auth, config, and the main server
- mounts agent server routes into that app
- renders workspace UI in the frontend
- injects agent chat into the workspace experience

## 3. Know the main package boundaries

- core owns persistence and identity
- agent owns runtime and tools
- workspace owns layouts, plugins, and UI bridge

## 4. Pick the right entrypoint

### If you are building an app shell
Start from core and compose the others in.

### If you want a standalone coding agent
Start from agent.

### If you want IDE-like UI structure and plugin surfaces
Start from workspace.

## 5. Read the package docs

- [Core package](../packages/core.md)
- [Agent package](../packages/agent.md)
- [Workspace package](../packages/workspace.md)

## 6. Watch the invariants

Important examples:

- shared code stays platform-agnostic
- workspace and sandbox must share the same filesystem substrate
- `WorkspaceBridge.emitUiEffect` is the dispatch source
- workspace base code must not value-import agent

## Next steps

- [Composition guide](./composition.md)
- [Architecture overview](../architecture/overview.md)
- [Glossary](../reference/glossary.md)
