# TODO-P2 — Move concrete bash providers into `@hachej/boring-bash`

Handoff: self-contained work order for one autonomous coding agent (pi or gpt-5.5-xhigh). Cite plan files by relative path. No prior conversation assumed.

## Context (read first)

- `docs/issues/391/runtime-refactor/02-boring-bash-environment.md` — package layers, provider capability matrix, mode↔provider mapping, remote-worker split rules.
- `docs/issues/391/runtime-refactor/06-migration-phases.md` — Phase 2 deliverables/exit; "Do not move providers until Phase 1 injection is complete."
- `docs/issues/391/runtime-refactor/00-global-isa.md` — invariant: `@hachej/boring-agent` has **zero value imports** from `@hachej/boring-bash`; provisioning-ownership rule.

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
- Current apps still compile after same-PR importer migration (no old-path re-export, no host shim).
- Landed #416 contracts unchanged; governance consumers keep working.
- `direct`/`local`/`vercel-sandbox` behavior + existing tests preserved.

### This phase is the runtime-mode composition cutover (API-breaking for in-repo composers — the FIRST break)

P2 is where composition **first breaks and gets rewired** — it is the earlier of the two named cutovers (P2 = runtime-mode; P3 = routes/tools). P1 held an end-to-end compatibility promise ("all current HTTP consumers unchanged"), but **that promise ends at P2**: moving the concrete mode adapters + `resolveMode()` out of `packages/agent` means every in-repo composer that resolved a runtime mode must now **inject the resolved runtime adapter** (host-side) instead of importing `resolveMode`, and the agent bin becomes pure-only. External HTTP *callers* still see byte-identical route paths/behavior; the break is in the **composition API**, not the wire surface. **No text may claim the first composition break waits until P3.**

P2 therefore **enumerates and migrates EVERY in-repo composition consumer** — **each relocation slice migrates ALL importers for that slice, deletes the origin exports, and merges atomically after its gates pass** (a slice = one provider family; there are **no shims between slices**) — re-verifying behavior parity after each slice:

- `packages/agent/src/server/createAgentApp.ts` + `registerAgentRoutes.ts` — the Fastify adapter layer takes the resolved runtime adapter **by injection** (Phase-1 seam) instead of importing `resolveMode`; if that seam is not threaded, STOP and report the missing P1 deliverable (do not shim).
- `packages/cli/src/server/modeApps.ts` — imports `@hachej/boring-bash/providers` and resolves the mode host-side (and **now owns the bash-enabled dev-server bin composition** moved from the agent bin — see BBP2-005 / fix 6).
- `packages/workspace/src/app/server/createWorkspaceAgentServer.ts` — same host-side `@hachej/boring-bash/providers` resolution.
- `packages/agent/src/bin/boring-agent.ts` — becomes **pure-only** (`runtime: 'none'`, no `--mode`, no provider, no `resolveMode`); its bash-enabled composition moves to `packages/cli` in this same PR.
- `packages/agent/src/server/index.ts` — origin value exports of the moved providers/`resolveMode` are **deleted** (BBP2-007), no old-path re-export.

**Exit re-verifies parity post-migration:** after each consumer is migrated, its previously-green behavior (dev server, workspace/CLI/full-app boot, `direct`/`local`/`vercel-sandbox` modes, existing tests + e2e) must pass unchanged. A consumer is "done" only when its migration PR is merged AND its parity checks are re-run green post-cutover.

## Non-negotiables

- **Precondition:** Phase 1 dependency injection (`createAgent()` / injected runtime+features; see 06 Phase 1 and the Phase-1 TODO) is complete before providers move. If not, STOP and report — do not move providers.
- `@hachej/boring-agent` keeps **zero value imports** from `@hachej/boring-bash`. Value flows one-way: host/CLI/composition imports both.
- Do not add re-exports of moved providers from old agent paths — **neither value nor type-only** (value re-exports re-create the cycle; any old-path re-export violates the no-compat policy). Every importer migrates in the same PR; the origin export is deleted in that PR.
- Provisioning-ownership rule (00): provisioning engine + `ProvisionWorkspaceRuntimeOptions` stay agent-side over an injected adapter; boring-bash owns requirement normalizer + provider adapters.
- Preserve path-safety ownership: adapters validate containment; routes/tools never accept raw unchecked host paths.
- Preserve the mode-id vs provider-id distinction: `local` mode → `bwrap` provider (02 table).

