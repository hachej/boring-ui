# boring-ui v2 Documentation

boring-ui v2 is a monorepo for three composable packages:

- `@boring/core` — DB, auth, config, app factory, frontend shell
- `@boring/agent` — coding agent runtime, tools, chat UI, CLI
- `@boring/workspace` — workspace UI, layouts, plugin system, UI bridge

This docs area is a human-oriented guide to how the packages fit together, what each owns, and where to start.

## Start here

- [Architecture overview](./architecture/overview.md)
- [Package map](./architecture/package-map.md)
- [Getting started](./guides/getting-started.md)
- [Core package](./packages/core.md)
- [Agent package](./packages/agent.md)
- [Workspace package](./packages/workspace.md)
- [Composition guide](./guides/composition.md)
- [Concepts glossary](./reference/glossary.md)

## Audience

These docs are for:

- app-shell authors composing the three packages
- contributors working inside the monorepo
- integrators deciding where a feature belongs

## What this is not

This is not a generated API reference and not a bead tracker. For exact specs, see the package docs in `packages/*/docs/` and the design plans referenced throughout.
