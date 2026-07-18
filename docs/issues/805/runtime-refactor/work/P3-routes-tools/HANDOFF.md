> **Work-package status:** retained research and non-dispatchable until this
> child issue’s canonical plan and Bead graph are recut under Decision 26.
> Stale readiness, Decision 25 P0→N1, and AgentHost/D1 passages have no authority.

# P3-routes-tools — Handoff checklist

> **Post-v1 historical checklist (2026-07-10).** This file is non-dispatchable
> and does not gate P8. Every `runtime: 'none'`, pure, pure-only-bin, or
> workspace-less clause below is void. Reopen P3 only for a named second package
> consumer through a new decision and rewritten handoff.

Derived strictly from [TODO.md](TODO.md) and [PLAN.md](PLAN.md). Tick each before calling this package done. Invent nothing.

## Prerequisites (packages + gates)
- [ ] P2-sandbox-providers merged — [../P2-sandbox-providers/HANDOFF.md](../../../../808/runtime-refactor/work/P2-sandbox-providers/HANDOFF.md)
- [ ] Phase 1 (`createAgent()` with injected `tools`/runtime — no `features` param) + Phase 2 (providers moved) confirmed present — **STOP and report** the Phase-1 gap if the injected `tools`/runtime seam is not threaded through `createAgentApp`/`registerAgentRoutes` (do not hardwire)

## Beads
- [ ] BBP3-010 — Add `/agent` subpath + `createBashAgentFeature()` skeleton
- [ ] BBP3-011 — Move filesystem tools to `boring-bash/agent`
- [ ] BBP3-012 — Move bash + `execute_isolated_code` tools
- [ ] BBP3-013 — Move upload/artifact tool + decide ownership
- [ ] BBP3-014 — Move file/tree/search/fs-events/git routes to `boring-bash/server`
- [ ] BBP3-015 — Register boring-bash server plugin in workspace-family hosts; keep library wiring for direct composers
- [ ] BBP3-016 — Route + tool source-of-truth regression tests
- [ ] BBP3-017 — Extend invariants for the routes/tools boundary
- [ ] BBP3-018 — Dedicated `MODEL_NOT_ALLOWED` 403 error code in agent shared (#550 gap 3; Amendment 2026-07-06)
- [ ] BBP3-019 — Capability-gate the existing workspace filesystem front plugin
- [ ] BBP3-020 — Atomically project each trusted v1 default-agent plugin from
      one verified boot-time server record; disable/pre-registration failure
      leaves zero server/prompt residue; browser failure preserves prior UI;
      immutable host-app/plugin activation-input snapshot emitted for D1; D1
      mounts only `scopedRoutes` over bound Workspace/scoped repositories and
      rejects raw `routes`, including indirect foreign session/project fixtures

## Verification commands
- [ ] `pnpm --filter @hachej/boring-bash run build`
- [ ] `pnpm --filter @hachej/boring-bash run typecheck`
- [ ] `pnpm --filter @hachej/boring-bash run test`
- [ ] `pnpm --filter @hachej/boring-bash run check:invariants`
- [ ] `pnpm --filter @hachej/boring-agent run build`
- [ ] `pnpm --filter @hachej/boring-agent run typecheck`
- [ ] `pnpm --filter @hachej/boring-agent run test`
- [ ] `pnpm --filter @hachej/boring-agent run test:e2e`
- [ ] `pnpm --filter @hachej/boring-agent run lint:invariants`
- [ ] `pnpm --filter @hachej/boring-agent run check:isolation`
- [ ] `pnpm --filter workspace-playground run test:e2e`
- [ ] `pnpm lint:invariants`
- [ ] `pnpm audit:imports`
- [ ] `pnpm typecheck`
- [ ] Manual behavior proof (workspace playground): open file tree + editor, run read/write/edit/find/grep/ls/bash. See run-workspace-playground recipe; rebuild dist first.

## PR-PLAN reconciliation
- [ ] `pr1-agent-subpath-feature` completed BBP3-010
- [ ] `pr2-move-filesystem-tools` completed BBP3-011
- [ ] `pr3-move-bash-upload` completed BBP3-012 + BBP3-013
- [ ] `pr4-move-fs-git-routes` completed BBP3-014
- [ ] `pr5-wire-composition` completed BBP3-015 (workspace-family hosts through server plugin; direct composers through library mode only where the plugin pipeline is absent)
- [ ] `pr6-sot-tests-invariants` completed BBP3-016 + BBP3-017 + BBP3-018 (folded; Amendment 2026-07-06)
- [ ] `pr7-capability-gate-filesystem-ui` completed BBP3-019
- [ ] `pr8-atomic-default-plugin-contribution` completed BBP3-020

## Review gates
- [ ] Phase 1 (`createAgent()` with injected `tools`/runtime — no `features` param) + Phase 2 (providers moved) confirmed present, else STOP+report.
- [ ] Behavior-freeze verified: tool names/schemas/prompt snippets/readiness tags/error codes unchanged; renderer snapshots unchanged.
- [ ] `disableDefaultFileTools` parity test passes; pure mode has zero file routes/tools.
- [ ] Pure mode has zero filesystem plugin/provider/renderer registration and
      zero file/tree/search/upload UI API calls.
- [ ] Trusted plugin tool/route/Pi prompt+resources/front contributions come
      from one verified boot-time server record; scan-only/disabled/pre-
      registration-failed plugins contribute no server/prompt residue. Browser
      failure preserves previous-good UI. Snapshot digest covers immutable
      host-app/source/manifest, canonical redacted activation inputs, and
      ordered contribution metadata; mutable/non-reconstructible D1 sources
      reject. No per-agent refs/requirements were pulled into v1.
- [ ] `(filesystem, path)` param + spoof guard + readonly `rejectMutation` preserved verbatim; company_context no-leak conformance green.
- [ ] Single source-of-truth regression tests pass; no second storage-root resolver introduced.
- [ ] `pnpm lint:invariants` + `pnpm audit:imports` green; zero agent→bash value imports; no static `packages/workspace/src` import from `@hachej/boring-bash`.

## Exit criteria
- [ ] workspace playground still opens file tree/editor; read/write/edit/find/grep/ls/bash work when boring-bash enabled.
- [ ] pure mode (`createAgent({ runtime: 'none' })`) registers none of these routes/tools.
- [ ] company_context no-leak conformance still green.
- [ ] `(filesystem, path)` addressing + readonly enforcement identical to #416.
- [ ] Existing filesystem UI stays workspace-owned and capable workspaces retain
      behavior; P4 remains a post-v1 relocation.
- [ ] Trusted workspace plugins activate atomically for the v1 `default` agent;
      per-agent plugin composition remains post-v1 P6.
- [ ] **Amendment (2026-07-06) — UI/agent parity:** both surfaces still resolve visibility through the SINGLE `getFilesystemBindings` decision path; grep-gate proves no second "what can this user see" path exists.
- [ ] **Amendment (2026-07-06) — published package:** moved routes/tools land as ADDITIVE export entries (`./agent`) in the same cohort bump as any governance-consumed `/server` change.

## Closeout
- [ ] Zero unowned `TODO(remove:*)` markers for this phase
- [ ] PRs merged per [PR-PLAN.md](../../../../391/runtime-refactor/PR-PLAN.md) (this package's section)
