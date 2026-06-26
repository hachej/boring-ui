# Design FAQ

This page collects the design choices that agents and contributors keep needing during bug hunts and feature work.

## Why are there three main packages instead of one?

Because v1 mixed persistence, chat/runtime, workspace chrome, and deploy concerns together.

v2 splits them on purpose:
- `@hachej/boring-core` owns persistence and identity
- `@hachej/boring-agent` owns the coding-agent runtime
- `@hachej/boring-workspace` owns workspace UI and plugin contracts

Start at `docs/web/architecture/overview.md` for the map, then the package docs for the exact contracts.

## Why must core own the database and auth?

So there is exactly one source of truth for users, workspaces, membership, invites, and app-level settings.

Agent and workspace stay DB-free so they can be embedded, run standalone, or reused without dragging persistence internals through their code.

## Why can the agent run standalone?

That is a product requirement, not an accident. `@hachej/boring-agent` must work as its own local/CLI-shaped product, with zero runtime dependency on core.

See `packages/agent/docs/README.md` and `docs/DECISIONS.md` decision 1.

## Why can base workspace code not import agent internals?

Because workspace is meant to be the reusable workbench layer. The chat surface is injected.

If base front/shared workspace code value-imports `@hachej/boring-agent`, the dependency graph collapses and the package stops being reusable.

The allowed place for composition is the app layer (`@hachej/boring-workspace/app/*`, `@hachej/boring-core/app/*`) and documented server/plugin seams.

## Why do routes and tools receive `Workspace` instead of raw paths?

Because path safety and substrate details belong to the adapter.

Higher-level code should work against the abstract workspace contract. That keeps path validation, symlink-escape rejection, and mode-specific roots centralized.

See `AGENTS.md` invariants 3–5 and `packages/agent/docs/runtime.md`.

## Why must Workspace and Sandbox swap together?

To prevent split-brain filesystem behavior.

If the workspace adapter sees one root and the shell sandbox executes in another, file tools and shell tools disagree about reality. Many nasty bugs reduce to violating this pairing rule.

## Why is `UiBridge.postCommand` the single dispatch source?

Because chat stream display parts are descriptive, not authoritative.

The UI bridge gives one typed command channel for backend intent. Workspace listens there; `data-ui-command` chat parts are just a user-visible echo.

See `docs/WORKSPACE_CONTRACT.md`.

## Why do we prefer `openSurface` over `openPanel`?

Because domain actions should not hardcode panel ids.

`openSurface` lets plugins own the mapping from domain request to concrete panel. That keeps the shell flexible and avoids leaking product rules into generic chat or workspace code.

## Why can generated/runtime plugins not add server routes?

Because today they are hot-reloadable local plugin code, not a hosted sandboxed plugin platform.

Dynamic backend loading would change the trust and lifecycle model. Current design keeps runtime/generated plugins route-free, local-host oriented, and reserves routes/static agent tools for trusted boot-time server plugins.

See `packages/workspace/docs/PLUGIN_SYSTEM.md` §1.1 and §4.5.

## Why do plugin tools bypass the sandbox?

Because trusted server-plugin `agentTools` execute in the host Node process by design.

That is acceptable only for trusted app/internal plugins. If you need hot-reloadable or user-authored behavior, prefer Pi resources and sandbox-backed tools instead of assuming host-process execution.

## Why are runtime modes exposed behind one mental model?

So app authors and users keep one product concept while adapters swap underneath:
- `direct` for trusted local work
- `local` for Linux `bwrap`
- `vercel-sandbox` for remote microVMs

The model-facing workspace namespace stays coherent even when the adapter-private host paths differ.

## How do I add a new runtime mode?

Inject a `runtimeModeAdapter` into `createAgentApp(...)` or `registerAgentRoutes(...)`.

Do not edit random core code first. The adapter must provide a paired `Workspace` + `Sandbox`, preserve the cwd invariant, and own path validation.

Reference: `packages/agent/docs/runtime.md`.

## How do I decide between `extraTools`, `defineServerPlugin`, and Pi resources?

Use:
- `extraTools` when the app shell owns a standalone-agent tool
- `defineServerPlugin({ agentTools })` for trusted boot-time workspace/server composition
- Pi resources for hot-reloadable chat behavior

Reference: `packages/agent/docs/tools.md`.

## Where do I look when docs and code disagree?

Prefer this order:
1. package-local `docs/README.md`
2. normative specs (`PLUGIN_SYSTEM.md`, `INTERFACES.md`, `WORKSPACE_CONTRACT.md`, `DECISIONS.md`)
3. current source/tests
4. archived plans only for history

The archived plans explain why, but they are not the current contract.
