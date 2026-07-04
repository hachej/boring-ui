# TODO-E1 — Environment registry and attachments (generalize the #416 binding model)

Handoff: self-contained work order for one autonomous coding agent (pi or gpt-5.5-xhigh). Cite plan files by relative path. No prior conversation assumed.

## Context (read first)

- Plan: `docs/issues/391/runtime-refactor/09-environments-attachable.md` (the target model — read in full).
- Plan: `docs/issues/391/runtime-refactor/06-migration-phases.md` § "Phase E1" (deliverables + exit criteria) and § "Rules" (rule 4: #416 landed contracts must not be redone).
- Plan: `docs/issues/391/runtime-refactor/08-pluggable-agent-surfaces.md` § "Multi-filesystem contract intersection" and § "Two handles".
- Landed #416 contracts you generalize (do not rewrite):
  - `packages/boring-bash/src/shared/index.ts` — `FilesystemId`, `FilesystemAccess`, `FilesystemBinding`, `BoundFilesystemContext`, `FilesystemBindingResolver`, `PreparedFilesystemBinding`, `FilesystemBindingProvider`, `RuntimeBindingPlan`.
  - `packages/boring-bash/src/server/runtimeBindingManager.ts` — `ScopedFilesystemRuntimeBindingManager`, `filesystemRuntimeScopeKey(ctx)`, `ScopedRuntimeBindingPlan`, `ScopedPreparedFilesystemBinding`, `PreparedBindingSelector`. The scope key today joins `humanUserId\0agentId\0sessionId\0workspaceId\0requestId` — `agentId` is already in the key, so per-agent/per-subagent attachment needs no new key field.
  - `packages/boring-bash/src/server/readonlyProjectionOperations.ts` — `createReadonlyProjectionOperations(handle)`, `ReadonlyProjectionOperations`, `ReadonlyProjectionHandle {filesystem, projectionRoot}`. Note `assertInsideProjection` already jails every op to `projectionRoot` — the scoped-view subpath jail rides this.
  - `packages/boring-bash/src/server/testing/readonlyProjectionConformance.ts` — `checkReadonlyProjectionConformance(subject)`, `ReadonlyProjectionConformanceSubject`.
  - `packages/boring-bash/src/server/testing/companyContextFixtureProvider.ts` — `FixtureCompanyContextBindingProvider`, `COMPANY_CONTEXT_FILESYSTEM_ID = "company_context"`, `COMPANY_CONTEXT_SENTINEL`.
  - Exports barrels: `packages/boring-bash/src/server/index.ts`, package exports `.`/`./shared`/`./server` in `packages/boring-bash/package.json`.
- Agent-core injection surface (type-only for the core): `packages/agent/src/server/runtime/mode.ts` — `RuntimeBundle.filesystemBindings?: RuntimeFilesystemBinding[]`, `RuntimeFilesystemBinding {filesystem, access, operations}`, `RuntimeFilesystemBindingOperations`. This is the seam the agent already consumes; `ResolvedEnvironments` must reduce to this shape so the core is unchanged.
- Invariant scripts you must extend: `packages/boring-bash/scripts/check-invariants.mjs` (checks required exports `.`/`./shared`/`./server`); repo value-import audit `scripts/audit-imports.ts` (run via `pnpm audit:imports`); agent-side invariant tests `packages/agent/src/__tests__/invariants.test.ts` + `packages/agent/src/__tests__/invariants-script.test.ts`.
- Governance PRs (#476–#501, the #475 line) consume the landed shapes above. This bead is **additive/adapter only** — a governance consumer that imports `FilesystemBinding`/`FilesystemBindingResolver`/`ScopedFilesystemRuntimeBindingManager` must keep compiling and passing with zero source edits.

**Depends on: Phase 2 AND Phase 3.** E1 runs after both (06 Phase E1 header, and the README dep table lists `P2, P3`). Rationale: P3 creates the `createBashAgentFeature()` bundle; **E1 may re-implement that bundle's internals over environment attachments without changing its public `{ tools, readinessRequirements }` signature**. E1 does not fork the bundle API — it generalizes what backs it.

Verified reality check (do not assume otherwise):
- `createBashAgentFeature()` does **not** exist yet — it is a Phase 3 name in the plan. E1 introduces the environment contracts and the attachment→`RuntimeFilesystemBinding[]` reduction; wiring the public bundle (`{ tools, readinessRequirements }`, spread into `createAgent()`'s `tools`) is Phase 3's job — there is no `features` registry. Provide the reduction function and a thin `attachEnvironments()` helper, not a full feature system.
- Subagents are **not** a first-class code path in `packages/agent` today. A repo-wide search finds only a `pi-subagent` renderer key in `packages/agent/src/shared/tool-ui.ts`; there is no subagent/task tool, no `spawnSubagent`, no child-session attach seam in `packages/agent/src/server`. Encode the seam as a **new explicit contract**, not a modification of existing subagent plumbing (there is none).

## Goal / exit criteria

Match `06-migration-phases.md` Phase E1 exit criteria:
1. Existing workspace + `company_context` behavior unchanged; governance consumers green (no edits to landed shapes).
2. A **scoped view** (`scope.subpath`) of an environment is attachable and physically jailed (BBE1-004/007). (The subagent-specific consumer of scoped views is deferred to Phase 7 — see the "Deferred to Phase 7" section.)
3. An agent can hold **two environments** with distinct `filesystem` identities simultaneously.
4. Agent core sees `ResolvedEnvironments` **type-only** (invariant-checked — no value import).
5. Scoped-view no-leak conformance passes as a new mount of the existing suite.

## Non-negotiables

- Generalize, do not replace. New `Environment`/`EnvironmentAttachment`/`EnvironmentRegistry`/`ResolvedEnvironments` types wrap the landed shapes. `EnvironmentAttachment.filesystem`/`access` are the existing `FilesystemId`/`FilesystemAccess`. `company_context` becomes the **reference** environment + a readonly attachment via an adapter over `FixtureCompanyContextBindingProvider` — not a rewrite of the fixture provider.
- Scoped views (`scope.subpath`) enforced **by the environment host** (physical projection root = `join(projectionRoot, subpath)`, reusing `ReadonlyProjectionHandle` jailing), never by consumer-side path filtering. `09` security invariant 2.
- `execPolicy` default is `'none'` for any non-`user` attachment (`09` security invariant 4). Readonly/`company_context` attachments never carry exec.
- The registry lives in `boring-bash/server`. The agent core imports `ResolvedEnvironments` **type-only** from `@hachej/boring-bash/shared`.
- Attachment is the only coupling: no implicit cwd inheritance for subagents. A subagent gets an environment only by an explicit `EnvironmentAttachment`.

## Do NOT

- Do NOT edit `FilesystemBinding`, `FilesystemBindingResolver`, `ScopedFilesystemRuntimeBindingManager`, the projection operations, or the conformance subject signatures. Wrap them.
- Do NOT add a value import of `@hachej/boring-bash` into `packages/agent` (the audit forbids it).
- Do NOT build the Phase 3 `createBashAgentFeature()` public API or move routes/tools. Stop at the reduction + registry + scoped-view enforcement.
- Do NOT invent a new scope key field; `agentId` already discriminates.
- Do NOT touch `/home/ubuntu/projects/boring-ui-v2`. Do NOT commit.

## Beads

### BBE1-001 — Environment/attachment contracts in `boring-bash/shared` (S)
- Description: Add the `09` contracts as type-only shapes generalizing #416.
- Files: create `packages/boring-bash/src/shared/environment.ts`; re-export from `packages/boring-bash/src/shared/index.ts`.
- Notes: Define `Environment { id: string; provider: string; capabilities: EnvironmentCapabilities; }` where `EnvironmentCapabilities { fs: FilesystemAccess | 'none'; exec: boolean; watch?: boolean; search?: boolean; networkIsolation?: boolean }`; `EnvironmentAttachment { environmentId: string; filesystem: FilesystemId; access: FilesystemAccess; scope?: { subpath?: string }; execPolicy: 'none' | 'attached' }`; `PreparedEnvironmentAttachment extends EnvironmentAttachment { handle: unknown }`; `ResolvedEnvironments { attachments: PreparedEnvironmentAttachment[] }`. Keep purely structural — reuse `FilesystemId`/`FilesystemAccess` from `./index`.
- Tests: type-only; covered by BBE1-006 build/typecheck. Add a `.test-d`-style compile assertion in `packages/boring-bash/src/shared/__tests__/environment.types.test.ts` that an `EnvironmentAttachment` narrows to `{filesystem, access}` assignable into a `FilesystemBinding`-shaped selector.
- Acceptance: exports resolve from `@hachej/boring-bash/shared`; `pnpm --filter @hachej/boring-bash run typecheck` green.

### BBE1-002 — `EnvironmentRegistry` over the scoped binding manager (M)
- Description: Host-owned registry (create/get/list/dispose by `id`) that wraps `ScopedFilesystemRuntimeBindingManager` and resolves attachments to prepared handles.
- Files: create `packages/boring-bash/src/server/environmentRegistry.ts`; export from `packages/boring-bash/src/server/index.ts`.
- Notes: `EnvironmentRegistry` is a **minimal Map-backed registry** — a `Map<string, Environment>` plus `create`/`get`/`list`/`resolve`/`dispose`, and **no lifecycle framework beyond `prepare`/`dispose`** (no phases, no hooks, no state machine). It delegates preparation to a `ScopedFilesystemRuntimeBindingManager` instance. `resolve(ctx, attachments[]): Promise<ResolvedEnvironments>` maps each `EnvironmentAttachment` to a `FilesystemBinding` (`{filesystem, access, mountPath, projection}`) and calls `prepareRuntime(ctx)` / `getPreparedBinding(ctx, selector)` to obtain `PreparedFilesystemBinding.handle`. Keep the existing manager as the single preparation path — the registry is orchestration, not new policy. `dispose(ctx)` delegates to `manager.disposeRuntime(ctx)`.
- Tests: `packages/boring-bash/src/server/__tests__/environmentRegistry.test.ts` — register two environments (`user` readwrite, `company_context` readonly), resolve for one ctx, assert two prepared handles with distinct `filesystem` (exit criterion 3).
- Acceptance: two-environments-per-agent test passes; disposing evicts the scoped plan.

### BBE1-003 — `company_context` as reference environment + readonly attachment (M)
- Description: Adapter re-expressing the landed company-context provider as an `Environment` + a readonly `EnvironmentAttachment` — no change to `FixtureCompanyContextBindingProvider`.
- Files: create `packages/boring-bash/src/server/companyContextEnvironment.ts`; export from server barrel.
- Notes: Build an `Environment { id: 'company_context', provider: 'fixture', capabilities: { fs: 'readonly', exec: false } }` and a factory returning `EnvironmentAttachment { environmentId: 'company_context', filesystem: COMPANY_CONTEXT_FILESYSTEM_ID, access: 'readonly', execPolicy: 'none' }`. Registry preparation for it must route through the existing `FixtureCompanyContextBindingProvider` (or the real provider a host injects) so `createReadonlyProjectionOperations` still backs reads. Assert `execPolicy: 'none'` (invariant 4).
- Tests: `packages/boring-bash/src/server/__tests__/companyContextEnvironment.test.ts` — resolving the reference attachment yields the same visible-path set as a direct `FixtureCompanyContextBindingProvider` prepare (behavioral equivalence with #416).
- Acceptance: existing `readonlyCompanyContext*` tests untouched and green; the adapter produces an equivalent projection.

### BBE1-004 — Scoped-view (subpath jail) enforcement in the host (M)
- Description: `scope.subpath` produces a jailed projection whose root is `join(baseProjectionRoot, subpath)`, enforced physically.
- Files: `packages/boring-bash/src/server/environmentRegistry.ts` (scoped-root computation); add helper `scopedProjectionHandle(base: ReadonlyProjectionHandle, subpath?: string): ReadonlyProjectionHandle`.
- Notes: Normalize `subpath` with the same rules `readonlyProjectionOperations.normalizeProjectionPath` uses (reject `..`/`.`/null-byte); compute the child root, then hand a `ReadonlyProjectionHandle { filesystem, projectionRoot: childRoot }` to `createReadonlyProjectionOperations`. All ops then inherit `assertInsideProjection` jailing. Never filter paths on the consumer side. **Harden containment to be realpath-based with symlink denial:** the landed `readonlyProjectionOperations.ts` jails **lexically via `resolve()` only** — a symlink inside the projection can point outside the jail. E1 must `lstat` each resolved path component and either **reject symlinks** or **resolve them (realpath) and re-check the result is still inside `projectionRoot`** before any op. This applies to both the base projection and every scoped child root.
- Tests: `packages/boring-bash/src/server/__tests__/scopedView.test.ts` — a subpath-scoped attachment cannot read a sibling outside the subpath (rejects); can read inside; a `../` subpath is rejected at construction. **Plus an explicit symlink-escape conformance test**: a symlink inside the projection/subpath pointing outside the jail is denied (read/list/stat all reject), proving containment is realpath-based, not lexical.
- Acceptance: scoped view cannot escape its subpath **including via symlink**; parent (unscoped) still sees the full tree; the symlink-escape test passes.

> **BBE1-005 (subagent attachment seam) is deferred to Phase 7** — see the "Deferred to Phase 7" section below. It is NOT v1 E1 scope.

### BBE1-006 — `ResolvedEnvironments` type-only into agent core + invariant extension (S)
- Description: Make the agent core consume `ResolvedEnvironments` as a type-only import and prove it never value-imports boring-bash.
- Files: `packages/agent/src/server/runtime/mode.ts` (add optional `resolvedEnvironments?: import('@hachej/boring-bash/shared').ResolvedEnvironments` as a **type-only** field on `RuntimeBundle`, adjacent to `filesystemBindings`); extend `packages/boring-bash/scripts/check-invariants.mjs` to assert `./shared` exports the new environment types; extend `scripts/audit-imports.ts` allow/deny lists if needed so the type-only import is permitted but a value import fails.
- Notes: Confirm the reduction: `ResolvedEnvironments.attachments` maps onto the existing `RuntimeFilesystemBinding[]` (`{filesystem, access, operations}`) so the core loop is unchanged. Do not import any runtime value. Keep the existing `filesystemBindings` field working.
- Tests: extend `packages/agent/src/__tests__/invariants.test.ts` (or `invariants-script.test.ts`) with a case asserting a value import of `@hachej/boring-bash` from agent server fails the audit while `import type` passes.
- Acceptance: `pnpm audit:imports` green; `pnpm lint:invariants` green; agent typechecks against the new type-only field.

### BBE1-007 — Scoped-view mount of the no-leak conformance suite (S)
- Description: Run `checkReadonlyProjectionConformance` against a scoped-view attachment as a new mount (fits `09` "one suite, four mounts").
- Files: `packages/boring-bash/src/server/__tests__/scopedViewConformance.test.ts`.
- Notes: Build a `ReadonlyProjectionConformanceSubject` whose `operations`/`projection` come from a subpath-scoped attachment resolved through the registry. Reuse the existing fixture seeds; assert the denied directory/sentinel outside the subpath is absent and mutations reject.
- Tests: the file is the test.
- Acceptance: conformance `passed: true` for the scoped-view mount.

## Deferred to Phase 7 (first real subagent consumer) — NOT v1 E1 scope

Subagents are not a first-class code path in `packages/agent` today (see the Verified reality check: no subagent/task tool, no `spawnSubagent`, no child-session attach seam). Building a subagent attachment contract now would be a speculative abstraction with no consumer. Defer the following to **Phase 7 (multi-agent)**, when the first real subagent consumer exists:

### BBE1-005 (deferred) — Explicit subagent attachment seam (S)
- Description: Define the contract by which a subagent receives an environment — explicit attachment only, no cwd inheritance. Ships the **contract + reduction**, not harness wiring.
- Files: `packages/boring-bash/src/shared/environment.ts` (add `SubagentEnvironmentGrant { parentEnvironmentId: string; scope?: { subpath?: string }; access: FilesystemAccess }`); document the seam in `packages/boring-bash/src/server/environmentRegistry.ts` as a `deriveSubagentAttachment(parent: EnvironmentAttachment, grant: SubagentEnvironmentGrant): EnvironmentAttachment` pure function.
- Notes: The derived attachment reuses the parent `environmentId`/`filesystem` (shared workspace) or adds `scope.subpath` (jailed view). It NEVER copies a cwd. `execPolicy` for a subagent grant defaults to `'none'`. The scope key already carries `agentId`, so a subagent with a distinct `agentId` gets an isolated prepared plan automatically.
- Tests: `packages/boring-bash/src/server/__tests__/subagentAttachment.test.ts` — derive a scoped-view grant from a parent, resolve for a subagent `ctx` (different `agentId`), assert it reads only within the subpath and shares no prepared handle with the parent.
- Acceptance (when scheduled): subagent scoped-view attachment resolves and is isolated by `agentId`.

## Verification — exact commands verified against package.json scripts

```bash
# boring-bash package (scripts: build=tsup, typecheck=tsc --noEmit, test=vitest run --passWithNoTests, check:invariants, lint)
pnpm --filter @hachej/boring-bash run build
pnpm --filter @hachej/boring-bash run typecheck
pnpm --filter @hachej/boring-bash run check:invariants
pnpm --filter @hachej/boring-bash run test

# agent type-only invariant + repo import audit (root scripts)
pnpm audit:imports                 # scripts/audit-imports.ts
pnpm lint:invariants               # runs agent lint:invariants + boring-bash check:invariants + workspace plugin invariants
pnpm --filter @hachej/boring-agent run typecheck

# governance-consumer regression: full package build + test
pnpm run build:packages
pnpm run test
```

## Review gates

- No diff to landed #416 type/class signatures (git diff of `shared/index.ts`, `runtimeBindingManager.ts`, `readonlyProjectionOperations.ts`, `readonlyProjectionConformance.ts`, `companyContextFixtureProvider.ts` shows additions only via new files / re-exports, no edits to existing declarations).
- Agent core has zero value import of `@hachej/boring-bash` (audit green).
- Two-environments and scoped-view tests present and green (subagent attachment deferred to Phase 7).
- Scoped-view conformance is a distinct mount, not a fork of the suite.
