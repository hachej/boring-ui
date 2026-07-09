# TODO-E1 — Environment attachments (generalize the #416 binding model)

Handoff: self-contained work order for one autonomous coding agent (pi or gpt-5.5-xhigh). Cite plan files by relative path. No prior conversation assumed.

## Context (read first)

- Plan: `docs/issues/391/runtime-refactor/architecture/09-environments-attachable.md` (the target model — read in full).
- Plan: `docs/issues/391/runtime-refactor/INDEX.md` § "Phase E1" (deliverables + exit criteria) and § "Rules" (rule 4: #416 landed contracts must not be redone).
- Plan: `docs/issues/391/runtime-refactor/architecture/08-pluggable-agent-surfaces.md` § "Multi-filesystem contract intersection" and § "Two handles".
- Landed #416 contracts you generalize (do not rewrite):
  - `packages/boring-bash/src/shared/index.ts` — `FilesystemId`, `FilesystemAccess`, `FilesystemBinding`, `BoundFilesystemContext`, `FilesystemBindingResolver`, `PreparedFilesystemBinding`, `FilesystemBindingProvider`, `RuntimeBindingPlan`.
  - `packages/boring-bash/src/server/runtimeBindingManager.ts` — `ScopedFilesystemRuntimeBindingManager`, `filesystemRuntimeScopeKey(ctx)`, `ScopedRuntimeBindingPlan`, `ScopedPreparedFilesystemBinding`, `PreparedBindingSelector`. The scope key today joins `humanUserId\0agentId\0sessionId\0workspaceId\0requestId` — `agentId` is already in the key, so per-agent/per-subagent attachment needs no new key field.
  - `packages/boring-bash/src/server/readonlyProjectionOperations.ts` — `createReadonlyProjectionOperations(handle)`, `ReadonlyProjectionOperations`, `ReadonlyProjectionHandle {filesystem, projectionRoot}`. Note `assertInsideProjection` already jails every op to `projectionRoot` — the scoped-view subpath jail rides this.
  - `packages/boring-bash/src/server/testing/readonlyProjectionConformance.ts` — `checkReadonlyProjectionConformance(subject)`, `ReadonlyProjectionConformanceSubject`.
  - `packages/boring-bash/src/server/testing/companyContextFixtureProvider.ts` — `FixtureCompanyContextBindingProvider`, `COMPANY_CONTEXT_FILESYSTEM_ID = "company_context"`, `COMPANY_CONTEXT_SENTINEL`.
  - Exports barrels: `packages/boring-bash/src/server/index.ts`, package exports `.`/`./shared`/`./server` in `packages/boring-bash/package.json`.
- Agent-core injection surface (type-only for the core): the operation-bearing binding shape currently lives only in `packages/agent/src/server/runtime/mode.ts` — `RuntimeBundle.filesystemBindings?: RuntimeFilesystemBinding[]`, `RuntimeFilesystemBinding {filesystem, access, operations}`, `RuntimeFilesystemBindingOperations`. There is no shared home yet. **Pinned home:** extend the existing front-safe `packages/agent/src/shared/runtime.ts` to export `RuntimeFilesystemBinding`, `RuntimeFilesystemBindingOperations`, `AttachedEnvironmentRuntime`, and `ResolvedEnvironment`, then have `server/runtime/mode.ts` import those types from `../../shared/runtime`. `AttachedEnvironmentRuntime[]` carries operation-bearing runtime objects; `ResolvedEnvironment[]` carries methodless public facts; `RuntimeFilesystemBinding[]` remains only the filesystem facet.
- Invariant scripts you must extend: `packages/boring-bash/scripts/check-invariants.mjs` (checks required exports `.`/`./shared`/`./server`); repo value-import audit `scripts/audit-imports.ts` (run via `pnpm audit:imports`); agent-side invariant tests `packages/agent/src/__tests__/invariants.test.ts` + `packages/agent/src/__tests__/invariants-script.test.ts`.
- Governance PRs (#476–#501, the #475 line) consume the landed shapes above. This bead is **additive/adapter only** — a governance consumer that imports `FilesystemBinding`/`FilesystemBindingResolver`/`ScopedFilesystemRuntimeBindingManager` must keep compiling and passing with zero source edits.

**Depends on: Phase 2 AND Phase 3.** E1 runs after both per [`../../INDEX.md`](../../INDEX.md) (`P2, P3`). Rationale: P3 creates the `createBashAgentFeature()` bundle; **E1 may re-implement that bundle's internals over environment attachments without changing its public `{ tools, readinessRequirements, systemPromptFragment }` signature**. E1 does not fork the bundle API — it generalizes what backs it.

Verified reality check (do not assume otherwise):
- `createBashAgentFeature()` does **not** exist yet — it is a Phase 3 name in the plan. E1 introduces the environment contracts and the attachment→`AttachedEnvironmentRuntime[]`/`ResolvedEnvironment[]` reduction; wiring the public bundle (`{ tools, readinessRequirements, systemPromptFragment }`, spread into `createAgent()`'s tools/readiness/prompt composition) is Phase 3's job — there is no `features` registry. Provide `resolveAttachments()` only, not a feature system or a second helper vocabulary.
- Subagents are **not** a first-class code path in `packages/agent` today. A repo-wide search finds only a `pi-subagent` renderer key in `packages/agent/src/shared/tool-ui.ts`; there is no subagent/task tool, no `spawnSubagent`, no child-session attach seam in `packages/agent/src/server`. Encode the seam as a **new explicit contract**, not a modification of existing subagent plumbing (there is none).

## Goal / exit criteria

Match `INDEX.md` Phase E1 exit criteria:
1. Existing workspace + `company_context` behavior unchanged; governance consumers green (no edits to landed shapes).
2. A **scoped view** (`scope.subpath`) of an environment is attachable and physically jailed (BBE1-004/007). (The subagent-specific consumer of scoped views is deferred to Phase 7 — see the "Deferred to Phase 7" section.)
3. An agent can hold **two environments** with distinct `filesystem` identities simultaneously.
4. Agent core **owns** the core-facing environment bridge — `AttachedEnvironmentRuntime[]` for operation-bearing runtimes and `ResolvedEnvironment[]` for methodless public facts (there is **no** `PreparedEnvironmentAttachment`; `RuntimeFilesystemBinding[]` is only the filesystem facet) — in `@hachej/boring-agent` shared, and value-imports **nothing** from `@hachej/boring-bash` (invariant-checked — no value import, and no type import from boring-bash either; the type dependency runs boring-bash → agent only).
5. Scoped-view no-leak conformance passes as a new mount of the existing suite.

## Non-negotiables

- Generalize, do not replace. New `Environment`/`EnvironmentAttachment` plus agent-owned `AttachedEnvironmentRuntime[]`/`ResolvedEnvironment[]` types wrap the landed shapes. **No `EnvironmentRegistry` class and no second registry/lifecycle vocabulary in E1** — E1 is `EnvironmentAttachment` contracts + a thin `resolveAttachments` adapter that reduces attachments to prepared runtimes/facts over the existing #416 `FilesystemBinding[]`/`ScopedFilesystemRuntimeBindingManager`. `EnvironmentAttachment.filesystem`/`access` are the existing `FilesystemId`/`FilesystemAccess`. `company_context` becomes the **reference** environment + a readonly attachment via an adapter over `FixtureCompanyContextBindingProvider` — not a rewrite of the fixture provider.
- Scoped views (`scope.subpath`) enforced **by the environment host** (physical projection root = `join(projectionRoot, subpath)`, reusing `ReadonlyProjectionHandle` jailing), never by consumer-side path filtering. `09` security invariant 2.
- `execPolicy` default is `'none'` for any non-`user` attachment (`09` security invariant 4). Readonly/`company_context` attachments never carry exec.
- **One type-dependency direction (only boring-bash → agent).** The core-facing injection contract is **defined in the agent package**, not boring-bash: `AttachedEnvironmentRuntime[]` for operation-bearing runtime objects and `ResolvedEnvironment[]` for methodless facts (there is **no** `PreparedEnvironmentAttachment`/opaque-`handle` shape) live in `@hachej/boring-agent` shared contracts. `boring-bash/shared` keeps the **rich** `Environment`/`EnvironmentAttachment` types, and its `resolveAttachments` adapter (in `boring-bash/server`) **imports the agent-defined types type-only** and returns prepared runtimes plus facts. Result: the only cross-package type import is `boring-bash → @hachej/boring-agent`. **The agent core MUST NOT import any type (or value) from `@hachej/boring-bash`.**
- **Workspace-bound context is required for any attachment (`09` security invariant 5, non-negotiable).** Environment attachments (`company_context`, any governed fs, and the E2 MCP projection) REQUIRE a workspace-bound `BoundFilesystemContext` — `workspaceId` is real (locked #416, unchanged). A workspace-less / pure surface runs `runtime: 'none'` with **no attachments** until the host binds it to a workspace; `resolveAttachments` is never called to attach governed context for a session with no `workspaceId`, and surfaces never synthesize a `workspaceId`.
- Attachment is the only coupling: no implicit cwd inheritance for subagents. A subagent gets an environment only by an explicit `EnvironmentAttachment`.

## Do NOT

- Do NOT edit `FilesystemBinding`, `FilesystemBindingResolver`, `ScopedFilesystemRuntimeBindingManager`, or the conformance subject signatures. Wrap them. **Carve-out:** BBE1-004 may make implementation-only edits to `readonlyProjectionOperations.ts` to add realpath/lstat symlink containment; exported projection-operation signatures remain frozen.
- Do NOT add **any** import of `@hachej/boring-bash` into `packages/agent` — neither a value import nor an `import type` (the core-facing `AttachedEnvironmentRuntime`/`ResolvedEnvironment` types are agent-owned; the type edge runs boring-bash → agent only). The audit forbids the agent→boring-bash direction entirely.
- Do NOT build the Phase 3 `createBashAgentFeature()` public API or move routes/tools. Stop at attachments + `resolveAttachments` reduction + scoped-view enforcement. There is **no** registry vocabulary in E1: the id-lookup registry (a plain `Map<environmentId, Environment>`) is **E2-only**.
- Do NOT invent a new scope key field; `agentId` already discriminates.
- Do NOT touch `/home/ubuntu/projects/boring-ui-v2`. Work on a dedicated branch/worktree per the PR-PLAN branch naming; never commit to main directly; every bead lands as a PR per INDEX.

## Beads

### BBE1-001 — Environment/attachment contracts, split across the two packages (S)
- Description: Add the `09` contracts as type-only shapes generalizing #416, respecting the single type-dependency direction (boring-bash → agent).
- Files: (a) create `packages/boring-bash/src/shared/environment.ts` for the **rich** types; re-export from `packages/boring-bash/src/shared/index.ts`. (b) extend `packages/agent/src/shared/runtime.ts` for the **minimal core-facing** types; `packages/agent/src/server/runtime/mode.ts` imports the operation-bearing binding types from there.
- Notes:
  - **In `boring-bash/shared` (rich, host-facing):** `Environment { id: string; provider: string; capabilities: EnvironmentCapabilities; }`. **Do not define a second provider-capability contract.** `EnvironmentCapabilities` is a **type-only alias/pick of `ProviderCapabilities` from `@hachej/boring-sandbox/shared`** (the authoritative home named by `02-boring-bash-environment.md`), e.g. `export type EnvironmentCapabilities = Pick<ProviderCapabilities, 'fs' | 'exec' | 'watch' | 'search' | 'realBash' | 'realBinaries' | 'networkIsolation'>` or the full `ProviderCapabilities` if the environment summary needs every fact. The facts stay the P2 matrix facts: `fs: 'none' | 'readonly' | 'readwrite'`, `exec`, `watch`, `search`, `realBash?: boolean | 'unknown'`, `realBinaries?: boolean | 'unknown'`, `networkIsolation?: 'none' | 'process' | 'container' | 'microvm' | 'provider' | 'unknown'`. `networkIsolation` is the **enum**, not a boolean; worker-dependent fields are `reported | 'unknown'` and consumers fail closed on `'unknown'` (02 "Worker-dependent capabilities are reported, not declared"). Do NOT re-model any of these as plain booleans or duplicate the enum/interface in boring-bash. `EnvironmentAttachment { environmentId: string; filesystem: FilesystemId; access: FilesystemAccess; scope?: { subpath?: string }; execPolicy: 'none' | 'attached' }`. Reuse `FilesystemId`/`FilesystemAccess` from `./index`.
  - **In `@hachej/boring-agent` shared (minimal core-facing):** first move/export the existing operation-bearing runtime binding contract out of `packages/agent/src/server/runtime/mode.ts` into the shared/type-only surface, then have `server/runtime/mode.ts` consume that shared type. The agent-side injection types are `AttachedEnvironmentRuntime` (operation-bearing runtime object; may include `filesystem.bindings?: RuntimeFilesystemBinding[]` as the #416 filesystem facet) and `ResolvedEnvironment` (methodless public facts). **There is NO `PreparedEnvironmentAttachment { handle: unknown }` — it is deleted.** The agent never receives an opaque handle; it receives prepared, operation-bearing attached runtimes. `FilesystemId`/`FilesystemAccess` are the agent's own local string-literal aliases matching `RuntimeFilesystemBinding`. boring-bash's `resolveAttachments` **imports the agent-defined types type-only** and returns prepared runtimes plus facts — wrapping prepare + operations construction (see BBE1-002).
- Tests: type-only; covered by BBE1-006 build/typecheck. Add a `.test-d`-style compile assertion in `packages/boring-bash/src/shared/__tests__/environment.types.test.ts` that a rich `EnvironmentAttachment` narrows to `{filesystem, access}` assignable into a `FilesystemBinding`-shaped selector, and that a mapped binding satisfies the agent-defined `RuntimeFilesystemBinding` facet inside an `AttachedEnvironmentRuntime`.
- Acceptance: rich exports resolve from `@hachej/boring-bash/shared`; the minimal `AttachedEnvironmentRuntime`/`ResolvedEnvironment` types (no `PreparedEnvironmentAttachment`) resolve from `@hachej/boring-agent` shared; `pnpm --filter @hachej/boring-bash run typecheck` and `pnpm --filter @hachej/boring-agent run typecheck` green; the only cross-package type edge is boring-bash → agent.

### BBE1-002 — `resolveAttachments` adapter over the scoped binding manager (M)
- Description: A thin adapter that **REDUCES** host-supplied `{ environment, attachment }` entries to the existing #416 `FilesystemBinding[]` and resolves them through a **host-supplied** landed `ScopedFilesystemRuntimeBindingManager`. **The adapter takes explicit host-supplied inputs — no environment lookup, no registry, no address-by-id store, no new prepare/dispose lifecycle** — the manager already owns preparation and disposal.
- Files: create `packages/boring-bash/src/server/resolveAttachments.ts`; export from `packages/boring-bash/src/server/index.ts`.
- Notes: Signature (explicit host-supplied inputs — the adapter never looks anything up):
  ```ts
  resolveAttachments(
    ctx: BoundFilesystemContext,
    manager: ScopedFilesystemRuntimeBindingManager,
    entries: Array<{ environment: Environment; attachment: EnvironmentAttachment; mountPath: string }>,
  ): Promise<{ runtimes: AttachedEnvironmentRuntime[]; facts: ResolvedEnvironment[] }>
  ```
  The `manager` and the paired `{ environment, attachment, mountPath }` entries are passed in by the host (each entry carries its own host-supplied `mountPath`; the `Environment` type itself is unchanged — the mount is per-entry, not a field baked onto `Environment`); the adapter does **not** resolve an environment by id (that Map is **E2**). It maps each entry's `attachment` to a `FilesystemBinding` (`{filesystem, access, mountPath, projection}`), delegates to the passed-in `ScopedFilesystemRuntimeBindingManager` (`prepareRuntime(ctx)` / `getPreparedBinding(ctx, selector)`) for each `PreparedFilesystemBinding.handle`, then returns **agent-defined** prepared `AttachedEnvironmentRuntime[]` and public `ResolvedEnvironment[]` facts (imported type-only from `@hachej/boring-agent`) by constructing filesystem facets with one operation-bearing `RuntimeFilesystemBinding` (`{filesystem, access, operations}`) per prepared binding — the `operations` are the #416 projection ops (`createReadonlyProjectionOperations` / `createManagementProjectionOperations`) built over the `PreparedFilesystemBinding.handle`. **There is NO `PreparedEnvironmentAttachment` and NO opaque `handle: unknown` handed to the agent (that type is deleted); `resolveAttachments` wraps prepare + operations construction and returns attached runtimes plus facts directly.** The entries consumed here come from the same host-mediated `bindingResolver` composition point reserved by the boring-bash server plugin, fulfilled by `boring-governance` or host config. It introduces **no** new lifecycle: preparation and disposal stay on the manager (`manager.disposeRuntime(ctx)` remains the single dispose path, called by the host — do not wrap it in a new registry/state-machine). Pure reduction + delegation, not an orchestration or policy layer. **Address-by-id lookup (a plain `Map<environmentId, Environment>`) is NOT introduced here** — it lands in **E2** ([`../E2-mcp-projection/TODO.md`](../E2-mcp-projection/TODO.md)), the first place the MCP projection actually needs to resolve an environment by id. Do not add a Map/registry speculatively in E1.
- **`EnvironmentAttachment` → `FilesystemBinding` mapping rules (grounded in the LANDED `packages/boring-bash/src/shared/index.ts`: `FilesystemBinding = { filesystem, access, mountPath, projection }`). Write these as explicit bullet rules in the adapter source/doc-comment:**
  - `filesystem` ← `attachment.filesystem` (unchanged — the model-visible `FilesystemId`).
  - `access` ← `attachment.access` (unchanged — `FilesystemAccess`, `'readonly' | 'readwrite'`).
  - `projection` (E1 default map, no other combos): `access: 'readonly'` → `projection: 'policy-filtered'`; `access: 'readwrite'` → `projection: 'management'`. These are the two `FilesystemProjection` values landed; **an E1 attachment may not invent any other `access`/`projection` combination** (this matches the landed `FixtureCompanyContextBindingProvider`, which prepares exactly readonly-`policy-filtered` and readwrite-`management`).
  - `mountPath` ← the entry's `mountPath` (host-supplied per entry — the environment's configured mount for that `filesystem`, same pattern the landed `company_context` provider follows). The landed shapes define `mountPath: string` on `FilesystemBinding` but ship **no concrete default constant** (grep: `mountPath` is set nowhere in `packages/boring-bash/src`); the host therefore supplies it explicitly on each `entry` — the adapter reads `entry.mountPath` and does not synthesize a default.
  - `scope.subpath` alters the **prepared handle's jail** (realpath + symlink-denial rules, BBE1-004) WITHOUT changing the `filesystem` identity or the `mountPath` — it is a jailed child projection root, not a different filesystem.
- Tests: `packages/boring-bash/src/server/__tests__/resolveAttachments.test.ts` — call `resolveAttachments(ctx, manager, entries)` with two entries (`user` readwrite, `company_context` readonly) for one ctx, assert two `AttachedEnvironmentRuntime` results with distinct `id`/`filesystem` facts (exit criterion 3), each carrying a `filesystem.bindings` facet with `operations` and derived from `projection: 'management'` / `'policy-filtered'` respectively and the host-supplied `mountPath` (assert no `handle: unknown`/`PreparedEnvironmentAttachment` in the returned shape); disposing via `manager.disposeRuntime(ctx)` evicts the scoped plan. Also assert matching methodless `ResolvedEnvironment` facts expose access/tool/provider facts only.
- Acceptance: two-environments-per-agent reduction passes; the reduction adds no lifecycle beyond the landed manager; **no `EnvironmentRegistry` class or id-lookup Map exists in E1** (that is E2).

### BBE1-003 — `company_context` as reference environment + readonly attachment (M)
- Description: Adapter re-expressing the landed company-context provider as an `Environment` + a readonly `EnvironmentAttachment` — no change to `FixtureCompanyContextBindingProvider`.
- Files: create `packages/boring-bash/src/server/companyContextEnvironment.ts`; export from server barrel.
- Notes: Build an `Environment { id: 'company_context', provider: 'fixture', capabilities: ... }` whose `capabilities` value satisfies the `EnvironmentCapabilities` alias/pick of `@hachej/boring-sandbox/shared` `ProviderCapabilities` (for the fixture: readonly fs, no exec, watch/search facts explicitly set per the P2 matrix), and a factory returning `EnvironmentAttachment { environmentId: 'company_context', filesystem: COMPANY_CONTEXT_FILESYSTEM_ID, access: 'readonly', execPolicy: 'none' }`. Preparation for it must route through the existing `FixtureCompanyContextBindingProvider` (or the real provider a host injects) via the `ScopedFilesystemRuntimeBindingManager` — no new registry — so `createReadonlyProjectionOperations` still backs reads. Assert `execPolicy: 'none'` (invariant 4).
- Tests: `packages/boring-bash/src/server/__tests__/companyContextEnvironment.test.ts` — resolving the reference attachment yields the same visible-path set as a direct `FixtureCompanyContextBindingProvider` prepare (behavioral equivalence with #416).
- Acceptance: existing `readonlyCompanyContext*` tests untouched and green; the adapter produces an equivalent projection.

### BBE1-004 — Scoped-view (subpath jail) enforcement in the host (M)
- Description: `scope.subpath` produces a jailed projection whose root is `join(baseProjectionRoot, subpath)`, enforced physically.
- Files: `packages/boring-bash/src/server/resolveAttachments.ts` (scoped-root computation); add helper `scopedProjectionHandle(base: ReadonlyProjectionHandle, subpath?: string): ReadonlyProjectionHandle`.
- Notes: Normalize `subpath` with the same rules `readonlyProjectionOperations.normalizeProjectionPath` uses (reject `..`/`.`/null-byte); compute the child root, then hand a `ReadonlyProjectionHandle { filesystem, projectionRoot: childRoot }` to `createReadonlyProjectionOperations`. All ops then inherit `assertInsideProjection` jailing. Never filter paths on the consumer side. **Harden containment to be realpath-based with symlink denial:** the landed `readonlyProjectionOperations.ts` jails **lexically via `resolve()` only** — a symlink inside the projection can point outside the jail. E1 must `lstat` each resolved path component and either **reject symlinks** or **resolve them (realpath) and re-check the result is still inside `projectionRoot`** before any op. This applies to both the base projection and every scoped child root.
- Tests: `packages/boring-bash/src/server/__tests__/scopedView.test.ts` — a subpath-scoped attachment cannot read a sibling outside the subpath (rejects); can read inside; a `../` subpath is rejected at construction. **Plus an explicit symlink-escape conformance test**: a symlink inside the projection/subpath pointing outside the jail is denied (read/list/stat all reject), proving containment is realpath-based, not lexical.
- Acceptance: scoped view cannot escape its subpath **including via symlink**; parent (unscoped) still sees the full tree; the symlink-escape test passes.

> **BBE1-005 (subagent attachment seam) is deferred to Phase 7** — see the "Deferred to Phase 7" section below. It is NOT v1 E1 scope.

### BBE1-006 — Agent-owned attached-runtime/facts core-facing types + invariant extension (S)
- Description: Make the agent core **own** `AttachedEnvironmentRuntime` and `ResolvedEnvironment` (defined in `@hachej/boring-agent` shared, BBE1-001; there is **no** `PreparedEnvironmentAttachment`) — and prove it never imports — type **or** value — from `@hachej/boring-bash`. Cross-package type edges are explicit and one-way by purpose: boring-bash → agent for the core-facing attached runtime/facts types, and boring-bash → boring-sandbox/shared for the authoritative `ProviderCapabilities` alias/pick. The agent imports neither boring-bash nor boring-sandbox.
- Files: the agent shared contracts module (BBE1-001) exports `RuntimeFilesystemBinding`, `RuntimeFilesystemBindingOperations`, `AttachedEnvironmentRuntime`, and `ResolvedEnvironment` (there is no `PreparedEnvironmentAttachment` — deleted); `packages/agent/src/server/runtime/mode.ts` imports those shared types and adds optional environment-runtime/facts fields on `RuntimeBundle`, adjacent to `filesystemBindings` — **no `import('@hachej/boring-bash/shared')`** and no duplicate runtime-binding type definition. Extend `packages/boring-bash/scripts/check-invariants.mjs` to assert `boring-bash/shared` exports the **rich** `Environment`/`EnvironmentAttachment` types and that `resolveAttachments` imports the agent `AttachedEnvironmentRuntime`/`ResolvedEnvironment` types type-only; extend `scripts/audit-imports.ts` allow/deny lists so an agent→boring-bash import (type or value) fails, while boring-bash→agent type-only is permitted.
- Notes: Confirm the reduction: attached runtime filesystem facets carry the existing `RuntimeFilesystemBinding[]` (`{filesystem, access, operations}`) — no intermediate handle/`PreparedEnvironmentAttachment` shape — so the core loop is unchanged. The agent imports **nothing** from boring-bash. Keep the existing `filesystemBindings` field working during migration.
- Tests: extend `packages/agent/src/__tests__/invariants.test.ts` (or `invariants-script.test.ts`) with a case asserting that **any** import of `@hachej/boring-bash` from agent server — including `import type` — fails the audit, and that boring-bash's `resolveAttachments` may `import type` the agent `AttachedEnvironmentRuntime`/`ResolvedEnvironment` types.
- Acceptance: `pnpm audit:imports` green; `pnpm lint:invariants` green; agent typechecks against the agent-owned field with zero boring-bash imports.

### BBE1-007 — Scoped-view mount of the no-leak conformance suite (S)
- Description: Run `checkReadonlyProjectionConformance` against a scoped-view attachment as a new mount (fits `09`/`07` "one suite, N mounts" — the delivered mounts are in-process, scoped-view, and MCP; the remote-worker provider mount is deferred to BBP5-010, and its provider now lives in `@hachej/boring-sandbox/providers` post-P2). E1's environment code itself stays in `boring-bash/server` (attachments over the #416 binding manager); E1 does **not** import concrete providers.
- Files: `packages/boring-bash/src/server/__tests__/scopedViewConformance.test.ts`.
- Notes: Build a `ReadonlyProjectionConformanceSubject` whose `operations`/`projection` come from a subpath-scoped attachment resolved through the `resolveAttachments` adapter (over the landed `ScopedFilesystemRuntimeBindingManager`). Reuse the existing fixture seeds; assert the denied directory/sentinel outside the subpath is absent and mutations reject.
- Tests: the file is the test.
- Acceptance: conformance `passed: true` for the scoped-view mount.

## Deferred to Phase 7 (first real subagent consumer) — NOT v1 E1 scope

Subagents are not a first-class code path in `packages/agent` today (see the Verified reality check: no subagent/task tool, no `spawnSubagent`, no child-session attach seam). Building a subagent attachment contract now would be a speculative abstraction with no consumer. Defer the following to **Phase 7 (multi-agent)**, when the first real subagent consumer exists:

### BBE1-005 (deferred) — Explicit subagent attachment seam (S)
- Description: Define the contract by which a subagent receives an environment — explicit attachment only, no cwd inheritance. Ships the **contract + reduction**, not harness wiring.
- Files: `packages/boring-bash/src/shared/environment.ts` (add `SubagentEnvironmentGrant { parentEnvironmentId: string; scope?: { subpath?: string }; access: FilesystemAccess }`); document the seam in `packages/boring-bash/src/server/resolveAttachments.ts` as a `deriveSubagentAttachment(parent: EnvironmentAttachment, grant: SubagentEnvironmentGrant): EnvironmentAttachment` pure function.
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

## PR-PLAN reconciliation

Matches [`../../PR-PLAN.md`](../../PR-PLAN.md) E1 rows exactly:

- `pr1-env-contracts` → BBE1-001.
- `pr2-resolve-attachments` → BBE1-002.
- `pr3-company-context-env` → BBE1-003.
- `pr4-scoped-view-jail` → BBE1-004.
- `pr5-agent-typeonly-conformance` → BBE1-006 + BBE1-007.
- `BBE1-005` has **no E1 PR**; it is deferred to Phase 7 and lands with P7 `pr8-subagent-grant`.

## Review gates

- No diff to landed #416 type/class signatures (git diff of `shared/index.ts`, `runtimeBindingManager.ts`, `readonlyProjectionConformance.ts`, `companyContextFixtureProvider.ts` shows additions only via new files / re-exports, no edits to existing declarations). **Named carve-out:** BBE1-004 may edit `readonlyProjectionOperations.ts` internals for realpath/lstat symlink hardening, but may not change exported names, parameter types, return types, or conformance subject signatures.
- Agent core has zero import (value **or** type) of `@hachej/boring-bash`; the only cross-package type edge is boring-bash → `@hachej/boring-agent` (audit green).
- Two-environments and scoped-view tests present and green (subagent attachment deferred to Phase 7).
- Scoped-view conformance is a distinct mount, not a fork of the suite.
