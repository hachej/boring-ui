# TODO-E1 — Environment attachments (generalize the #416 binding model)

> **Post-v1, non-dispatchable (2026-07-10).** Reopen only when a named second
> attachment consumer and a new decision re-specify this work. Every pure,
> no-environment, `runtime: 'none'`, or workspace-less clause below is void
> historical text. It cannot become a future acceptance test by relabeling.

## Historical ownership correction (2026-07-09)

The detailed `AttachedEnvironmentRuntime` instructions below are superseded.
Do not move operation-bearing runtime objects into agent shared/core.

- boring-bash/host owns `PreparedEnvironmentAttachment`, filesystem/exec
  operations, the scoped manager, invalidation, and exact-once disposal.
- agent shared owns only methodless `ResolvedEnvironment` facts.
- host flattens one prepared attachment view into existing `tools`, prompt,
  readiness, and input-asset seams; routes and UI use that same view.
- never synthesize `agentId` from request/session identifiers. Trusted scope is
  adapter-created and identifiers are validated before composite key encoding.
- attachment preparation uses a stable lifetime key with no per-request id;
  each operation is authorized separately through a callback-scoped lease.
  Never return or capture a raw prepared handle outside that authorization gate.

Coordinator: never assign this whole file. Dispatch one bead/PR with this
file's context, dependencies, and non-negotiables included in the assignment.

## Context (read first)

