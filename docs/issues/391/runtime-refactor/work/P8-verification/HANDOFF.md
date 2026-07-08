# P8-verification — Handoff checklist

Derived strictly from [TODO.md](./TODO.md) and [PLAN.md](./PLAN.md). Tick each before calling this package done. Invent nothing.

## Prerequisites (packages + gates)
P8 gates on every delivered runtime phase EXCEPT P6b, M1, M2, D1, and S4; M2 may land after P8 as a committed follow-up. Each runtime package below must be merged:
- [ ] P1-headless-core merged — [../P1-headless-core/HANDOFF.md](../P1-headless-core/HANDOFF.md)
- [ ] T1-durable-events merged — [../T1-durable-events/HANDOFF.md](../T1-durable-events/HANDOFF.md)
- [ ] T2-transport merged — [../T2-transport/HANDOFF.md](../T2-transport/HANDOFF.md)
- [ ] P2-sandbox-providers merged — [../P2-sandbox-providers/HANDOFF.md](../P2-sandbox-providers/HANDOFF.md)
- [ ] P3-routes-tools merged — [../P3-routes-tools/HANDOFF.md](../P3-routes-tools/HANDOFF.md)
- [ ] P4-file-ui merged — [../P4-file-ui/HANDOFF.md](../P4-file-ui/HANDOFF.md)
- [ ] E1-environment-attachments merged — [../E1-environment-attachments/HANDOFF.md](../E1-environment-attachments/HANDOFF.md)
- [ ] E2-mcp-projection merged — [../E2-mcp-projection/HANDOFF.md](../E2-mcp-projection/HANDOFF.md)
- [ ] X1-s3-fuse-mounts merged — [../X1-s3-fuse-mounts/HANDOFF.md](../X1-s3-fuse-mounts/HANDOFF.md)
- [ ] P5-provisioning-secrets merged — [../P5-provisioning-secrets/HANDOFF.md](../P5-provisioning-secrets/HANDOFF.md)
- [ ] P6-plugin-child-app P6a merged — [../P6-plugin-child-app/HANDOFF.md](../P6-plugin-child-app/HANDOFF.md)
- [ ] P7-multi-agent-inspection merged — [../P7-multi-agent-inspection/HANDOFF.md](../P7-multi-agent-inspection/HANDOFF.md)
- [ ] S1-slack-channel merged — [../S1-slack-channel/HANDOFF.md](../S1-slack-channel/HANDOFF.md)
- [ ] S2-embed-contract merged — [../S2-embed-contract/HANDOFF.md](../S2-embed-contract/HANDOFF.md)
- [ ] S3-control-plane-ux merged — [../S3-control-plane-ux/HANDOFF.md](../S3-control-plane-ux/HANDOFF.md)
- [ ] Do NOT land while any earlier phase's `TODO(remove:*)` marker is still live — a surviving marker reopens the phase of its named deletion-bead owner (do not absorb it here)
- [ ] P6b, M1, M2, D1, and S4 are explicitly NOT P8 gates; M2 may land after P8 — verify follow-up/status tracking is filed, never wait on those lanes landing.

## Owner questions / verdict
- OWNER-QUESTIONS: none.
- GO/NO-GO: GO only as the terminal verification phase after every runtime prerequisite above is merged and the P6b/M2/D1/S4 follow-up or status tracking is filed; NO-GO if any required runtime phase is missing, any `TODO(remove:*)` marker survives, or any invariant/import gate is red.

## Beads
- [ ] BBP8-001 — Repo-wide `TODO(remove:*)` marker gate (zero-tolerance)
- [ ] BBP8-002 — Document the four-part surface contract as stable public API
- [ ] BBP8-003 — Old-moved-path import gates (P2/P3/P4/T1/T2 relocations)
- [ ] BBP8-004 — Convert remaining plan prose into tracked beads/issues
- [ ] BBP8-005 — Final invariant + build/test sweep

## Verification commands
- [ ] `pnpm lint:invariants`
- [ ] `pnpm audit:imports`
- [ ] `node scripts/check-no-remove-markers.mjs` (after BBP8-001 creates/wires it)
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
- [ ] `pr3-track-remaining-prose` completed BBP8-004
- [ ] BBP8-005 completed as the final stack merge gate, not a separate PR; any red gate reopened its owning phase

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
- [ ] Remaining plan tasks converted into tracked beads/issues — nothing left only in prose; P6b/M2/D1/S4 follow-up or status tracking is filed.
- [ ] No code imports old moved paths (grep gates green for every relocation in P2/P3/P4/T1/T2).
- [ ] All `00` invariants + package invariant scripts + `audit:imports` green; full build+test green.

## Closeout
- [ ] Zero unowned `TODO(remove:*)` markers for this phase (and zero markers repo-wide)
- [ ] `@hachej/boring-agent` README documents the four-part surface contract
- [ ] PRs merged per [PR-PLAN.md](../../PR-PLAN.md) (this package's section)
