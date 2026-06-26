# PR 02 — Reload coordinator extraction

## Goal

Extract existing plugin reload sequencing before adding runtime backend reload.

This is a behavior-preserving refactor.

## Scope

Create one reload coordinator used by both reload entrypoints:

- `/api/v1/agent/reload` through `createAgentApp.beforeReload`
- `/api/boring.reload`

## Proposed files

- `packages/workspace/src/app/server/workspacePluginReload.ts` new
- `packages/workspace/src/app/server/createWorkspaceAgentServer.ts` wiring only
- `packages/workspace/src/server/agentPlugins/routes.ts` should call the same coordinator closure, not duplicate sequencing
- reload tests

## Coordinator responsibilities

Current behavior only:

```txt
assetManager.load()
rebuildServerPlugins() diagnostic-only
runRuntimeProvisioning()
opts.beforeReload()
merge diagnostics/restart_warnings
```

## Non-goals

- No runtime backend registry.
- No gateway.
- No source install.
- No behavior change.

## Tests

- Existing reload tests pass unchanged.
- `/api/v1/agent/reload` and `/api/boring.reload` surface same scan/rebuild diagnostics.
- Caller `opts.beforeReload` diagnostics are merged with Boring diagnostics.
- Per-plugin failures do not abort unrelated reload work.

## Acceptance

- `createWorkspaceAgentServer.ts` does not grow.
- Reload sequence exists in one place.
