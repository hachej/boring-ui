# P8-verification — Handoff checklist

Derived strictly from [TODO.md](./TODO.md) and [PLAN.md](./PLAN.md). Tick each before calling this package done. Invent nothing.

## Prerequisites (packages + gates)
P8 gates on every prior lane EXCEPT P6b. Each lane lead must be merged:
- [ ] P1-headless-core merged — [../P1-headless-core/HANDOFF.md](../P1-headless-core/HANDOFF.md)
- [ ] T2-transport merged — [../T2-transport/HANDOFF.md](../T2-transport/HANDOFF.md)
- [ ] P4-file-ui merged — [../P4-file-ui/HANDOFF.md](../P4-file-ui/HANDOFF.md)
- [ ] E2-mcp-projection merged — [../E2-mcp-projection/HANDOFF.md](../E2-mcp-projection/HANDOFF.md)
- [ ] X1-s3-fuse-mounts merged — [../X1-s3-fuse-mounts/HANDOFF.md](../X1-s3-fuse-mounts/HANDOFF.md)
- [ ] P5-provisioning-secrets merged — [../P5-provisioning-secrets/HANDOFF.md](../P5-provisioning-secrets/HANDOFF.md)
- [ ] P7-multi-agent-inspection merged — [../P7-multi-agent-inspection/HANDOFF.md](../P7-multi-agent-inspection/HANDOFF.md)
- [ ] S2-embed-contract merged — [../S2-embed-contract/HANDOFF.md](../S2-embed-contract/HANDOFF.md)
- [ ] S3-control-plane-ux merged — [../S3-control-plane-ux/HANDOFF.md](../S3-control-plane-ux/HANDOFF.md)
- [ ] Do NOT land while any earlier phase's `TODO(remove:*)` marker is still live — a surviving marker reopens the phase of its named deletion-bead owner (do not absorb it here)
- [ ] P6b is explicitly NOT a P8 gate — verify only that the P6b follow-up issue is filed; never wait on P6b landing

## Beads
- [ ] BBP8-001 — Repo-wide `TODO(remove:*)` marker gate (zero-tolerance)
- [ ] BBP8-002 — Document the four-part surface contract as stable public API
- [ ] BBP8-003 — Old-moved-path import gates (P2/P3/P4/T1/T2 relocations)
- [ ] BBP8-004 — Convert remaining plan prose into tracked beads/issues
- [ ] BBP8-005 — Final invariant + build/test sweep

## Verification commands
- [ ] `pnpm lint:invariants`
- [ ] `pnpm audit:imports`
- [ ] `node scripts/check-no-remove-markers.mjs`
- [ ] `pnpm --filter @hachej/boring-bash run check:invariants`
- [ ] `pnpm --filter @hachej/boring-workspace run lint:plugin-invariants`
- [ ] `pnpm --filter @hachej/boring-agent run lint:invariants`
- [ ] `pnpm --filter @hachej/boring-agent run check:isolation`
- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `grep -rn "from '@hachej/boring-agent/server'" packages apps plugins | grep -E "resolveMode|createDirectSandbox|createBwrapSandbox|createVercelSandboxWorkspace" || echo "clean"`
- [ ] `grep -rn "ask-user.v1." packages plugins apps | grep -v docs || echo "clean"`

## Review gates
- [ ] `pnpm lint:invariants` runs the `TODO(remove:*)` gate; the repo has **zero** markers; a planted marker fails the gate and names its owning bead.
- [ ] No surviving marker was "absorbed" into a P8 cleanup bead — any live marker reopened its owning phase instead.
- [ ] Four-part surface contract + `createAgent()` documented as stable public API; referenced symbols exist.
- [ ] Every P2/P3/P4/T1/T2 relocation import gate present and green; no old-path importer.
- [ ] Every deferred/un-beaded plan task filed as a tracked issue/bead; `00` coverage posture reconciled (no overclaim).
- [ ] Full `pnpm typecheck` + `pnpm test` + `pnpm audit:imports` green; all `00` invariants hold; #416 contracts + JSONL session compat untouched.

## Exit criteria
- [ ] Zero `TODO(remove:*)` markers repo-wide, asserted by a check wired into `pnpm lint:invariants` (fails CI if any marker survives).
- [ ] `@hachej/boring-agent` package docs document the four-part surface contract (08) + the `createAgent()` public runtime API as the stable public surface.
- [ ] Remaining plan tasks converted into tracked beads/issues — nothing left only in prose; the P6b follow-up issue is filed.
- [ ] No code imports old moved paths (grep gates green for every relocation in P2/P3/P4/T1/T2).
- [ ] All `00` invariants + package invariant scripts + `audit:imports` green; full build+test green.

## Closeout
- [ ] Zero unowned `TODO(remove:*)` markers for this phase (and zero markers repo-wide)
- [ ] `@hachej/boring-agent` README documents the four-part surface contract
- [ ] PRs merged per [PR-PLAN.md](../../PR-PLAN.md) (this package's section)
