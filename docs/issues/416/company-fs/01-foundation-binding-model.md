# PR 1 — Initialize boring-bash skeleton + foundation binding model

## Objective

Create the tiny initial `@hachej/boring-bash` package skeleton and introduce the minimal contracts/seams for policy-granted filesystem bindings, with no behavior change for existing agents.

This PR starts the #391 boring-bash extraction in the smallest possible way. It does **not** move existing file/bash tools/routes/providers yet.

## Scope

### In scope

- Create `packages/boring-bash` (or the repo-approved package path/name) with minimal package/build/export wiring.
- Add no-op export surfaces for future ownership: `/shared`, `/server`, `/agent`, `/plugin`.
- Shared `FilesystemId` / `FilesystemBinding` / capability types.
- Bound context shape used to resolve bindings.
- Provider lifecycle / prepared-binding contract for mounting/projecting filesystems.
- Required #391 plan/ADR update stating boring-bash V1 supports named filesystem bindings with `(filesystem, path)` identity and provider-declared projection/mount modes.
- Tool schema feasibility note for adding `filesystem?: FilesystemId` to existing Pi-style tools.
- UI identity type note: resources are `filesystem + path`.

### Out of scope

- Company provider/projection implementation.
- Moving existing file/bash tools/routes/providers into boring-bash.
- Tool behavior changes.
- UI changes.
- Runtime mount changes.
- Policy DSL.

## #391 / boring-bash compatibility

This PR must create the real tiny `@hachej/boring-bash` package skeleton instead of adding new long-lived staging code under `@hachej/boring-agent`.

This PR must also update the #391 boring-bash plan/ADR before implementation proceeds. It adapts #391's original one-namespace assumption: boring-bash V1 supports named filesystem bindings with `(filesystem, path)` identity and provider-declared projection/mount modes.

Required #391 docs to patch:

- `docs/issues/391/runtime-refactor/02-boring-bash-environment.md` — update one-namespace/volume-view discussion with named filesystem bindings.
- `docs/issues/391/runtime-refactor/07-tests-review-acceptance.md` — add binding/projection conformance and no-denied-file tests.

Initial package shape:

```txt
packages/boring-bash/
  src/shared/   # binding/capability contracts
  src/server/   # provider lifecycle contracts, server-only helpers later
  src/agent/    # injected tool feature boundary later
  src/plugin/   # file tree/viewer plugin boundary later
```

Ownership target:

```txt
@hachej/boring-bash/shared
  FilesystemId, FilesystemBinding, capability, prepared-binding contracts

@hachej/boring-bash/server
  binding resolver/provider lifecycle, routes, filesystem operations

@hachej/boring-bash/agent
  injected file/bash tool feature using Pi factories + Operations adapters

@hachej/boring-bash/plugin
  file tree roots, file viewers, workspace.open.path resolver

@hachej/boring-workspace
  hosts plugins and owns UiBridge dispatch/surface registry

@hachej/boring-agent
  receives injected tools/features only
```

Existing agents should remain on current code paths after this PR. The package exists for #416 contracts and future #391 migration only.

No shared/front-safe type may import `node:*` or use `Buffer`; use `Uint8Array` or base64 for binary payloads if needed.

## Contracts

```ts
export type FilesystemId = 'user' | 'company_context' | (string & {})

export type FilesystemAccess = 'readonly' | 'readwrite'

export type FilesystemProjection =
  | 'policy-filtered' // contains only resources allowed for this actor/session
  | 'management'      // broader management view, policy-granted

export interface FilesystemBinding {
  filesystem: FilesystemId
  access: FilesystemAccess
  mountPath: string
  projection: FilesystemProjection
}

export interface BoundFilesystemContext {
  humanUserId: string
  agentId: string
  sessionId: string
  workspaceId: string
  requestId: string
}

export interface FilesystemBindingResolver {
  resolveBindings(ctx: BoundFilesystemContext): Promise<FilesystemBinding[]>
}

export interface PreparedFilesystemBinding {
  binding: FilesystemBinding
  /** Provider/runtime-specific mount/projection handle. Opaque to shared/front code. */
  handle: unknown
}

export interface FilesystemBindingProvider {
  prepareBinding(ctx: BoundFilesystemContext, binding: FilesystemBinding): Promise<PreparedFilesystemBinding>
  disposeBinding?(prepared: PreparedFilesystemBinding): Promise<void>
  invalidateBinding?(ctx: BoundFilesystemContext, filesystem: FilesystemId): Promise<void>
}

export interface RuntimeBindingPlan {
  /** Bindings prepared for this one runtime/session. */
  bindings: PreparedFilesystemBinding[]
}
```

