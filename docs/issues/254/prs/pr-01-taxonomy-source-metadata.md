# PR 01 — Taxonomy docs + plugin source metadata

## Goal

Prepare the model for CLI/local runtime backends without executing anything yet.

## Scope

- Document single-field `boring.server` semantics by source kind.
- Preserve manifest/schema support for safe `boring.server` paths.
- Introduce first-class plugin source metadata so later code does not infer trust from path strings.

## Proposed files

- `packages/workspace/src/shared/plugins/manifest.ts`
- `packages/workspace/src/server/agentPlugins/types.ts`
- `packages/workspace/src/server/agentPlugins/scan.ts`
- `packages/workspace/src/app/server/createWorkspaceAgentServer.ts` only if needed to pass source metadata through
- plugin docs/skills

## Source model

```ts
type BoringPluginSource = {
  root: string
  kind: "workspace-extension" | "global-extension" | "default-package" | "additional-dir" | "npm-package" | "git-package" | "local-path"
  scope: "workspace" | "global" | "app"
  workspaceId?: string
}
```

Loaded plugin records should preserve source metadata and optionally expose the validated `boring.server` path.

## Non-goals

- No gateway.
- No jiti runtime backend loader.
- No install command.
- No backend execution behavior yet.

## Tests

- Manifest accepts safe `boring.server` path.
- Unsafe `boring.server` path is rejected.
- Source metadata survives scan/load result.
- Workspace/global external sources are identifiable.
- Default package/app sources are identifiable separately.

## Acceptance

- Docs clearly say external CLI backends use `boring.server` through the constrained runtime-server gateway, while internal/app plugins use boot-time server wiring.
- Runtime backend trust/activation is derived explicitly from source metadata in one place.
