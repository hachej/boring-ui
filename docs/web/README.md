# boring-ui v2 Documentation

boring-ui v2 is a monorepo. Its three composable foundation packages are:

- `@hachej/boring-core` — DB, auth, config, app factory, frontend shell
- `@hachej/boring-agent` — coding agent runtime, tools, chat UI
- `@hachej/boring-workspace` — workspace UI, layouts, plugin system, UI bridge

These sit on top of shared building blocks (`@hachej/boring-ui-kit`, `@hachej/boring-pi`) and the authoring/distribution CLIs (`@hachej/boring-ui-cli`, `@hachej/boring-ui-plugin-cli`), with first-party workspace plugins under `plugins/*` and runnable examples under `apps/*`. See the [Package map](./architecture/package-map.md) for the full inventory.

This docs area is a human-oriented guide to how the packages fit together, what each owns, and where to start.

## Start here

- [Architecture overview](./architecture/overview.md)
- [Package map](./architecture/package-map.md)
- [Getting started](./guides/getting-started.md)
- [Core package](./packages/core.md)
- [Agent package](./packages/agent.md)
- [Workspace package](./packages/workspace.md)
- [Composition guide](./guides/composition.md)
- [Design FAQ](./reference/design-faq.md)
- [Troubleshooting map](./reference/troubleshooting.md)
- [Concepts glossary](./reference/glossary.md)

## Audience

These docs are for:

- app-shell authors composing the three packages
- contributors working inside the monorepo
- integrators deciding where a feature belongs

## What this is not

This is not a generated API reference and not a task tracker. For exact specs, see the package docs in `packages/*/docs/` and the archived design plans under `docs/plans/archive/`.
