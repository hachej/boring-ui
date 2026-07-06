# E1-environment-attachments — Handoff checklist

Derived strictly from [TODO.md](./TODO.md) and [PLAN.md](./PLAN.md). Tick each before calling this package done. Invent nothing.

## Prerequisites (packages + gates)
- [ ] P2-sandbox-providers merged — [../P2-sandbox-providers/HANDOFF.md](../P2-sandbox-providers/HANDOFF.md)
- [ ] P3-routes-tools merged — [../P3-routes-tools/HANDOFF.md](../P3-routes-tools/HANDOFF.md)
- [ ] Landed #416 contracts present and unchanged (`FilesystemBinding`, `ScopedFilesystemRuntimeBindingManager`, projection operations, conformance subject, `FixtureCompanyContextBindingProvider`)

## Beads
- [ ] BBE1-001 — Environment/attachment contracts, split across the two packages
- [ ] BBE1-002 — `resolveAttachments` adapter over the scoped binding manager
- [ ] BBE1-003 — `company_context` as reference environment + readonly attachment
- [ ] BBE1-004 — Scoped-view (subpath jail) enforcement in the host
- [ ] BBE1-006 — Agent-owned `ResolvedEnvironments` core-facing type + invariant extension
- [ ] BBE1-007 — Scoped-view mount of the no-leak conformance suite
- [ ] BBE1-005 — Explicit subagent attachment seam — DEFERRED to Phase 7 (NOT E1 scope)

## Verification commands
- [ ] `pnpm --filter @hachej/boring-bash run build`
- [ ] `pnpm --filter @hachej/boring-bash run typecheck`
- [ ] `pnpm --filter @hachej/boring-bash run check:invariants`
- [ ] `pnpm --filter @hachej/boring-bash run test`
- [ ] `pnpm audit:imports`
- [ ] `pnpm lint:invariants`
- [ ] `pnpm --filter @hachej/boring-agent run typecheck`
- [ ] `pnpm run build:packages`
- [ ] `pnpm run test`

## PR-PLAN reconciliation
- [ ] `pr1-env-contracts` completed BBE1-001
- [ ] `pr2-resolve-attachments` completed BBE1-002
- [ ] `pr3-company-context-env` completed BBE1-003
- [ ] `pr4-scoped-view-jail` completed BBE1-004
- [ ] `pr5-agent-typeonly-conformance` completed BBE1-006 + BBE1-007
- [ ] BBE1-005 verified as deferred to Phase 7 / P7 `pr8-subagent-grant`, with no E1 implementation

## Review gates
- [ ] No diff to landed #416 type/class signatures (additions only via new files / re-exports, no edits to existing declarations). BBE1-004 may make implementation-only `readonlyProjectionOperations.ts` symlink-hardening edits; exported signatures stay frozen.
- [ ] Agent core has zero import (value **or** type) of `@hachej/boring-bash`; the only cross-package type edge is boring-bash → `@hachej/boring-agent` (audit green).
- [ ] Two-environments and scoped-view tests present and green (subagent attachment deferred to Phase 7).
- [ ] Scoped-view conformance is a distinct mount, not a fork of the suite.

## Exit criteria
- [ ] Existing workspace + `company_context` behavior unchanged; governance consumers green (no edits to landed shapes).
- [ ] A scoped view (`scope.subpath`) of an environment is attachable and physically jailed (BBE1-004/007), including via symlink escape.
- [ ] An agent can hold two environments with distinct `filesystem` identities simultaneously.
- [ ] Agent core owns the `ResolvedEnvironments` core-facing type and value/type-imports nothing from `@hachej/boring-bash` (invariant-checked).
- [ ] Scoped-view no-leak conformance passes as a new mount of the existing suite.

## Closeout
- [ ] Zero unowned `TODO(remove:*)` markers for this phase
- [ ] PRs merged per [PR-PLAN.md](../../PR-PLAN.md) (this package's section)
