# P8-verification — Handoff checklist

Derived strictly from [TODO.md](./TODO.md) and [PLAN.md](./PLAN.md). Tick each before calling this package done. Invent nothing.

## Prerequisites (packages + gates)
P8 gates only the v1 set: P1, T1/T2, P2/P3, E1, P5a, P6-D/P6-R,
A1, and D1. Post-v1 lanes are tracked but not awaited.
- [ ] P1-headless-core merged — [../P1-headless-core/HANDOFF.md](../P1-headless-core/HANDOFF.md)
- [ ] T1-durable-events merged — [../T1-durable-events/HANDOFF.md](../T1-durable-events/HANDOFF.md)
- [ ] T2-transport merged — [../T2-transport/HANDOFF.md](../T2-transport/HANDOFF.md)
- [ ] P2-sandbox-providers merged — [../P2-sandbox-providers/HANDOFF.md](../P2-sandbox-providers/HANDOFF.md)
- [ ] P3-routes-tools merged — [../P3-routes-tools/HANDOFF.md](../P3-routes-tools/HANDOFF.md)
- [ ] E1-environment-attachments merged — [../E1-environment-attachments/HANDOFF.md](../E1-environment-attachments/HANDOFF.md)
- [ ] P5a v1 beads merged — [../P5-provisioning-secrets/P5A-HANDOFF.md](../P5-provisioning-secrets/P5A-HANDOFF.md) (do not wait for P5b)
- [ ] P6-D/P6-R v1 beads merged — [../P6-plugin-child-app/P6-V1-HANDOFF.md](../P6-plugin-child-app/P6-V1-HANDOFF.md) (do not wait for plugin/P6b expansion)
- [ ] A1-agent-authoring merged — [../A1-agent-authoring/HANDOFF.md](../A1-agent-authoring/HANDOFF.md)
- [ ] If M1/R0 exists on main, A1 BBA1-003 removed duplicate behavior config;
      only proven absence skips this gate.
- [ ] D1 dedicated delivery merged — [../D1-tenant-provisioning/HANDOFF.md](../D1-tenant-provisioning/HANDOFF.md)
- [ ] Do NOT land while any earlier phase's `TODO(remove:*)` marker is still live — a surviving marker reopens the phase of its named deletion-bead owner (do not absorb it here)
- [ ] P4/E2/X1/P5b/P6 expansion/P7/M2/D2/S3/S4 are explicitly post-v1.

## Owner questions / verdict
- OWNER-QUESTIONS: none.
- GO/NO-GO: GO only after every v1 prerequisite and the timed product proof; NO-GO if a v1 gate/marker/import boundary is unresolved.

## Beads
- [ ] BBP8-001 — Repo-wide `TODO(remove:*)` marker gate (zero-tolerance)
- [ ] BBP8-002 — Document the four-part surface contract as stable public API
- [ ] BBP8-003 — Old-moved-path import gates for delivered v1 relocations (P2/P3/T1/T2)
- [ ] BBP8-004 — Convert remaining plan prose into tracked beads/issues
- [ ] BBP8-006 — Execute and record the v1 agent-factory golden path
- [ ] BBP8-005 — Final invariant + build/test sweep

## Verification commands
- [ ] `pnpm lint:invariants`
- [ ] `pnpm audit:imports`
- [ ] `node scripts/check-no-remove-markers.mjs` (after BBP8-001 creates/wires it)
- [ ] `pnpm --filter @hachej/boring-ui-cli run smoke:agent-factory-v1 -- <preconfigured-host-profile>`
- [ ] `pnpm --filter @hachej/boring-bash run check:invariants`
- [ ] `pnpm --filter @hachej/boring-workspace run lint:plugin-invariants`
- [ ] `pnpm --filter @hachej/boring-agent run lint:invariants`
- [ ] `pnpm --filter @hachej/boring-agent run check:isolation`
- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `! rg -n -U "import\\s*\\{[^}]*\\b(resolveMode|autoDetectMode|hasBwrap|createDirectSandbox|createBwrapSandbox|createRemoteWorkerModeAdapter|createRemoteWorkerSandbox|createVercelSandboxWorkspace)\\b[^}]*\\}\\s*from\\s*['\"]@hachej/boring-agent/server['\"]" packages apps plugins -g '!**/*.md'`
- [ ] `! rg -n "ask-user\\.v1\\." packages apps plugins -g '!**/*.md'`
- [ ] `! rg -n "\\?cursor=|schedulePiChatReconnect|replay_gap|PiChatReplayBuffer" packages apps plugins -g '!**/*.md'`

## PR-PLAN reconciliation
- [ ] `pr1-marker-import-gates` completed BBP8-001 + BBP8-003
- [ ] `pr2-surface-contract-docs` completed BBP8-002
- [ ] `pr3-golden-path-and-followups` completed BBP8-006 + BBP8-004
- [ ] BBP8-005 completed as the final stack merge gate, not a separate PR; any red gate reopened its owning phase

## Review gates
- [ ] `pnpm lint:invariants` runs the `TODO(remove:*)` gate; the repo has **zero** markers; a planted marker fails the gate and names its owning bead.
- [ ] No surviving marker was "absorbed" into a P8 cleanup bead — any live marker reopened its owning phase instead.
- [ ] Four-part surface contract + `createAgent()` documented as stable public API; referenced symbols exist.
- [ ] Every delivered P2/P3/T1/T2 relocation import gate present and green; no old-path importer.
- [ ] P3 BBP3-019 proves pure mode registers no filesystem UI/providers/renderers
      and makes no related API calls; P4 relocation is not required.
- [ ] Every deferred/un-beaded plan task filed as a tracked issue/bead; `00` coverage posture reconciled (no overclaim).
- [ ] Golden-path evidence records <=900 seconds, zero source edits, remote
      materialization, definition/deployment/resolved digests, no-op reapply,
      desired-state digest, append-only generation/current pointer behavior,
      complete new-generation rollback, and secret-canary absence.
- [ ] The golden path used the real EU runsc/systrap target through pinned-HTTPS
      worker authentication and proved stale-generation provider fencing; fake
      provider evidence is supplemental only.
- [ ] Full `pnpm typecheck` + `pnpm test` + `pnpm audit:imports` green; all `00` invariants hold; #416 contracts + JSONL session compat untouched.

## Exit criteria
- [ ] Zero `TODO(remove:*)` markers repo-wide, asserted by a check wired into `pnpm lint:invariants` (fails CI if any marker survives).
- [ ] `@hachej/boring-agent` package docs document the four-part surface contract (08) + the `createAgent()` public runtime API as the stable public surface.
- [ ] Post-v1 P4/E2/X1/P5b/P6 expansion/P7/M2/D2/S3/S4 remain explicitly tracked.
- [ ] No code imports old moved paths for delivered v1 relocations.
- [ ] Existing workspace filesystem UI is capability-gated with zero pure-mode
      residue; ownership relocation remains post-v1 P4.
- [ ] Executable v1 product proof is recorded; component/invariant results alone
      do not close P8.
- [ ] All `00` invariants + package invariant scripts + `audit:imports` green; full build+test green.

## Closeout
- [ ] Zero unowned `TODO(remove:*)` markers for this phase (and zero markers repo-wide)
- [ ] `@hachej/boring-agent` README documents the four-part surface contract
- [ ] PRs merged per [PR-PLAN.md](../../PR-PLAN.md) (this package's section)