## Do NOT

- Do not touch `/home/ubuntu/projects/boring-ui-v2`. Work only in this worktree.
- Work on a dedicated branch/worktree per the PR-PLAN branch naming; never commit to main directly; every bead lands as a PR per todos-v2/README.
- Do not re-shape or re-export the #416 shared binding contracts or server projection operations.
- Do not collapse mode ids into provider ids.
- Do not move routes/tools/UI (Phases 3/4 own those).

## Beads

### BBP2-001 — Add `/providers` subpath and provider capability contract [size S]

- **Files create:** `packages/boring-bash/src/providers/index.ts`; `packages/boring-bash/src/providers/capability.ts`.
- **Files touch:** `packages/boring-bash/package.json` (add `"./providers"` export → `dist/providers/index.js` + types); `packages/boring-bash/tsup.config.ts` (add entry); `packages/boring-bash/scripts/check-invariants.mjs` (add `"./providers"` to `requiredExports`).
- **Notes:** Define `ProviderCapabilities` mirroring 02's matrix: `fs: 'none'|'readonly'|'readwrite'`, `exec: boolean`, `realBash?`, `realBinaries?`, `networkIsolation?: 'none'|'process'|'container'|'microvm'|'provider'`, `watch: boolean`, `search: boolean`, plus `sourceOfTruth: 'sandbox-primary'|'storage-primary'`, `provisioningSupport: boolean`, `providerContractVersion: string`. **Worker-dependent fields are typed `reported | 'unknown'`** (02 "Worker-dependent capabilities are reported, not declared"): `realBash?: boolean | 'unknown'`, `realBinaries?: boolean | 'unknown'`, `networkIsolation?: <enum> | 'unknown'` (+ any hardening/persistence facts). For fixed providers these hold concrete values; for `remote-worker` they default to `'unknown'` in P2 and are populated **only from the P5 handshake (`TODO-P5` BBP5-008, the sole handshake owner)** — P2 implements no handshake. Define stable error codes for unsupported-requirement and unsafe-fallback, **including a fail-closed error code for when a required capability is `'unknown'`** (the code/type is declared here; the runtime validation that raises it lives in BBP5-008). Keep this file server/provider-scoped (may use `node:*`); it must NOT be reachable from `/shared`.
- **Tests:** export-map test imports `/providers`; invariant script passes with new subpath.
- **Acceptance:** `/providers` resolves and builds; capability type exists; invariants green.

### BBP2-002 — Provider capability matrix values + mode→provider mapping docs [size S]

