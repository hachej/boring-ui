# 02 — `@hachej/boring-bash` environment

## Goal

Create `@hachej/boring-bash` as the optional working environment package for files and shell.

It owns:

- filesystem API;
- exec/bash API;
- runtime cwd semantics;
- path validation and containment;
- file watch/search;
- file/tree/search/stat/fs-event routes;
- file/bash/upload agent tools;
- file tree/editor/viewer UI plugin;
- provider adapters and provider capability descriptions.

It does not own the model loop, auth, billing, workspace membership, or UI bridge core.

## Layered exports

```txt
@hachej/boring-bash/shared
  BashEnvironment, BashFs, BashExec, BashRequirement, provider capability types

@hachej/boring-bash/server
  file/tree/search/watch routes, createBashEnvironment, runtime route adapters

@hachej/boring-bash/agent
  createBashAgentFeature(), file/bash/upload tools

@hachej/boring-bash/plugin
  file tree, editor/viewer panes, workspace.open.path resolver

@hachej/boring-bash/providers
  direct, bwrap, vercel-sandbox, remote-worker, readonly, none
```

No `@hachej/boring-agent` value import cycle is allowed.

## Runtime mode vs provider names

Do not collapse current runtime modes into provider names.

| Current mode | Current sandbox provider | Boring-bash provider | Notes |
| --- | --- | --- | --- |
| `direct` | `direct` | `direct` | Trusted host mode; no isolation. |
| `local` | `bwrap` | `bwrap` | Linux bubblewrap. Mode id differs from provider id. |
| `vercel-sandbox` | `vercel-sandbox` | `vercel-sandbox` | Remote sandbox. |
| remote-worker adapter | `remote-worker` | `remote-worker` | Client/mode and worker server split must stay explicit; worker handshake must declare capabilities. |
| pure/headless | none | none | No boring-bash. |
| readonly files | provider-specific | `readonly` facade | fs/search/watch without exec. |

## Provider capability matrix

Provider labels lie unless backed by capability facts.

| Provider | FS | Exec | Real Bash | Real binaries | Network isolation | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `none` | none | no | no | no | n/a | Pure agent. |
| `readonly` | readonly | no | no | no | n/a | File UI/search only. |
| `direct` | readwrite | yes | host-dependent | host-dependent | none | Trusted dev/CI only. |
| `bwrap` | readwrite | yes | host-dependent | host-dependent | process/container-ish | Linux-only. |
| `vercel-sandbox` | readwrite | yes | yes | provider image | provider | Good sandbox-primary remote coding. |
| `remote-worker` | readwrite | yes | worker-dependent | worker-dependent | worker-dependent | Must report matrix in handshake; provisioning adapter support requires widening current adapter mode union. |

## BashEnvironment

```ts
interface BashEnvironment {
  id: string
  provider: 'direct' | 'bwrap' | 'vercel-sandbox' | 'remote-worker' | string
  runtimeCwd: string
  fs?: BashFs
  exec?: BashExec
  search?: BashSearch
  watch?: BashWatch
  provisioning?: BashProvisioningState // runtime summary/readiness, not requirement input
  providerCapabilities: {
    fs: 'none' | 'readonly' | 'readwrite'
    exec: boolean
    realBash?: boolean
    realBinaries?: boolean
    networkIsolation?: 'none' | 'process' | 'container' | 'microvm' | 'provider'
    watch: boolean
    search: boolean
  }
}
```

## One namespace rule

V1 should preserve one coherent model-visible namespace, normally `/workspace`.

Multiple mounts and overlays may exist internally, but file routes, search, watch, bash, git/status, and model-facing paths must agree on one view.

Forbidden:

- file tree reads host `/data/workspaces/<id>` while bash edits remote `/workspace`;
- git/status reads a different root than file routes;
- `read_file` hides files that raw bash can still cat;
- session durability is treated as file durability.

## Storage-primary vs sandbox-primary

