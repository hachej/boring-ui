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
- file tree/editor/viewer UI plugin, bash/file tool renderers, and file composer providers;
- **runtime-mode resolution (`resolveMode` — the CHOICE of sandbox).**

It does not own the model loop, auth, billing, workspace membership, or UI bridge core. **Nor does it own the concrete sandbox providers themselves:** the provider adapters (`direct`, `bwrap`, `vercel-sandbox`, `remote-worker`), their capability descriptions, FUSE-S3 mounts, and sandbox lifecycle live in **`@hachej/boring-sandbox`** (sandbox management). boring-bash imports boring-sandbox **values** (the providers it resolves a mode to) + agent **types**; boring-sandbox imports agent **types only**. Acyclic: `boring-sandbox → agent(types)`; `boring-bash → boring-sandbox(values) + agent(types)`. (00 open decision 3, RESOLVED; 08 decision 11.)

## Layered exports

```txt
@hachej/boring-bash/shared
  BashEnvironment, BashFs, BashExec, BashRequirement, environment/file binding helper types

@hachej/boring-bash/server
  file/tree/search/watch routes, createBashEnvironment, runtime route adapters

@hachej/boring-bash/agent
  createBashAgentFeature(), file/bash/upload tools

@hachej/boring-bash/plugin
  file tree, editor/viewer panes, workspace.open.path resolver,
  bash/file tool renderers, file mention/slash composer providers

@hachej/boring-bash/modes
  resolveMode(), autoDetectMode(), hasBwrap() — runtime-mode resolution (the CHOICE of sandbox);
  resolves a mode id to a @hachej/boring-sandbox provider value
```

## Two consumption modes

`@hachej/boring-bash` has two supported consumption modes:

1. **Plugin mode (workspace-family hosts).** `boring-bash` ships as one internal plugin through the existing workspace plugin pipeline: a manifest-declared server entry returns `defineServerPlugin({ agentTools, routes, systemPrompt, piPackages, provisioning })`, where `agentTools` and `systemPrompt` come from the bash tool bundle and `routes` composes `registerBashRoutes`; the front entry returns `definePlugin(...)` for the file tree, panes, bash/file tool renderers, and file composer providers. Hosts such as `createWorkspaceAgentServer`, core/full-app, and playground-style workspace hosts register the package as an internal/default plugin and let the manifest/entry resolver load it dynamically. They do not statically import `@hachej/boring-bash`, hand-spread its tools, hand-append its prompt fragment, hand-mount its routes, or hardcode its renderers/composer providers. The `/plugin` subpath may import the public workspace plugin SDK because the reverse workspace→bash edge is dynamic, not static.
2. **Library mode (headless/direct composers).** Non-workspace hosts that do not use the workspace plugin pipeline may import the public bundle and route helpers directly: `createBashAgentFeature()` from `/agent` and `registerBashRoutes` from `/server`. This is for plain `createAgent` embedders and any CLI composition path that still calls the agent server directly instead of entering the workspace plugin pipeline.

`packages/agent` supports neither mode by importing bash. It remains pure and receives only already-composed tools/readiness/runtime adapters from its caller.