- **Files create:** `packages/boring-bash/src/providers/matrix.ts` (per-provider `ProviderCapabilities` constants for `none`, `readonly`, `direct`, `bwrap`, `vercel-sandbox` — the **fixed** providers); `packages/boring-bash/src/providers/README.md` (mode→provider table copied/linked from 02, incl. `local`→`bwrap`, pure→`none`, readonly facade).
- **Notes:** Values must match 02's matrix exactly for the fixed providers. **`remote-worker` gets NO static constant for its worker-dependent fields** — those stay `'unknown'` in P2 (the handshake that reports them is **owned solely by `TODO-P5-provisioning-secrets.md` BBP5-008**, NOT P2), and **consumers fail closed on `'unknown'`** (a policy requiring an unproven capability is rejected, not assumed). This bead only defines the matrix TYPE + the `'unknown'` typing; the runtime handshake and its fail-closed validation land in BBP5-008. Provide only `remote-worker`'s non-worker-dependent fixed fields (e.g. `fs: 'readwrite'`, `exec: true`) as a partial base; the rest come from the BBP5-008 handshake at runtime.
- **Tests:** `packages/boring-bash/src/providers/__tests__/matrix.test.ts` — one assertion per fixed provider row; assert `local`/`bwrap` distinction preserved; assert `none`/`readonly` have `exec:false`; assert `remote-worker` worker-dependent fields are `'unknown'` in the static matrix (no baked constant). **P2 keeps only the matrix-typing + `'unknown'` assertions.** The "a policy needing worker-dependent fields fails closed" test is owned by **`TODO-P5` BBP5-008 (the sole handshake owner)** — do NOT place it here.
- **Acceptance:** hosts can decide provider-satisfies-requirement without guessing from a name; worker-dependent capability is a reported fact, never a static constant (the fail-closed-on-`'unknown'` runtime validation and its test are owned by BBP5-008, not P2).

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
- **Files touch (repoint `resolveMode`/`autoDetectMode` value imports):** `packages/agent/src/server/createAgentApp.ts`, `registerAgentRoutes.ts`, `index.ts`, `packages/workspace/src/app/server/createWorkspaceAgentServer.ts`, `packages/cli/src/server/modeApps.ts`. These are host/composition/CLI layers → they may import `@hachej/boring-bash/providers` directly. For `packages/agent/*` callers that must stay bash-free (createAgentApp/registerAgentRoutes are the Fastify adapter layer): inject the resolved adapter from the host instead of importing `resolveMode` — confirm against the Phase-1 injection seam; if injection is not yet threaded there, **STOP and report the missing P1 seam** (do not leave a shim — the seam is a P1 deliverable, not something P2 patches around).
- **Agent bin decision (resolved in THIS same P2 PR — the bin cannot survive P2 unchanged):** the `packages/agent` bin (`packages/agent/src/bin/boring-agent.ts`) today composes a bash-enabled dev server via `createAgentApp({ mode: 'direct', ... })`, which after this move would force the agent bin to resolve a mode → pull `@hachej/boring-bash/providers` (an agent→bash value import — forbidden). Resolution: **the agent bin becomes PURE-ONLY — it composes `runtime: 'none'` (no `mode`, no provider, no `resolveMode`)**, keeping agent value-import-free. Its **bash-enabled composition (the `--mode`/`direct` dev-server + provider wiring) MOVES to `packages/cli`** (the CLI is a host/composition layer allowed to import `@hachej/boring-bash/providers`) in this same PR. Any E2E helper that needs a bash-backed backend targets the CLI-owned entry point, not the agent bin. Remove the `RuntimeModeId`/`--mode` handling from the agent bin.
- **Notes:** `none`/`readonly` must short-circuit the closed provisioning-adapter mode union rather than throw (02 remote-worker split note).
- **Tests:** moved `resolveMode.test.ts` passes; `pnpm --filter @hachej/boring-agent run test` green; mode/provider mapping test (BBP2-002) covers every current pair; the agent bin composes `runtime: 'none'` and has zero `@hachej/boring-bash` import (invariant scan); the migrated CLI-owned bash dev-server entry starts a `direct`-mode backend for E2E.
- **Acceptance:** concrete adapters + `resolveMode()` live in boring-bash/host; agent keeps only type-only mode contracts; the agent bin is pure-only (`runtime: 'none'`) and its bash-enabled composition now lives in `packages/cli`.

### BBP2-006 — Split remote-worker: shared protocol → shared, client → providers, server path decision [size M]

