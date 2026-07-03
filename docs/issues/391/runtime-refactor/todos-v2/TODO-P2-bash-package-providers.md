# TODO-BBP2 — Phase 2: move concrete bash providers into `@hachej/boring-bash`

Handoff: self-contained work order for one autonomous coding agent (pi or gpt-5.5-xhigh). Cite plan files by relative path. No prior conversation assumed.

## Context (read first)

- `docs/issues/391/runtime-refactor/02-boring-bash-environment.md` — package layers, provider capability matrix, mode↔provider mapping, remote-worker split rules.
- `docs/issues/391/runtime-refactor/06-migration-phases.md` — Phase 2 deliverables/exit; "Do not move providers until Phase 1 injection is complete."
- `docs/issues/391/runtime-refactor/00-global-isa.md` — invariant: `@hachej/boring-agent` has **zero value imports** from `@hachej/boring-bash`; provisioning-ownership rule.
- `docs/issues/391/runtime-refactor/todos/TODO-02-boring-bash-package-providers.md` — v1 beads BBA-020..025 (this supersedes for the provider-move slice).

### Already landed via issue #416 (do not redo, build on it)

- `packages/boring-bash/` exists (`@hachej/boring-bash@0.1.61`). `package.json` `exports` currently expose only `.`, `./shared`, `./server`.
- `packages/boring-bash/src/shared/index.ts` — filesystem-binding contracts: `FilesystemId`, `FilesystemAccess`, `FilesystemProjection`, `FilesystemBinding`, `BoundFilesystemContext`, `FilesystemBindingResolver`, `PreparedFilesystemBinding`, `FilesystemBindingProvider`, `RuntimeBindingPlan`. Shared is front-safe (no `node:*`, no `Buffer`).
- `packages/boring-bash/src/server/*` — `readonlyProjectionOperations.ts`, `managementProjectionOperations.ts`, `runtimeBindingManager.ts` (`ScopedFilesystemRuntimeBindingManager`, `filesystemRuntimeScopeKey`), `testing/companyContextFixtureProvider.ts` (`FixtureCompanyContextBindingProvider`, `COMPANY_CONTEXT_FILESYSTEM_ID`, `COMPANY_CONTEXT_SENTINEL`), `testing/readonlyProjectionConformance.ts` (`checkReadonlyProjectionConformance`). Conformance/leak tests under `src/server/__tests__/`.
- `packages/boring-bash/scripts/check-invariants.mjs` — asserts required exports `.`, `/shared`, `/server`; scans shared for `node:*`/`Buffer`; scans `packages/agent/src` for any `@hachej/boring-bash` **value** import; checks plan-doc wording. Wired into root `pnpm lint:invariants`.
- These contracts are consumed by downstream governance PRs (#476–#501). **Never break or re-shape them.**

### Provider/mode source inventory in `packages/agent` (Phase 2 move targets)

Sandbox implementations:
- `packages/agent/src/server/sandbox/direct/createDirectSandbox.ts` (+ `__tests__/createDirectSandbox.test.ts`, `directSandbox.conformance.test.ts`, `streaming-exec.test.ts`).
- `packages/agent/src/server/sandbox/bwrap/buildBwrapArgs.ts`, `createBwrapSandbox.ts` (+ `__tests__/` incl. `__snapshots__/buildBwrapArgs.test.ts.snap`, `bwrapSandbox.conformance.test.ts`).
- `packages/agent/src/server/sandbox/vercel-sandbox/*` — `FileHandleStore.ts`, `bake.ts`, `circuitBreaker.ts`, `createVercelSandboxExec.ts`, `deploymentSnapshot.ts`, `oidcRefresh.ts`, `packageTemplate.ts`, `periodicSnapshot.ts`, `provisioningAdapter.ts`, `readyStatus.ts`, `resolveSandboxHandle.ts` (+ `__tests__/`).
- `packages/agent/src/server/sandbox/remote-worker/createRemoteWorkerSandbox.ts`, `protocol.ts`, `workerClient.ts` (+ `__tests__/workerClient.test.ts`).
- `packages/agent/src/server/sandbox/snapshots/deploymentSnapshot.ts`; `packages/agent/src/server/sandbox/workspacePythonEnv.ts`.

Runtime mode adapters (map mode id → provider):
- `packages/agent/src/server/runtime/modes/direct.ts`, `local.ts`, `vercel-sandbox.ts`, `remote-worker.ts`, `provisioningAdapter.ts`.
- `packages/agent/src/server/runtime/resolveMode.ts` — `autoDetectMode()`, `hasBwrap()`, `resolveMode()` (builtin union `direct|local|vercel-sandbox`).
- `packages/agent/src/server/runtime/mode.ts` — **type-only** contracts (`RuntimeModeAdapter`, `RuntimeBundle`, `RuntimeBashStrategy`, `RuntimeFilesystemStrategy`, `RuntimeFilesystemBinding`, `getRuntimeBundleStorageRoot`). These stay agent-side per 00/06 until Phase 1 injection lands; only concrete adapters/`resolveMode()` move.

Workspace factories bound to providers:
- `packages/agent/src/server/workspace/createRemoteWorkerWorkspace.ts`, `createVercelSandboxWorkspace.ts`, `createNodeWorkspace.ts` (`getNodeWorkspaceHostRoot`).

Remote-worker server (app-owned today):
- `apps/full-app/src/server/worker/workspace.ts`, `config.ts`, `exec.ts`, `routes.ts`, `auth.ts`; `apps/full-app/src/server/agent-worker.ts`; smoke `apps/full-app/scripts/remote-worker-smoke.mjs`.

### Current public re-exports to treat as compatibility surface

`packages/agent/src/server/index.ts` re-exports (grep-verified): `createDirectSandbox`, `createBwrapSandbox` (+ `BwrapResourceLimits`, `CreateBwrapSandboxOptions`), `createRemoteWorkerModeAdapter` (+ `RemoteWorkerModeAdapterOptions`), `createRemoteWorkerWorkspace`, `createRemoteWorkerSandbox`, `RemoteWorkerClient`/`RemoteWorkerClientError`/`RemoteWorkerClientOptions`, remote-worker protocol types, `createVercelSandboxWorkspace`, `autoDetectMode`/`hasBwrap`/`resolveMode`, `RuntimeBundle` (type).

### Known importers of concrete providers (grep-verified — the migration set)

Value importers of `sandbox/{direct,bwrap,vercel-sandbox,remote-worker}`:
- `packages/agent/src/server/index.ts`
- `packages/agent/src/server/runtime/modes/{direct,local,vercel-sandbox,remote-worker}.ts`
- `packages/agent/src/server/workspace/createRemoteWorkerWorkspace.ts`

`resolveMode`/`autoDetectMode` importers:
- `packages/agent/src/server/createAgentApp.ts`, `registerAgentRoutes.ts`, `index.ts`, `bin/boring-agent.ts`
- `packages/workspace/src/app/server/createWorkspaceAgentServer.ts`
- `packages/cli/src/server/modeApps.ts`
- `packages/agent/src/front/chat/piChatPanelUtils.ts` (front — verify it only touches mode-id strings/types, not provider values)

## Goal / exit criteria

Concrete non-agent-loop providers (direct, bwrap, vercel-sandbox, remote-worker client) live under `@hachej/boring-bash/providers`, described by a capability matrix. Host/CLI/composition wires provider selection. Exit (from 06 Phase 2):

- `@hachej/boring-bash` builds; a new `/providers` subpath resolves.
- No agent→bash value import (invariant scan green).
- Current apps still compile after import migration or host-level shims.
- Landed #416 contracts unchanged; governance consumers keep working.
- `direct`/`local`/`vercel-sandbox` behavior + existing tests preserved.

## Non-negotiables

- **Precondition:** Phase 1 dependency injection (`createAgent()` / injected runtime+features; see 06 Phase 1 and the Phase-1 TODO) is complete before providers move. If not, STOP and report — do not move providers.
- `@hachej/boring-agent` keeps **zero value imports** from `@hachej/boring-bash`. Value flows one-way: host/CLI/composition imports both.
- Do not add value re-exports of moved providers from old agent paths (that re-creates the cycle). Type-only re-exports only where safe.
- Provisioning-ownership rule (00): provisioning engine + `ProvisionWorkspaceRuntimeOptions` stay agent-side over an injected adapter; boring-bash owns requirement normalizer + provider adapters.
- Preserve path-safety ownership: adapters validate containment; routes/tools never accept raw unchecked host paths.
- Preserve the mode-id vs provider-id distinction: `local` mode → `bwrap` provider (02 table).

## Do NOT

- Do not touch `/home/ubuntu/projects/boring-ui-v2`. Work only in this worktree.
- Do not commit.
- Do not re-shape or re-export the #416 shared binding contracts or server projection operations.
- Do not collapse mode ids into provider ids.
- Do not move routes/tools/UI (Phases 3/4 own those).

## Beads

### BBP2-001 — Add `/providers` subpath and provider capability contract [size S]

- **Files create:** `packages/boring-bash/src/providers/index.ts`; `packages/boring-bash/src/providers/capability.ts`.
- **Files touch:** `packages/boring-bash/package.json` (add `"./providers"` export → `dist/providers/index.js` + types); `packages/boring-bash/tsup.config.ts` (add entry); `packages/boring-bash/scripts/check-invariants.mjs` (add `"./providers"` to `requiredExports`).
- **Notes:** Define `ProviderCapabilities` mirroring 02's matrix: `fs: 'none'|'readonly'|'readwrite'`, `exec: boolean`, `realBash?`, `realBinaries?`, `networkIsolation?: 'none'|'process'|'container'|'microvm'|'provider'`, `watch: boolean`, `search: boolean`, plus `sourceOfTruth: 'sandbox-primary'|'storage-primary'`, `provisioningSupport: boolean`, `providerContractVersion: string`. Add stable error codes for unsupported-requirement and unsafe-fallback. Keep this file server/provider-scoped (may use `node:*`); it must NOT be reachable from `/shared`.
- **Tests:** export-map test imports `/providers`; invariant script passes with new subpath.
- **Acceptance:** `/providers` resolves and builds; capability type exists; invariants green.

### BBP2-002 — Provider capability matrix values + mode→provider mapping docs [size S]

- **Files create:** `packages/boring-bash/src/providers/matrix.ts` (per-provider `ProviderCapabilities` constants for `none`, `readonly`, `direct`, `bwrap`, `vercel-sandbox`, `remote-worker`); `packages/boring-bash/src/providers/README.md` (mode→provider table copied/linked from 02, incl. `local`→`bwrap`, pure→`none`, readonly facade).
- **Notes:** Values must match 02's matrix exactly; `remote-worker` marks fields `worker-dependent` (report via handshake, see BBP2-006).
- **Tests:** `packages/boring-bash/src/providers/__tests__/matrix.test.ts` — one assertion per provider row; assert `local`/`bwrap` distinction preserved; assert `none`/`readonly` have `exec:false`.
- **Acceptance:** hosts can decide provider-satisfies-requirement without guessing from a name.

### BBP2-003 — Move `direct` + `bwrap` sandbox providers [size M]

- **Files move:**
  - `packages/agent/src/server/sandbox/direct/createDirectSandbox.ts` → `packages/boring-bash/src/providers/direct/createDirectSandbox.ts` (+ its `__tests__/*`).
  - `packages/agent/src/server/sandbox/bwrap/buildBwrapArgs.ts` → `packages/boring-bash/src/providers/bwrap/buildBwrapArgs.ts`; `createBwrapSandbox.ts` → `packages/boring-bash/src/providers/bwrap/createBwrapSandbox.ts` (+ `__tests__/*` incl. snapshot).
  - `packages/agent/src/server/sandbox/workspacePythonEnv.ts` and `sandbox/snapshots/deploymentSnapshot.ts` → move if imported only by moved providers; otherwise leave and import via type-only/shared seam (verify with grep before moving).
- **Files touch:** `packages/boring-bash/src/providers/index.ts` (re-export `createDirectSandbox`, `createBwrapSandbox` + option/limit types). The `Sandbox` interface these implement lives in `packages/agent/src/server/shared/sandbox` — import it **type-only** into boring-bash (allowed; only value imports are forbidden by the invariant; but prefer relocating the `Sandbox` type to `boring-bash/shared` if it has no agent-value deps — investigate and note decision).
- **Notes:** Keep behavior byte-identical; only change import paths. Adapters keep owning path containment.
- **Tests:** moved conformance tests pass in boring-bash (`pnpm --filter @hachej/boring-bash run test`).
- **Acceptance:** direct/bwrap providers build+test under boring-bash; no behavior change.

### BBP2-004 — Move `vercel-sandbox` provider [size L]

- **Files move:** all of `packages/agent/src/server/sandbox/vercel-sandbox/*` → `packages/boring-bash/src/providers/vercel-sandbox/*` (incl. `provisioningAdapter.ts`, `bake.ts`, `oidcRefresh.ts`, `circuitBreaker.ts`, `FileHandleStore.ts`, `deploymentSnapshot.ts`, `packageTemplate.ts`, `periodicSnapshot.ts`, `readyStatus.ts`, `resolveSandboxHandle.ts`, `createVercelSandboxExec.ts`, + `__tests__/*`).
- **Notes:** `provisioningAdapter.ts` here is a **provider adapter** (allowed to move) — distinct from the agent-owned provisioning engine (00 rule). Verify no agent-engine value import remains; if `deploymentSnapshot`/`readyStatus` are shared with agent, split shared types to `boring-bash/shared` or keep a type-only seam.
- **Files touch:** `packages/boring-bash/src/providers/index.ts`; `packages/agent/src/server/workspace/createVercelSandboxWorkspace.ts` (repoint imports to `@hachej/boring-bash/providers`).
- **Tests:** vercel-sandbox unit tests pass under boring-bash; `createVercelSandboxWorkspace` still typechecks.
- **Acceptance:** vercel-sandbox provider owned by boring-bash; workspace factory repointed.

### BBP2-005 — Move concrete runtime mode adapters + `resolveMode()` to host/boring-bash composition [size M]

- **Files move:** `packages/agent/src/server/runtime/modes/{direct,local,vercel-sandbox,remote-worker,provisioningAdapter}.ts` and `runtime/resolveMode.ts` → `packages/boring-bash/src/providers/modes/*` (keep filenames). Move `runtime/modes/__tests__/*` and `runtime/__tests__/resolveMode.test.ts` with them.
- **Files keep (agent, type-only):** `packages/agent/src/server/runtime/mode.ts` stays — it is type-only contracts (`RuntimeModeAdapter`, `RuntimeBundle`). boring-bash mode adapters import these **type-only** from `@hachej/boring-agent/server` (allowed).
- **Files touch (repoint `resolveMode`/`autoDetectMode` value imports):** `packages/agent/src/server/createAgentApp.ts`, `registerAgentRoutes.ts`, `index.ts`, `bin/boring-agent.ts`, `packages/workspace/src/app/server/createWorkspaceAgentServer.ts`, `packages/cli/src/server/modeApps.ts`. These are host/composition/CLI layers → they may import `@hachej/boring-bash/providers` directly. For `packages/agent/*` callers that must stay bash-free (createAgentApp/registerAgentRoutes are the Fastify adapter layer): inject the resolved adapter from the host instead of importing `resolveMode` — confirm against the Phase-1 injection seam; if injection is not yet threaded there, leave a host-level shim and note it.
- **Notes:** `none`/`readonly` must short-circuit the closed provisioning-adapter mode union rather than throw (02 remote-worker split note).
- **Tests:** moved `resolveMode.test.ts` passes; `pnpm --filter @hachej/boring-agent run test` green; mode/provider mapping test (BBP2-002) covers every current pair.
- **Acceptance:** concrete adapters + `resolveMode()` live in boring-bash/host; agent keeps only type-only mode contracts.

### BBP2-006 — Split remote-worker: shared protocol → shared, client → providers, server path decision [size M]

- **Files move:** `packages/agent/src/server/sandbox/remote-worker/protocol.ts` → `packages/boring-bash/src/shared/remoteWorkerProtocol.ts` (front-safe: no `node:*`/`Buffer`; convert bytes to `Uint8Array` if any). `workerClient.ts` + `createRemoteWorkerSandbox.ts` → `packages/boring-bash/src/providers/remote-worker/*` (+ `__tests__/workerClient.test.ts`). `packages/agent/src/server/workspace/createRemoteWorkerWorkspace.ts` → `packages/boring-bash/src/providers/remote-worker/createRemoteWorkerWorkspace.ts`.
- **Files touch:** `packages/boring-bash/src/shared/index.ts` (export protocol types); `packages/boring-bash/src/providers/index.ts` (export client/adapter). `apps/full-app/src/server/worker/*` + `agent-worker.ts`: repoint protocol import to `@hachej/boring-bash/shared`. **Decision to record in `providers/remote-worker/README.md`:** worker server stays app-owned (recommended, least churn) but imports only shared protocol + provider server contracts — never agent core. Add handshake reporting the capability matrix (BBP2-002 `remote-worker` row) + hardening facts; reject unknown/missing contract version with a stable error; fail closed on missing source-of-truth/hardening claims.
- **Tests:** protocol compat unit test; handshake reports matrix + rejects bad version; static check `apps/full-app/src/server/worker/*` import graph has no agent-core dep.
- **Acceptance:** remote-worker provided by boring-bash without coupling worker server to agent core.

### BBP2-007 — Compatibility shims + import-migration enumeration [size M]

- **Notes / strategy (enumerate before deleting anything):**
  - **Type-only re-export from old agent paths (safe):** `RuntimeBundle` and other `mode.ts` types stay agent-exported (unchanged). Provider *types* (e.g. `CreateBwrapSandboxOptions`, `RemoteWorkerClientOptions`, protocol types) may be re-exported `export type { … } from '@hachej/boring-bash/...'` in `packages/agent/src/server/index.ts` **only if** they introduce no runtime import.
  - **Must migrate imports (value):** every value re-export listed under "Current public re-exports" (`createDirectSandbox`, `createBwrapSandbox`, `createRemoteWorker*`, `createVercelSandboxWorkspace`, `resolveMode`/`autoDetectMode`/`hasBwrap`). Remove these value exports from `packages/agent/src/server/index.ts`; move them to a host/composition barrel (recommend `packages/cli` and `apps/full-app` composition, or a new `@hachej/boring-*` host barrel that already depends on both). Do NOT re-export them from agent.
  - **Enumerate real external importers:** run `grep -rn "from '@hachej/boring-agent/server'" packages apps plugins` and record which pull the moved value symbols; migrate each to `@hachej/boring-bash/providers`.
- **Files touch:** `packages/agent/src/server/index.ts`; downstream importers found by grep; add migration notes to `packages/boring-bash/src/providers/README.md` with before/after snippets for direct/local/vercel/remote-worker + readonly/none.
- **Tests:** static test (extend `scripts/check-invariants.mjs` or `scripts/audit-imports.ts`) proving agent old paths have no boring-bash **value** import; apps compile after migration; sample using new imports typechecks.
- **Acceptance:** no package cycle, no silent public-API break — users get working host-level compat or a clear migration diagnostic.

### BBP2-008 — Extend `scripts/check-invariants.mjs` for the provider boundary [size S]

- **Files touch:** `packages/boring-bash/scripts/check-invariants.mjs`.
- **Notes:** Add checks: (a) `requiredExports` includes `"./providers"`; (b) `packages/boring-bash/src/providers/**` is not imported by `src/shared/**` (providers may use `node:*`; shared may not); (c) the existing agent→bash value-import scan still passes post-move; (d) optionally assert `packages/agent/src/server/index.ts` contains no value export of the moved provider symbols (regex allowlist). Keep existing checks intact.
- **Tests:** `pnpm --filter @hachej/boring-bash run check:invariants` passes; deliberately introducing an agent→bash value import fails it (manual spot check, revert).
- **Acceptance:** invariants guard the new provider boundary; `pnpm lint:invariants` (root) stays green.

## Verification — exact commands verified against package.json scripts

```bash
# boring-bash package (scripts confirmed in packages/boring-bash/package.json)
pnpm --filter @hachej/boring-bash run build
pnpm --filter @hachej/boring-bash run typecheck
pnpm --filter @hachej/boring-bash run check:invariants
pnpm --filter @hachej/boring-bash run test

# agent still builds/tests after provider move + import migration
pnpm --filter @hachej/boring-agent run build
pnpm --filter @hachej/boring-agent run typecheck
pnpm --filter @hachej/boring-agent run test
pnpm --filter @hachej/boring-agent run lint:invariants   # bash ../../scripts/check-invariants.sh .
pnpm --filter @hachej/boring-agent run check:isolation

# repo-wide boundary + cycle guards (root package.json)
pnpm lint:invariants        # agent + boring-bash + workspace-plugin invariants
pnpm audit:imports          # tsx scripts/audit-imports.ts
pnpm typecheck              # build:packages then per-pkg typecheck
```

## Review gates

- Phase 1 injection precondition confirmed (or STOP+report).
- `pnpm lint:invariants` + `pnpm audit:imports` green; zero agent→bash value imports.
- #416 shared contracts / server projection ops / conformance+leak tests unchanged and passing.
- Every moved provider carries its tests; direct/local/vercel-sandbox behavior unchanged.
- Public value re-exports either migrated or host-shimmed with a documented migration note; no re-export creates a cycle.
- Mode-id vs provider-id distinction preserved (`local`→`bwrap`).