Workspace-family hosts may load several first-party plugins through this door; the split is mechanism vs policy. The `boring-bash` plugin is the multi-fs **mechanism**: the `@hachej/boring-bash` package owns the shared binding contracts, enforcement, no-leak projection operations, tools/routes/tree, and the plugin is only its delivery vehicle. The `boring-governance` plugin (the #475 line, extracted as `plugins/boring-governance` in PR #532, rolled up in #544) is multi-fs **policy**: YAML governance, `company_context` bootstrap/mount, budgets, and admin UI. Governance depends on `@hachej/boring-bash/shared` **and value-imports the `/server` mechanism exports** (the projection operations, `ScopedFilesystemRuntimeBindingManager`, `COMPANY_CONTEXT_FILESYSTEM_ID`); bash enforces the bindings governance resolves. The invariants that hold are: **governance never imports workspace internals**, and **bash never imports governance**.

The live seam is agent-owned, not a plugin-to-plugin composition point: governance exposes `getFilesystemBindings()` typed as `RegisterAgentRoutesOptions['getFilesystemBindings']`, hand-spread by the app ([`docs/issues/475/future-improvements.md`](../../475/future-improvements.md) item 9 locks this — do not pre-build seam composition until a second plugin needs it). The bash-plugin `bindingResolver` composition point is **name-reserved only**; P3 must not implement it with governance as its lone consumer — governance keeps its app-spread wiring unchanged. Governance's server half is deliberately outside the plugin pipeline (`boring.server: false`) because policy load must complete before `createCoreWorkspaceAgentServer` (fail-closed boot).

The concrete providers themselves live in a separate package:

```txt
@hachej/boring-sandbox/providers
  direct, bwrap, vercel-sandbox, remote-worker, readonly, none  (concrete provider adapters)

@hachej/boring-sandbox/mounts
  FUSE-S3 mount drivers + per-session mount lifecycle (see TODO-X1;
  deployment tiers/providers/prereqs in 10-sandbox-deployment-eu.md)

@hachej/boring-sandbox/shared
  ProviderCapabilities (reported | unknown facts), provider contract types — the only provider-capability contract
```

No `@hachej/boring-agent` value import cycle is allowed (boring-sandbox imports agent **types only**; boring-bash imports boring-sandbox **values** + agent **types**).

## Runtime mode vs provider names

Do not collapse current runtime modes into provider names. Mode resolution (`resolveMode`) is boring-bash's; the provider a mode resolves to is `@hachej/boring-sandbox`'s.

| Current mode | Current sandbox provider | boring-sandbox provider | Notes |
| --- | --- | --- | --- |
| `direct` | `direct` | `direct` | Trusted host mode; no isolation. |
| `local` | `bwrap` | `bwrap` | Linux bubblewrap. Mode id differs from provider id. |
| `vercel-sandbox` | `vercel-sandbox` | `vercel-sandbox` | Remote sandbox. |
| remote-worker adapter | `remote-worker` | `remote-worker` | Client/mode and worker server split must stay explicit; worker handshake must declare capabilities. |
| pure/headless | none | none | No boring-bash. |
| readonly files | provider-specific | `readonly` facade | fs/search/watch without exec. |

## Provider capability matrix

Provider labels lie unless backed by capability facts. The authoritative `ProviderCapabilities` type lives in `@hachej/boring-sandbox/shared`; boring-bash may mirror those facts in environment summaries, but must not define a second provider-capability contract.

| Provider | FS | Exec | Real Bash | Real binaries | Network isolation | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `none` | none | no | no | no | n/a | Pure agent. |
| `readonly` | readonly | no | no | no | n/a | File UI/search only. |
| `direct` | readwrite | yes | host-dependent | host-dependent | none | Trusted dev/CI only. |
| `bwrap` | readwrite | yes | host-dependent | host-dependent | process/container-ish | Linux-only. |
| `vercel-sandbox` | readwrite | yes | yes | provider image | provider | Good sandbox-primary remote coding. |
| `remote-worker` | readwrite | yes | reported\|unknown | reported\|unknown | reported\|unknown | Worker-dependent fields are **reported facts from the worker handshake**, not static constants; provisioning adapter support requires widening current adapter mode union. |

**Worker-dependent capabilities are reported, not declared.** For `remote-worker`, every field whose truth depends on the worker (real bash, real binaries, network isolation, filesystem persistence, hardening) is typed `reported | unknown` and is populated **only** from the worker handshake — there is **no static constant** for these fields in the provider matrix. Until a handshake reports a field it is `unknown`, and **consumers fail closed on `unknown`** (a policy requiring a capability the worker has not proven is rejected, not assumed satisfied). Fixed providers (`direct`/`bwrap`/`vercel-sandbox`) keep their static matrix values; only worker-dependent fields are `reported | unknown`.

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
    // worker-dependent fields: reported facts from the handshake, `unknown` until reported; consumers fail closed on `unknown`.
    realBash?: boolean | 'unknown'
    realBinaries?: boolean | 'unknown'
    networkIsolation?: 'none' | 'process' | 'container' | 'microvm' | 'provider' | 'unknown'
    watch: boolean
    search: boolean
  }
}
```

For fixed providers these are static; for `remote-worker` the worker-dependent fields (`realBash`, `realBinaries`, `networkIsolation`, and any hardening/persistence facts) arrive only via the handshake and default to `unknown` — never a static constant, and `unknown` fails closed.

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

V1 decision: keep one public root by default for the normal private user workspace, but do **not** assume boring-bash has only one filesystem identity. V1 also supports named filesystem bindings where tools, routes, and UI identify resources as `(filesystem, path)`.

A binding may project another logical filesystem, for example `company_context`, into the active runtime using provider-declared mount/projection modes. The provider decides whether that binding materializes as a mount, backend adapter view, or other runtime handle. Path text does not select filesystem identity: `/company_context/x` is not a filesystem switch, and `company_context:/x` is not accepted as a path string.

For #416, PR1 only creates the tiny `@hachej/boring-bash` skeleton and binding contracts. It does not extract existing file/bash tools/routes/providers. Later PRs can use the binding model for readonly policy-filtered company projections and readwrite management projections without inventing a second storage-root resolver or a new sandbox type.

## Remote-worker split

Current code has a real split:

- client/protocol/mode code lives under `packages/agent/src/server/sandbox/remote-worker/*` and `packages/agent/src/server/runtime/modes/remote-worker.ts`;
- worker server code lives under `apps/full-app/src/server/worker/*`.

Extraction rule:

- shared protocol/types move to `boring-sandbox/shared`;
- client/provider adapter moves to `boring-sandbox/providers/remote-worker`;
- full-app worker server may move to `boring-sandbox/server/remote-worker` or stay app-owned, but it must depend only on shared protocol/provider server contracts, not on agent core.

Current `WorkspaceProvisioningAdapter.mode` is closed around existing modes. Supporting `remote-worker`, `readonly`, or `none` provisioning requires explicitly widening or short-circuiting that union.

## Tools to move or consciously assign

Current true inventory:

- `buildFilesystemAgentTools()` → `read`, `write`, `edit`, `find`, `grep`, `ls`;
- `buildHarnessAgentTools()` → `bash`, `execute_isolated_code`;
- `buildUploadAgentTools()` → upload/runtime artifact tools.
- bash/file tool renderers currently live in `packages/agent/src/front/toolRenderers.tsx` and `packages/agent/src/front/bareToolRenderers/`; the bash-owned renderer ids are `bash`, `read`, `write`, `edit`, `find`, `grep`, and `ls`.
- file composer providers currently live in the agent front (`packages/agent/src/front/useComposerPickers.ts`, `packages/agent/src/front/primitives/mention-picker.tsx`, `packages/agent/src/front/chatSubmit.ts`, and `packages/agent/src/front/chat/components/PiChatComposerSurface.tsx`) and call `/api/v1/files/search`, emit `@files: ...`, and upload through `/api/v1/files/upload`.

Move the tool bundles above to `boring-bash/agent` or document why a tool stays elsewhere.
Move the bash/file renderers and file composer providers with `boring-bash/plugin`. Pure-mode agent front keeps only generic tool-renderer plumbing/fallbacks and generic composer primitives; it registers no filesystem/bash renderer or file provider by default.

Ownership rule: `@hachej/boring-sandbox` defines **how code is confined** (provider adapters, lifecycle, capability facts, and the injected `Sandbox` contract). `@hachej/boring-bash` defines **what the model means by the filesystem and working environment** (the coherent namespace, `(filesystem, path)` binding semantics, file/search/watch/git routes, bash/file/upload tools, and file UI). Filesystem tools dispatch through binding operations; the `bash` tool executes through the injected `Sandbox` contract supplied by the resolved runtime bundle. `execute_isolated_code` stays in the bash tool bundle for DX because it is model-facing coding-environment affordance, but its actual isolation remains a sandbox provider capability.

Must preserve:

- `disableDefaultFileTools` behavior;
- readiness tags (`workspace-fs`, `sandbox-exec`, `runtime-dependencies`, `runtime:<id>`);
- model-facing stale-read/write safety;
- existing renderer behavior.

## File tree and document authority

### File tree data function (pluggable provider deferred to #295)

`boring-bash/plugin` factors tree data into a **plain internal tree function** (e.g. `loadFileTree(root, options)` returning the current tree shape) — not a pluggable `FileTreeDataProvider` boundary. A delta-streaming provider abstraction with a single implementation is forbidden by the "abstraction needs two real consumers" rule (`../INDEX.md`): #295 (Pierre Trees swap) is the only would-be second consumer and it is **not scheduled yet**.

The pluggable provider boundary (a `listTree`/`listPaths`/`subscribe` interface a replacement tree UI could implement) is **deferred until #295 is actually scheduled** — add it then, with Pierre Trees as the second real consumer. Until then the tree is one internal function; server routes are unaffected.

### Document-authority override (#367, #226) — DEFERRED out of this epic

**Deferral (binding):** this override has **zero real consumers** in #391 — no live document system (TipTap/Yjs/etc.) exists yet — so per the no-speculative-abstraction rule it is **not built in this epic**. It arrives with its first real authority implementation (#367/#226), filed as a post-epic follow-up (`../work/P4-file-ui/TODO.md` BBP4-013, `../work/P8-verification/TODO.md` BBP8-004). The target model, for when it lands: when a live document system owns a file, model-facing `write`/`edit` must be overridable:

- route through document coordinator;
- validate stale version/hash;
- avoid bypassing live collaborative state;
- fall back to raw file edit only when no document authority is active.

## UI plugin ownership

**Post-v1 ownership move.** V1 keeps this plugin workspace-owned and P3
BBP3-019 capability-gates its registration, renderers, providers, affordances,
and API calls from resolved filesystem facts. The move below is P4 and does not
gate P8.

Move `packages/workspace/src/plugins/filesystemPlugin/front/*` into `boring-bash/plugin` while preserving:

- panel ids;
- `workspace.open.path` surface resolver;
- file panel binding;
- agent file bridge/session-change integration;
- file tool renderers (`bash`, `read`, `write`, `edit`, `find`, `grep`, `ls`) through the existing `definePlugin({ toolRenderers })` field exported by `packages/workspace/src/plugin.ts` and defined/captured in `packages/workspace/src/shared/plugins/frontFactory.ts`;
- file mention/slash composer providers as capability-gated front-plugin contributions;
- the existing `/api/v1/files/*` route paths exactly during the move; no aliases.

The workspace bridge remains owned by `@hachej/boring-workspace`.

## Tests

- provider mode mapping test;
- one namespace/split-brain tests per provider;
- named filesystem binding tests for explicit `(filesystem, path)` identity;
- direct/local/vercel/remote-worker file+exec consistency;
- provider-declared projection/mount-mode tests;
- readonly fs without exec;
- `disableDefaultFileTools` parity;
- `execute_isolated_code` ownership/readiness;
- upload/download route ownership;
- file tree data returned by the plain internal tree function (provider boundary deferred to #295);
- document-authority write/edit override (**deferred out of this epic** — see BBP4-013; no test in #391);
- git/status source-of-truth consistency.