| Model | Source of truth | Use when |
| --- | --- | --- |
| sandbox-primary | live sandbox `/workspace` | remote coding sessions; file routes/search/bash delegate to sandbox |
| storage-primary | host/object/git storage; sandbox is materialized projection | review, disposable runs, restricted exposure, patch workflows |

Existing `getRuntimeBundleStorageRoot()` and git/file route decisions are the starting seams. Reuse them; do not invent a second storage-root resolver.

## Volume view

```ts
interface BashVolumeView {
  id: string
  workspaceId?: string
  root: '/workspace'
  mounts: BashMount[]
  overlay?: {
    mode: 'none' | 'scratch' | 'branch' | 'persistent'
    persistAs?: 'workspace-patch' | 'artifact' | 'discard'
  }
}
```

V1 decision: keep one public root by default. `mounts` are internal/future unless Phase 0 ADR explicitly defines how multiple mounts materialize into one coherent `/workspace` namespace.

## Remote-worker split

Current code has a real split:

- client/protocol/mode code lives under `packages/agent/src/server/sandbox/remote-worker/*` and `packages/agent/src/server/runtime/modes/remote-worker.ts`;
- worker server code lives under `apps/full-app/src/server/worker/*`.

Extraction rule:

- shared protocol/types move to `boring-bash/shared`;
- client/provider adapter moves to `boring-bash/providers/remote-worker`;
- full-app worker server may move to `boring-bash/server/remote-worker` or stay app-owned, but it must depend only on shared protocol/provider server contracts, not on agent core.

Current `WorkspaceProvisioningAdapter.mode` is closed around existing modes. Supporting `remote-worker`, `readonly`, or `none` provisioning requires explicitly widening or short-circuiting that union.

## Tools to move or consciously assign

Current true inventory:

- `buildFilesystemAgentTools()` → `read`, `write`, `edit`, `find`, `grep`, `ls`;
- `buildHarnessAgentTools()` → `bash`, `execute_isolated_code`;
- `buildUploadAgentTools()` → upload/runtime artifact tools.

Move these to `boring-bash/agent` or document why a tool stays elsewhere.

Must preserve:

- `disableDefaultFileTools` behavior;
- readiness tags (`workspace-fs`, `sandbox-exec`, `runtime-dependencies`, `runtime:<id>`);
- model-facing stale-read/write safety;
- existing renderer behavior.

## File tree and document authority

### FileTreeDataProvider (#295)

`boring-bash/plugin` should expose a replaceable file tree data boundary:

```ts
interface FileTreeDataProvider {
  listTree(root: string, options: TreeOptions): Promise<TreeNode[]>
  listPaths?(root: string, options: PathIndexOptions): Promise<string[]>
  subscribe?(root: string): AsyncIterable<FileTreeDelta>
}
```

This lets Pierre Trees or another tree UI replace the view without changing server routes again.

### Document-authority override (#367, #226)

When a live document system owns a file (TipTap/Yjs/etc.), model-facing `write`/`edit` must be overridable:

- route through document coordinator;
- validate stale version/hash;
- avoid bypassing live collaborative state;
- fall back to raw file edit only when no document authority is active.

## UI plugin ownership

Move `packages/workspace/src/plugins/filesystemPlugin/front/*` into `boring-bash/plugin` while preserving:

- panel ids;
- `workspace.open.path` surface resolver;
- file panel binding;
- agent file bridge/session-change integration;
- `/api/v1/files/*` route compatibility or aliases.

The workspace bridge remains owned by `@hachej/boring-workspace`.

## Tests

- provider mode mapping test;
- one namespace/split-brain tests per provider;
- direct/local/vercel/remote-worker file+exec consistency;
- readonly fs without exec;
- `disableDefaultFileTools` parity;
- `execute_isolated_code` ownership/readiness;
- upload/download route ownership;
- file tree provider path-list and deltas;
- document-authority write/edit override;
- git/status source-of-truth consistency.
