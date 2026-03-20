# Deferred Follow-On: Runtime Panels And `@boring/sdk`

## Status

Deferred follow-on note for later phases of the UI-platform program.

This document is not the active execution plan while Phase 1 is in progress. The
authoritative plan is
`docs/plans/ui-platform/PLAN_SHADCN_MIGRATION.md`.

Use this document only after Phase 1 has landed and the host app is already operating
on a stable shadcn-native primitive system.

---

## Why This Is Deferred

The runtime-panel system is valuable, but it has a different risk profile from the host
style-system migration:

- compiler policy and import rules
- artifact caching and serving
- loader failure behavior
- SDK surface design
- preview and diagnostics tooling
- operational hardening

Trying to build all of that while the host component system is still being migrated
creates too many moving parts at once.

---

## Entry Criteria

Do not reactivate this plan until all of the following are true:

1. Phase 1 host migration is stable.
2. The root-package CSS contract is documented and real.
3. The host app's primitive vocabulary is primarily shadcn-native.
4. The runtime direction is fixed around host-provided imports for `react`,
   `react/jsx-runtime`, `react-dom`, and `@boring/ui`.

---

## Later-Phase Sequence

### Phase 2: Runtime Seam Preparation

- define the minimal panel metadata contract
- define stable runtime shim boundaries
- make the runtime styling contract explicit
- move the loader away from direct `@workspace` source-path assumptions

### Phase 3: Minimal Backend Compilation

- discover panel entries
- compile to ESM on the backend
- cache by content hash
- surface visible compile and load failures

### Phase 4: Hardening

- richer `@boring/sdk` surface
- provider-based host bridge
- diagnostics and compatibility expansion
- preview harness and doctor workflow
- observability and performance budgets
- optional package extraction if the simpler root-package strategy proves insufficient

---

## Explicit Deferrals

The following are intentionally not Phase 1 work:

- queue-based long-lived Node worker architecture
- warm-context management
- worker health supervision
- broad runtime manifest and compatibility negotiation
- preview/doctor/observability program
- child-app canary and release hardening for the runtime path

Those may become justified later, but they should follow a working minimal runtime path,
not precede it.