- Plan: `docs/issues/391/runtime-refactor/architecture/09-environments-attachable.md` (the target model — read in full).
- Plan: `docs/issues/391/runtime-refactor/INDEX.md` § "Phase E1" (deliverables + exit criteria) and § "Rules" (rule 4: #416 landed contracts must not be redone).
- Plan: `docs/issues/391/runtime-refactor/architecture/08-pluggable-agent-surfaces.md` § "Multi-filesystem contract intersection" and § "Two handles".
- Landed #416 contracts you generalize (do not rewrite):
  - `packages/boring-bash/src/shared/index.ts` — `FilesystemId`, `FilesystemAccess`, `FilesystemBinding`, `BoundFilesystemContext`, `FilesystemBindingResolver`, `PreparedFilesystemBinding`, `FilesystemBindingProvider`, `RuntimeBindingPlan`.
  - `packages/boring-bash/src/server/runtimeBindingManager.ts` — `ScopedFilesystemRuntimeBindingManager`, `filesystemRuntimeScopeKey(ctx)`, `ScopedRuntimeBindingPlan`, `ScopedPreparedFilesystemBinding`, `PreparedBindingSelector`. The scope key today joins `humanUserId\0agentId\0sessionId\0workspaceId\0requestId`. E1 must not pass each HTTP request id into preparation: the new host lifetime owner supplies one stable preparation context per lifetime and keeps per-request authorization separate.
  - `packages/boring-bash/src/server/readonlyProjectionOperations.ts` — `createReadonlyProjectionOperations(handle)`, `ReadonlyProjectionOperations`, `ReadonlyProjectionHandle {filesystem, projectionRoot}`. Note `assertInsideProjection` already jails every op to `projectionRoot` — the scoped-view subpath jail rides this.
  - `packages/boring-bash/src/server/testing/readonlyProjectionConformance.ts` — `checkReadonlyProjectionConformance(subject)`, `ReadonlyProjectionConformanceSubject`.
  - `packages/boring-bash/src/server/testing/companyContextFixtureProvider.ts` — `FixtureCompanyContextBindingProvider`, `COMPANY_CONTEXT_FILESYSTEM_ID = "company_context"`, `COMPANY_CONTEXT_SENTINEL`.
  - Exports barrels: `packages/boring-bash/src/server/index.ts`, package exports `.`/`./shared`/`./server` in `packages/boring-bash/package.json`.
- Current operation-bearing bindings remain server/boring-bash implementation
  details during E1. Agent shared gains only methodless `ResolvedEnvironment`.
- Invariant scripts you must extend: `packages/boring-bash/scripts/check-invariants.mjs` (checks required exports `.`/`./shared`/`./server`); repo value-import audit `scripts/audit-imports.ts` (run via `pnpm audit:imports`); agent-side invariant tests `packages/agent/src/__tests__/invariants.test.ts` + `packages/agent/src/__tests__/invariants-script.test.ts`.
- Governance PRs (#476–#501, the #475 line) consume the landed shapes above. This bead is **additive/adapter only** — a governance consumer that imports `FilesystemBinding`/`FilesystemBindingResolver`/`ScopedFilesystemRuntimeBindingManager` must keep compiling and passing with zero source edits.

**Depends on: Phase 2 AND Phase 3.** E1 runs after both per [`../../INDEX.md`](../../INDEX.md) (`P2, P3`). Rationale: P3 creates the `createBashAgentFeature()` bundle; **E1 may re-implement that bundle's internals over environment attachments without changing its public `{ tools, readinessRequirements, systemPromptFragment }` signature**. E1 does not fork the bundle API — it generalizes what backs it.

Verified reality check (do not assume otherwise):
- E1 introduces attachment contracts and a host-side prepared view. Host
  composition flattens that view into the existing tools/readiness/prompt/input
  seams; there is no feature registry.
- Subagents are **not** a first-class code path in `packages/agent` today. A repo-wide search finds only a `pi-subagent` renderer key in `packages/agent/src/shared/tool-ui.ts`; there is no subagent/task tool, no `spawnSubagent`, no child-session attach seam in `packages/agent/src/server`. Encode the seam as a **new explicit contract**, not a modification of existing subagent plumbing (there is none).

## Goal / exit criteria

Match `INDEX.md` Phase E1 exit criteria:
1. Existing workspace + `company_context` behavior unchanged; governance consumers green (no edits to landed shapes).
2. A **scoped view** (`scope.subpath`) of an environment is attachable and physically jailed (BBE1-004/007). (The subagent-specific consumer of scoped views is deferred to Phase 7 — see the "Deferred to Phase 7" section.)
3. An agent can hold **two environments** with distinct `filesystem` identities simultaneously.
4. Agent core owns only methodless `ResolvedEnvironment[]` public facts.
   Operation-bearing prepared attachments remain host/boring-bash-owned and are
   flattened into existing injected core inputs.
5. Scoped-view no-leak conformance passes as a new mount of the existing suite.

## Non-negotiables

- Generalize, do not replace. New environment/attachment contracts wrap the
  landed shapes. No environment registry or second lifecycle. The existing
  scoped manager prepares host-owned views; company context remains the
  reference readonly attachment.
- Scoped views (`scope.subpath`) enforced **by the environment host** (physical projection root = `join(projectionRoot, subpath)`, reusing `ReadonlyProjectionHandle` jailing), never by consumer-side path filtering. `09` security invariant 2.
- `execPolicy` default is `'none'` for any non-`user` attachment (`09` security invariant 4). Readonly/`company_context` attachments never carry exec.
- **Type direction:** boring-bash may import the agent-owned methodless
  `ResolvedEnvironment` type only. Prepared attachment and operation types stay
  in boring-bash/server. Agent imports nothing from boring-bash.
- **Workspace-bound context is required for any attachment (`09` security invariant 5, non-negotiable).** Environment attachments (`company_context`, any governed fs, and the E2 MCP projection) REQUIRE a workspace-bound `BoundFilesystemContext` — `workspaceId` is real (locked #416, unchanged). A workspace-less / pure surface runs `runtime: 'none'` with **no attachments** until the host binds it to a workspace; `prepareAttachmentLifetime` is never called for a session with no `workspaceId`, and surfaces never synthesize one.
- Attachment is the only coupling: no implicit cwd inheritance for subagents. A subagent gets an environment only by an explicit `EnvironmentAttachment`.

## Do NOT

- Do NOT edit `FilesystemBinding`, `FilesystemBindingResolver`, `ScopedFilesystemRuntimeBindingManager`, or the conformance subject signatures. Wrap them. **Carve-out:** BBE1-004 may make implementation-only edits to `readonlyProjectionOperations.ts` to add realpath/lstat symlink containment; exported projection-operation signatures remain frozen.
- Do NOT add any boring-bash import to agent. Only methodless facts are
  agent-owned; operation-bearing contracts remain boring-bash-private.
- Do NOT build the Phase 3 `createBashAgentFeature()` public API or move routes/tools. Stop at attachments + `prepareAttachmentLifetime` + scoped-view enforcement. There is no registry in E1: P6-R owns the minimal host-only deployment-ref catalog and E2 consumes an injected lookup.
- Do NOT add a field to the landed manager contract. Introduce a separate
  `AttachmentLifetimeKey`/owner and adapt it to one stable preparation context;
  never use a live HTTP request id as attachment cache identity.
- Do NOT touch `/home/ubuntu/projects/boring-ui-v2`. Work on a dedicated branch/worktree per the PR-PLAN branch naming; never commit to main directly; every bead lands as a PR per INDEX.

## Beads

### BBE1-001 — Environment/attachment contracts, split across the two packages (S)
- Description: Add the `09` contracts as type-only shapes generalizing #416, respecting the single type-dependency direction (boring-bash → agent).
- Files: (a) create `packages/boring-bash/src/shared/environment.ts` for the **rich** types; re-export from `packages/boring-bash/src/shared/index.ts`. (b) extend `packages/agent/src/shared/runtime.ts` for the **minimal core-facing** types; `packages/agent/src/server/runtime/mode.ts` imports the operation-bearing binding types from there.
- Notes:
  - **In `boring-bash/shared` (rich, host-facing):** `Environment { id: string; provider: string; capabilities: EnvironmentCapabilities; }`. **Do not define a second provider-capability contract.** `EnvironmentCapabilities` is a **type-only alias/pick of `ProviderCapabilities` from `@hachej/boring-sandbox/shared`** (the authoritative home named by `02-boring-bash-environment.md`), e.g. `export type EnvironmentCapabilities = Pick<ProviderCapabilities, 'fs' | 'exec' | 'watch' | 'search' | 'realBash' | 'realBinaries' | 'networkIsolation'>` or the full `ProviderCapabilities` if the environment summary needs every fact. The facts stay the P2 matrix facts: `fs: 'none' | 'readonly' | 'readwrite'`, `exec`, `watch`, `search`, `realBash?: boolean | 'unknown'`, `realBinaries?: boolean | 'unknown'`, `networkIsolation?: 'none' | 'process' | 'container' | 'microvm' | 'provider' | 'unknown'`. `networkIsolation` is the **enum**, not a boolean; worker-dependent fields are `reported | 'unknown'` and consumers fail closed on `'unknown'` (02 "Worker-dependent capabilities are reported, not declared"). Do NOT re-model any of these as plain booleans or duplicate the enum/interface in boring-bash. `EnvironmentAttachment { environmentId: string; filesystem: FilesystemId; access: FilesystemAccess; scope?: { subpath?: string }; execPolicy: 'none' | 'attached' }`. Reuse `FilesystemId`/`FilesystemAccess` from `./index`.
  - `@hachej/boring-agent/shared` exports only methodless
    `ResolvedEnvironment`. `@hachej/boring-bash/server` owns
    `PreparedEnvironmentAttachment` and all binding/operation types.
- Tests: prepared types cannot be assigned to or imported from agent shared;
  public facts contain no methods/handles/paths to host-private roots.
- Acceptance: the host can flatten a prepared view into existing core inputs;
  the agent package has no operation-bearing environment contract.

### BBE1-002 — Host-owned, authorization-gated attachment lifetime (M)
- Description: one host-owned manager resolves explicit attachment entries once
  per declared runtime/session lifetime. Prepared objects stay in host/boring-
  bash; routes, tools, and UI share them. Core receives flattened inputs plus
  methodless facts. No new registry or competing lifecycle.
- Files: create `packages/boring-bash/src/server/attachmentLifetimeOwner.ts`
  and `prepareAttachmentLifetime.ts`; export from `packages/boring-bash/src/server/index.ts`.
- Notes: Define
  `AttachmentLifetimeKey { storageScopeId, subjectId, workspaceId, agentId,
  runtimeInstanceId, sessionId?, attachmentSetDigest }`.
  `attachmentSetDigest` hashes the sorted canonical selected entries (ref,
  environment identity/provider/facts, attachment policy, and host mount-path
  identity) without exposing those inputs. `prepareAttachmentLifetime`
  recomputes it and rejects a mismatch before cache lookup. Canonically encode
  the key without `requestId`. Define a separate authenticated
  request context and this only access primitive:
  ```ts
  AttachmentLifetimeOwner.withAuthorizedView<T>(
    requestContext: AuthenticatedAttachmentRequestContext,
    lifetimeKey: AttachmentLifetimeKey,
    fn: (lease: AuthorizedPreparedAttachmentView) => Promise<T>,
  ): Promise<T>

  prepareAttachmentLifetime(
    lifetimeKey: AttachmentLifetimeKey,
    owner: AttachmentLifetimeOwner,
    entries: Array<{ environment: Environment; attachment: EnvironmentAttachment; mountPath: string }>,
  ): Promise<{
    facts: ResolvedEnvironment[]
    contributions: AuthGatedEnvironmentContributions
  }>
  ```
  The owner wraps the landed scoped manager and adapts the lifetime key to one
  stable preparation context. Actual route/UI/tool requests retain their own
  request ids for auth/audit, but those ids never select or prepare a view.
  `AuthorizedPreparedAttachmentView` is a callback-scoped lease that rejects use
  after `fn` settles. The host passes entries and one lifetime owner. The adapter
  returns methodless facts plus tool/route/UI/prompt/input-asset contribution
  closures whose every operation calls `withAuthorizedView`; it never returns
  raw prepared attachments or lets a long-lived consumer capture a handle.
  Preparation/disposal stay on the manager, with one lifetime shared by tools/
  routes/UI. No address-by-id registry is added in E1; P6-R supplies explicit
  entries from its host-only deployment catalog.
- **`EnvironmentAttachment` → `FilesystemBinding` mapping rules (grounded in the LANDED `packages/boring-bash/src/shared/index.ts`: `FilesystemBinding = { filesystem, access, mountPath, projection }`). Write these as explicit bullet rules in the adapter source/doc-comment:**
  - `filesystem` ← `attachment.filesystem` (unchanged — the model-visible `FilesystemId`).
  - `access` ← `attachment.access` (unchanged — `FilesystemAccess`, `'readonly' | 'readwrite'`).
  - `projection` (E1 default map, no other combos): `access: 'readonly'` → `projection: 'policy-filtered'`; `access: 'readwrite'` → `projection: 'management'`. These are the two `FilesystemProjection` values landed; **an E1 attachment may not invent any other `access`/`projection` combination** (this matches the landed `FixtureCompanyContextBindingProvider`, which prepares exactly readonly-`policy-filtered` and readwrite-`management`).
  - `mountPath` ← the entry's `mountPath` (host-supplied per entry — the environment's configured mount for that `filesystem`, same pattern the landed `company_context` provider follows). The landed shapes define `mountPath: string` on `FilesystemBinding` but ship **no concrete default constant** (grep: `mountPath` is set nowhere in `packages/boring-bash/src`); the host therefore supplies it explicitly on each `entry` — the adapter reads `entry.mountPath` and does not synthesize a default.
  - `scope.subpath` alters the **prepared handle's jail** (realpath + symlink-denial rules, BBE1-004) WITHOUT changing the `filesystem` identity or the `mountPath` — it is a jailed child projection root, not a different filesystem.
- Tests: two requests with distinct request ids and UI/route/tool consumers
  reuse the same prepared view for one lifetime through separate authorized
  callbacks; unauthorized subject/request cannot enter the callback; a lease
  retained after callback settlement rejects; a different runtime/session
  lifetime or attachment set gets a different view; same scope with a mismatched
  entry digest rejects before reuse; invalidation rotates explicitly; eviction/
  failure/shutdown dispose once; facts and retained contributions contain no raw
  handle.
- Acceptance: two-environments-per-agent reduction passes; the reduction adds no lifecycle beyond the landed manager; **no `EnvironmentRegistry` class or id-lookup Map exists in E1** (P6-R owns the minimal deployment lookup).

### BBE1-003 — `company_context` as reference environment + readonly attachment (M)
- Description: Adapter re-expressing the landed company-context provider as an `Environment` + a readonly `EnvironmentAttachment` — no change to `FixtureCompanyContextBindingProvider`.
- Files: create `packages/boring-bash/src/server/companyContextEnvironment.ts`; export from server barrel.
- Notes: Build an `Environment { id: 'company_context', provider: 'fixture', capabilities: ... }` whose `capabilities` value satisfies the `EnvironmentCapabilities` alias/pick of `@hachej/boring-sandbox/shared` `ProviderCapabilities` (for the fixture: readonly fs, no exec, watch/search facts explicitly set per the P2 matrix), and a factory returning `EnvironmentAttachment { environmentId: 'company_context', filesystem: COMPANY_CONTEXT_FILESYSTEM_ID, access: 'readonly', execPolicy: 'none' }`. Preparation for it must route through the existing `FixtureCompanyContextBindingProvider` (or the real provider a host injects) via the `ScopedFilesystemRuntimeBindingManager` — no new registry — so `createReadonlyProjectionOperations` still backs reads. Assert `execPolicy: 'none'` (invariant 4).
- Tests: `packages/boring-bash/src/server/__tests__/companyContextEnvironment.test.ts` — resolving the reference attachment yields the same visible-path set as a direct `FixtureCompanyContextBindingProvider` prepare (behavioral equivalence with #416).
- Acceptance: existing `readonlyCompanyContext*` tests untouched and green; the adapter produces an equivalent projection.

### BBE1-004 — Scoped-view (subpath jail) enforcement in the host (M)
- Description: `scope.subpath` produces a jailed projection whose root is `join(baseProjectionRoot, subpath)`, enforced physically.
- Files: `packages/boring-bash/src/server/prepareAttachmentLifetime.ts` (scoped-root computation); add helper `scopedProjectionHandle(base: ReadonlyProjectionHandle, subpath?: string): ReadonlyProjectionHandle`.
- Notes: reuse current component-level symlink denial and containment. Audit it
  against scoped roots and add the explicit escape fixture; do not rewrite the
  implementation unless that fixture demonstrates a real gap.
- Tests: `packages/boring-bash/src/server/__tests__/scopedView.test.ts` — a subpath-scoped attachment cannot read a sibling outside the subpath (rejects); can read inside; a `../` subpath is rejected at construction. **Plus an explicit symlink-escape conformance test**: a symlink inside the projection/subpath pointing outside the jail is denied (read/list/stat all reject), proving containment is realpath-based, not lexical.
- Acceptance: scoped view cannot escape its subpath **including via symlink**; parent (unscoped) still sees the full tree; the symlink-escape test passes.

> **BBE1-005 (subagent attachment seam) is deferred to Phase 7** — see the "Deferred to Phase 7" section below. It is NOT v1 E1 scope.

### BBE1-006 — Agent-owned attached-runtime/facts core-facing types + invariant extension (S)
- Description: make agent shared own methodless `ResolvedEnvironment` only and
  prove it imports no boring-bash type/value. Prepared types remain in
  boring-bash/server.
- Files/tests: invariant forbids agent→boring-bash; type assertions prove facts
  have no operations, handles, or lifecycle methods.
- Acceptance: `pnpm audit:imports` green; `pnpm lint:invariants` green; agent typechecks against the agent-owned field with zero boring-bash imports.

### BBE1-007 — Scoped-view mount of the no-leak conformance suite (S)
- Description: Run `checkReadonlyProjectionConformance` against a scoped-view attachment as a new mount (fits `09`/`07` "one suite, N mounts" — the delivered mounts are in-process, scoped-view, and MCP; the remote-worker provider mount is deferred to BBP5-010, and its provider now lives in `@hachej/boring-sandbox/providers` post-P2). E1's environment code itself stays in `boring-bash/server` (attachments over the #416 binding manager); E1 does **not** import concrete providers.
- Files: `packages/boring-bash/src/server/__tests__/scopedViewConformance.test.ts`.
- Notes: Build a `ReadonlyProjectionConformanceSubject` whose operations invoke
  a scoped auth-gated contribution and enter `withAuthorizedView` over the
  landed manager. Reuse fixtures; denied siblings/sentinel stay absent.
- Tests: the file is the test.
- Acceptance: conformance `passed: true` for the scoped-view mount.

## Deferred to Phase 7 (first real subagent consumer) — NOT v1 E1 scope

Subagents are not a first-class code path in `packages/agent` today (see the Verified reality check: no subagent/task tool, no `spawnSubagent`, no child-session attach seam). Building a subagent attachment contract now would be a speculative abstraction with no consumer. Defer the following to **Phase 7 (multi-agent)**, when the first real subagent consumer exists:

### BBE1-005 (deferred) — Explicit subagent attachment seam (S)
- Description: Define the contract by which a subagent receives an environment — explicit attachment only, no cwd inheritance. Ships the **contract + reduction**, not harness wiring.
- Files: `packages/boring-bash/src/shared/environment.ts` (add `SubagentEnvironmentGrant { parentEnvironmentId: string; scope?: { subpath?: string }; access: FilesystemAccess }`); document the seam beside `prepareAttachmentLifetime.ts` as a `deriveSubagentAttachment(parent: EnvironmentAttachment, grant: SubagentEnvironmentGrant): EnvironmentAttachment` pure function.
- Notes: The derived attachment reuses the parent `environmentId`/`filesystem` (shared workspace) or adds `scope.subpath` (jailed view). It NEVER copies a cwd. `execPolicy` for a subagent grant defaults to `'none'`. The scope key already carries `agentId`, so a subagent with a distinct `agentId` gets an isolated prepared plan automatically.
- Tests: `packages/boring-bash/src/server/__tests__/subagentAttachment.test.ts` — derive a scoped-view grant from a parent, resolve for a subagent `ctx` (different `agentId`), assert it reads only within the subpath and shares no prepared handle with the parent.
- Acceptance (when scheduled): subagent scoped-view attachment resolves and is isolated by `agentId`.

## Explicitly deferred design note — readwrite company-context (#550 gap 4; Amendment 2026-07-06)

Design-only note, **no code bead**: v1 company-context rules are readonly-only projections, and E1 keeps that (readonly/`company_context` attachments never carry exec, and the E1 `access`/`projection` map allows only the two landed combinations). **Readwrite company-context grants need conflict/ownership semantics designed before any code** — who wins on concurrent writes, and how writes interact with the managed-workspace marker. That design is out of E1 scope and stays deferred; nothing in E1's `EnvironmentAttachment` contract may pre-commit readwrite company-context semantics.

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