V0 has one active runtime per agent session/workspace. Do not add `environmentId` in this PR.

## Policy model

Do not hardcode product roles. Policy can return:

```txt
no company binding
readonly policy-filtered company binding
readwrite management company binding
```

The app/provider decides who gets which binding. PR 1 defines only the contract; later PRs implement readonly and readwrite behavior.

Production policy source should be the host app DB, owned by core/full-app/Constellation. Boring-bash only receives a `FilesystemBindingResolver`. File-backed policy resolvers are allowed only for CLI/dev/test fixtures, not as production source of truth.

## Provider lifecycle note

The provider lifecycle seam exists so later PRs do not invent projection/mount cleanup ad hoc. Providers own persistence/snapshots/backups, but boring-bash owns the lifecycle hook shape:

```txt
resolve policy binding -> prepare provider projection/mount -> pass prepared bindings into runtime-mode adapter -> use in tools/routes/runtime -> dispose/invalidate
```

Prepared bindings are part of runtime creation, preserving the Workspace+Sandbox pairing invariant: file tools, shell, routes, and UI must all observe the same prepared binding set for a session/runtime.

A readonly policy-filtered projection must be invalidatable when policy changes. A readwrite management binding must be a distinct prepared binding from a normal readonly projection.

## Tool feasibility note

Before PR 3, inspect current Pi factories:

```txt
createReadToolDefinition
createWriteToolDefinition
createEditToolDefinition
createFindToolDefinition
createGrepToolDefinition
createLsToolDefinition
```

Record how to add `filesystem?: FilesystemId` while preserving Pi factory + Operations adapter flow. The PR1 feasibility note lives at [`pi-tool-schema-feasibility.md`](./pi-tool-schema-feasibility.md).

Preferred:

```txt
Pi factory -> narrow schema wrapper -> operation resolver uses filesystem binding
```

No divergent ad-hoc file tool fork.

## UI identity note

Any UI surface that opens files must eventually identify resources by:

```txt
filesystem + path
```

Examples:

```txt
user:/src/app.ts
company_context:/company/hr/policy.md
```

This PR only defines the type/contract; later PRs wire behavior.

## Tests

- New `@hachej/boring-bash` package builds/typechecks with minimal exports.
- Existing agent/workspace apps continue to compile without adopting boring-bash globally.
- #391 plan/ADR is updated to mention named filesystem bindings and `(filesystem, path)` identity.
- Type exports compile in the new package.
- Shared/front-safe contracts have no Node value imports and no `Buffer`.
- Existing invariant tests still pass.
- No `@hachej/boring-agent` → `@hachej/boring-bash` value import cycle.
- Descriptor identity fields are required internally.
- Prepared-binding lifecycle contracts are server-only or use opaque handles in shared types so front/shared code does not import runtime values.

## Review checklist

Block if:

- behavior is added beyond package skeleton/contracts/seams;
- existing file/bash tools/routes/providers are moved in this PR;
- roles like `admin` are hardcoded into contracts;
- `environmentId` or multi-runtime complexity is added to V0;
- new long-lived staging code is added under agent instead of tiny boring-bash package ownership;
- provider lifecycle is left for PR 2/4 to invent ad hoc;
- Pi schema feasibility remains unknown before PR 3.