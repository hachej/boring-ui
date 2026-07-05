# E1-environment-attachments — Plan

> Phase: Phase E1 — Environment attachments (after Phase 2 AND Phase 3) · Work order: [TODO.md](./TODO.md) · Handoff: [HANDOFF.md](./HANDOFF.md)
> Ordering authority: [INDEX.md](../../INDEX.md) · Vision: [VISION.md](../../VISION.md)

## Governing architecture
- [09-environments-attachable.md](../../architecture/09-environments-attachable.md) — the target model: environments as attachable resources, scoped views, and the one-suite/N-mounts no-leak contract E1 extends.

## Design context

E1 generalizes the landed #416 filesystem-binding model into `Environment` /
`EnvironmentAttachment` / `ResolvedEnvironments` contracts without rewriting the
landed shapes. It runs after Phase 2 (sandbox providers/capability facts) **and**
Phase 3 (the host-composed bash bundle): E1 may re-implement that bundle's
internals over attachments **without changing its public `{ tools, readinessRequirements, systemPromptFragment }`
signature**. The core stays runtime-free — the agent package owns the minimal
core-facing `ResolvedEnvironments` (`{ bindings: RuntimeFilesystemBinding[] }`)
and value/type-imports nothing from boring-bash; the only cross-package type edge
is boring-bash → agent. There is **no `EnvironmentRegistry` class and no new
prepare/dispose lifecycle**: a thin `resolveAttachments` adapter reduces
attachments to `FilesystemBinding[]` over the landed `ScopedFilesystemRuntimeBindingManager`.
Address-by-id lookup (a plain `Map<environmentId, Environment>`) is deferred to E2.
Subagent attachment (BBE1-005) is deferred to Phase 7, the first real subagent consumer.

## Verified current repo reality (pre-E1)
- The landed #416 types exist in `packages/boring-bash/src/shared/index.ts`: `FilesystemId`, `FilesystemAccess`, `FilesystemProjection`, `FilesystemBinding`, `BoundFilesystemContext`, `FilesystemBindingResolver`, `PreparedFilesystemBinding`, `FilesystemBindingProvider`, and `RuntimeBindingPlan`.
- `packages/boring-bash/src/server/runtimeBindingManager.ts` exports `ScopedFilesystemRuntimeBindingManager`, `filesystemRuntimeScopeKey(ctx)`, `PreparedBindingSelector`, `ScopedPreparedFilesystemBinding`, and `ScopedRuntimeBindingPlan`. The scope key is `humanUserId\0agentId\0sessionId\0workspaceId\0requestId`.
- `packages/boring-bash/src/server/readonlyProjectionOperations.ts` currently jails paths lexically with `resolve()`/`relative()`; E1's realpath/lstat symlink hardening is a real implementation change, but exported projection-operation signatures stay frozen.
- `packages/agent/src/server/runtime/mode.ts` currently owns `RuntimeFilesystemBindingOperations`, `RuntimeFilesystemBinding`, and `RuntimeBundle.filesystemBindings`. There is no existing agent shared home for those operation-bearing binding contracts, so E1 extends the existing front-safe `packages/agent/src/shared/runtime.ts` and repoints `server/runtime/mode.ts`.
- `packages/agent/src/shared/session.ts` currently requires `SessionCtx.workspaceId: string`; P1 makes it optional for pure sessions, but E1 environment attachments still require a real workspace-bound `BoundFilesystemContext.workspaceId`.

## Deliverables
- `Environment` / `EnvironmentAttachment` contracts in boring-bash, and the minimal core-facing `ResolvedEnvironments` contract in agent shared (generalizing, not replacing, the landed #416 binding shapes); `company_context` re-expressed as the reference environment + readonly attachment.
- Scoped views (`scope.subpath`) enforced by the environment host — no cwd inheritance. (The subagent attachment seam that consumes scoped views is deferred to Phase 7, the first real subagent consumer.)
- agent core sees `ResolvedEnvironments` type-only (invariant-checked).
- A thin `resolveAttachments` adapter reduces attachments to the existing #416 `FilesystemBinding[]` via the landed `ScopedFilesystemRuntimeBindingManager` — no `EnvironmentRegistry` class and no new prepare/dispose lifecycle. Address-by-id lookup (a plain `Map<environmentId, Environment>`) is deferred to E2, where the MCP projection needs it.
- Environment conformance suite extended to scoped-view attachments.

## Exit criteria
- Existing workspace + company_context behavior unchanged (governance consumers green).
- A scoped view of an environment can be attached and is physically jailed (subagent consumer deferred to Phase 7).
- An agent can hold two environments with distinct `filesystem` identities.
