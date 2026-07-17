> **Work-package status:** retained research and non-dispatchable until this
> child issue’s canonical plan and Bead graph are recut under Decision 26.
> Stale readiness, Decision 25 P0→N1, and AgentHost/D1 passages have no authority.

# E1-environment-attachments — Plan

> **Post-v1 work order (2026-07-10).** Generic attachable environments are not
> a v1 gate. V1 uses the current authorized workspace/runtime composition and
> implements only the D1/runsc facts it actually consumes. Retain the contracts
> below as future design; do not dispatch E1 to unblock A1 or P6-R.
> Every pure/no-environment, `runtime: 'none'`, or workspace-less clause below
> is void historical text. Reopening E1 requires a named second attachment
> consumer and a new decision/re-specification; v1 does not define an empty-
> attachment mode.

## Historical ownership design (non-dispatchable for v1)

Prepared operation-bearing attachments remain host/boring-bash objects. One
host-owned `ScopedFilesystemRuntimeBindingManager` prepares each attachment once
for its declared runtime/session lifetime, and tools, routes, and UI share that
prepared view. The agent core receives only flattened tools/prompt/readiness/
input-asset handling plus methodless `ResolvedEnvironment[]` facts. It never
receives raw exec/filesystem handles or provider disposal authority.

The lifetime key is stable across requests and excludes `requestId`. Request
authentication/authorization is enforced by
`AttachmentLifetimeOwner.withAuthorizedView(requestContext, lifetimeKey, fn)`
for every operation. The callback lease is invalid after `fn` settles. Long-
lived consumers receive auth-gated contribution closures and methodless facts,
never reusable prepared handles.

> Phase: Phase E1 — Environment attachments (after Phase 2 AND Phase 3) · Work order: [TODO.md](TODO.md) · Handoff: [HANDOFF.md](HANDOFF.md)
> Ordering authority: [INDEX.md](../../../../391/runtime-refactor/INDEX.md) · Vision: [VISION.md](../../../../391/runtime-refactor/VISION.md)

## Governing architecture
- [09-environments-attachable.md](../../../../391/runtime-refactor/architecture/09-environments-attachable.md) — the target model: environments as attachable resources, scoped views, and the one-suite/N-mounts no-leak contract E1 extends.

## Design context

E1 generalizes the landed #416 filesystem-binding model into `Environment` /
`EnvironmentAttachment`, host-owned prepared attachments, and agent-owned
methodless `ResolvedEnvironment[]` facts without rewriting the landed shapes. It runs after Phase 2 (sandbox providers/capability facts) **and**
Phase 3 (the host-composed bash bundle): E1 may re-implement that bundle's
internals over attachments **without changing its public `{ tools, readinessRequirements, systemPromptFragment }`
signature**. The core stays runtime-free: the agent package owns only methodless
facts and value/type-imports nothing from boring-bash. Prepared operations and
lifecycle remain host/boring-bash-owned. The only cross-package type edge is
boring-bash → agent. There is **no `EnvironmentRegistry` class and no new
prepare/dispose lifecycle**: `prepareAttachmentLifetime` builds auth-gated
contributions over the landed `ScopedFilesystemRuntimeBindingManager`.
E1 takes explicit entries and adds no lookup. P6-R owns the minimal host-only
deployment-ref catalog required by A1/D1; E2 consumes an injected lookup rather
than creating another store.
Subagent attachment (BBE1-005) is deferred to Phase 7, the first real subagent consumer.

**Amendment (2026-07-06):** there is no `bindingResolver` composition point today —
governance owns its own `ScopedFilesystemRuntimeBindingManager`
(`plugins/boring-governance/src/server/filesystemBindings.ts`) and returns
operation-bearing `RuntimeFilesystemBinding`s through the agent's
`getFilesystemBindings` option. `prepareAttachmentLifetime` takes host-supplied
`{manager, entries}`; governance is a valid host supplier only if it can pass its
internal manager without source edits (the zero-source-edit guarantee). If it
cannot, governance adoption of `prepareAttachmentLifetime` is a separate later
governance-side bead — E1 must not force it.

## Verified current repo reality (pre-E1)
- The landed #416 types exist in `packages/boring-bash/src/shared/index.ts`: `FilesystemId`, `FilesystemAccess`, `FilesystemProjection`, `FilesystemBinding`, `BoundFilesystemContext`, `FilesystemBindingResolver`, `PreparedFilesystemBinding`, `FilesystemBindingProvider`, and `RuntimeBindingPlan`.
- `packages/boring-bash/src/server/runtimeBindingManager.ts` exports `ScopedFilesystemRuntimeBindingManager`, `filesystemRuntimeScopeKey(ctx)`, `PreparedBindingSelector`, `ScopedPreparedFilesystemBinding`, and `ScopedRuntimeBindingPlan`. The scope key is `humanUserId\0agentId\0sessionId\0workspaceId\0requestId`.
- `readonlyProjectionOperations.ts` already performs component-level symlink
  denial and containment on current main. E1 verifies and extends the existing
  tests; it changes implementation only if a concrete uncovered escape exists.
- `packages/agent/src/server/runtime/mode.ts` currently owns `RuntimeFilesystemBindingOperations`, `RuntimeFilesystemBinding`, and `RuntimeBundle.filesystemBindings`. There is no existing agent shared home for those operation-bearing binding contracts, so E1 extends the existing front-safe `packages/agent/src/shared/runtime.ts` and repoints `server/runtime/mode.ts`.
- `packages/agent/src/shared/session.ts` currently requires `SessionCtx.workspaceId: string`; P1 makes it optional for pure sessions, but E1 environment attachments still require a real workspace-bound `BoundFilesystemContext.workspaceId`.

## Deliverables
- `Environment` / `EnvironmentAttachment` and prepared runtime contracts in
  boring-bash, with only minimal `ResolvedEnvironment[]` facts in agent shared;
  `company_context` is the reference readonly attachment.
- Scoped views (`scope.subpath`) enforced by the environment host — no cwd inheritance. (The subagent attachment seam that consumes scoped views is deferred to Phase 7, the first real subagent consumer.)
- host composition consumes prepared attachments and supplies flattened core
  inputs; agent core sees only `ResolvedEnvironment[]` facts.
- A thin adapter prepares through the landed manager — no registry class and no
  competing lifecycle. Address-by-id lookup remains deferred until a real
  consumer needs it.
- A host `AttachmentLifetimeOwner` separates stable prepare/cache identity from
  per-request authorization, exposes only callback-scoped authorized leases,
  and disposes each lifetime exactly once.
- Environment conformance suite extended to scoped-view attachments.

## Exit criteria
- Existing workspace + company_context behavior unchanged (governance consumers green).
- A scoped view of an environment can be attached and is physically jailed (subagent consumer deferred to Phase 7).
- An agent can hold two environments with distinct `filesystem` identities.
- Tools, routes, UI, and input-asset handlers can retain only auth-gated
  contributions; every operation re-authorizes and no prepared handle escapes a
  callback lease.