- **Files move:** `packages/agent/src/server/sandbox/remote-worker/protocol.ts` → `packages/boring-bash/src/shared/remoteWorkerProtocol.ts` (front-safe: no `node:*`/`Buffer`; convert bytes to `Uint8Array` if any). `workerClient.ts` + `createRemoteWorkerSandbox.ts` → `packages/boring-bash/src/providers/remote-worker/*` (+ `__tests__/workerClient.test.ts`). `packages/agent/src/server/workspace/createRemoteWorkerWorkspace.ts` → `packages/boring-bash/src/providers/remote-worker/createRemoteWorkerWorkspace.ts`.
- **Files touch:** `packages/boring-bash/src/shared/index.ts` (export protocol types); `packages/boring-bash/src/providers/index.ts` (export client/adapter). `apps/full-app/src/server/worker/*` + `agent-worker.ts`: repoint protocol import to `@hachej/boring-bash/shared`. **Decision to record in `providers/remote-worker/README.md`:** worker server stays app-owned (recommended, least churn) but imports only shared protocol + provider server contracts — never agent core.
- **P2 MOVES CODE ONLY — no handshake here.** This bead relocates protocol → shared, client/adapter → providers, and repoints imports. It does **NOT** implement the capability handshake, does **NOT** add "reject unknown/missing contract version" logic, and does **NOT** add fail-closed hardening validation. The remote-worker's worker-dependent capability facts stay `'unknown'` after P2 (per BBP2-002; the existing hardcoded `client.health()`/`capabilities:['exec']` behavior is carried over unchanged, only moved). **`TODO-P5-provisioning-secrets.md` BBP5-008 is the SOLE owner of the real handshake, the reported hardening facts, "reject unknown/missing contract version", and all fail-closed validation** — see it for the report/consume implementation. Do not pre-implement any of that in P2.
- **Tests:** protocol compat unit test (bytes round-trip after the move); static check `apps/full-app/src/server/worker/*` import graph has no agent-core dep. **No handshake test here** — the handshake reports/rejects/fail-closed tests belong to BBP5-008.
- **Acceptance:** remote-worker protocol/client/adapter provided by boring-bash without coupling the worker server to agent core; worker-dependent capabilities remain `'unknown'` (handshake deferred to BBP5-008); no handshake or fail-closed logic added in P2.

### BBP2-007 — Migrate importers + delete origin exports (no compat shims) [size M]

- **Policy (binding — `todos-v2/README.md` "Simplicity & no-compat policy"):** all `@hachej/*` consumers are in-repo, so there is **no** old-path re-export of any kind — **not even type-only**. Every importer migrates to the new path in the **same PR** that moves the provider, and the origin export is deleted in that same PR. Grep is the migration tool; no re-export stub, no host shim that outlives the phase.
- **Notes / strategy (enumerate, migrate, delete):**
  - **Delete the origin value exports:** remove every value re-export listed under "Current public re-exports" (`createDirectSandbox`, `createBwrapSandbox`, `createRemoteWorker*`, `createVercelSandboxWorkspace`, `resolveMode`/`autoDetectMode`/`hasBwrap`) from `packages/agent/src/server/index.ts`. Do NOT replace them with a re-export from `@hachej/boring-bash` (that re-creates the cycle *and* violates the no-compat policy). Provider *types* (`CreateBwrapSandboxOptions`, `RemoteWorkerClientOptions`, protocol types, etc.) are likewise **not** re-exported from agent — consumers import them from `@hachej/boring-bash/providers`/`/shared` directly. `RuntimeBundle` and the other `mode.ts` **type-only** contracts stay agent-owned because they never moved (they are agent's own types, not a re-export of a moved thing).
  - **Migrate every importer in the same PR:** the grep-verified importer set is under "Known importers of concrete providers" above (value importers of `sandbox/{direct,bwrap,vercel-sandbox,remote-worker}` and `resolveMode`/`autoDetectMode` importers). Re-run `grep -rn "from '@hachej/boring-agent/server'" packages apps plugins` to catch any that pull the deleted value symbols, and repoint each to `@hachej/boring-bash/providers`. Host/CLI/composition layers (`packages/cli`, `apps/full-app`, `packages/workspace/*/server`) import `@hachej/boring-bash/providers` directly; the Fastify adapter layer (`createAgentApp`/`registerAgentRoutes`) takes the resolved adapter by injection (Phase-1 seam) rather than importing `resolveMode`.
- **Files touch:** `packages/agent/src/server/index.ts` (delete the moved value exports); every downstream importer in the grep-verified set; add migration notes to `packages/boring-bash/src/providers/README.md` with before/after snippets for direct/local/vercel/remote-worker + readonly/none.
- **Tests:** static test (extend `scripts/check-invariants.mjs` or `scripts/audit-imports.ts`) proving agent old paths have no boring-bash **value** import and no re-export of the moved symbols; apps compile after migration; sample using new imports typechecks.
- **Acceptance:** no package cycle, no old-path re-export (value or type), every importer migrated in-PR; a build fails only if a caller was missed (surfaced as a clear unresolved-import error), never silently shimmed.

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
- Every importer of the moved value symbols migrated in the same PR and the origin exports deleted; no old-path re-export (value or type), no host shim, no cycle.
- Mode-id vs provider-id distinction preserved (`local`→`bwrap`).
