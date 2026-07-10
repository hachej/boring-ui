# P8-verification — Plan

## V1 gate correction (binding, 2026-07-09)

P8 gates P1, T1/T2, P2/P3, E1, P5a, P6-D/P6-R, A1, and D1.
It executes and records the <=15-minute golden path, crash-safe idempotent
reapply, definition/deployment/resolved digests, exact-host landing/member/
fixed-workspace/default-agent journey, and complete-snapshot rollback proof.
P4, E2, X1, P5b, P6 plugin/child-app expansion, P7, M2,
D2, S3, and S4 are explicitly post-v1 and do not gate P8.

> Phase: Phase 8 — Verification + cleanup · Work order: [TODO.md](./TODO.md) · Handoff: [HANDOFF.md](./HANDOFF.md)
> Ordering authority: [INDEX.md](../../INDEX.md) · Vision: [VISION.md](../../VISION.md)

## Governing architecture
- [07-tests-review-acceptance.md](../../architecture/07-tests-review-acceptance.md) — the tests/review/acceptance regime P8 sweeps to green (invariant scripts, import audits, full build+test).
- [08-pluggable-agent-surfaces.md](../../architecture/08-pluggable-agent-surfaces.md) — the four-part surface contract + `createAgent()` façade P8 documents as the stable public API.

## Design context
Phase 8 is terminal v1 verification, not a deferred-deletion dump. Import
migrations happen in their owner PRs; surviving markers reopen the owner. P8
documents the public contract and runs the product golden path. It does not
require post-v1 presentation, mount, shared-tenancy, or control-plane work.
V1 uses the D1 durable local/provider workspace volume; no FUSE/S3 proof is
required.

## Deliverables
Assert zero removal markers, update package docs, run the v1 component gates,
and execute the A1-to-D1 product proof through the real dedicated URL. Track
post-v1 work explicitly.

## Exit criteria
- Zero `TODO(remove:*)` markers repo-wide, asserted by a check wired into `pnpm lint:invariants`.
- `@hachej/boring-agent` README documents the four-part surface contract (08) + the `createAgent()` public runtime API as the stable public surface.
- Remaining plan tasks converted into tracked beads/issues — nothing left only in prose.
- No code imports old moved paths for delivered P2/P3/T1/T2 relocations.
- All `00` invariants + package invariant scripts + `audit:imports` green; full build+test green.
- Executable A1→D1 proof records <=15 minutes, zero platform-source edits,
  source-checkout-independent materialization, all identity digests, idempotent
  reapply, complete-snapshot rollback, and secret-canary absence.
- The exact HTTPS hostname serves only bounded landing content. Existing-member
  sign-in reaches the one D1-managed workspace, every workspace-bearing server/
  front selector is fixed to it, and its deployed agent is `default`.
- Workspace create/switch/delete and foreign selectors/claims fail across core,
  full-app MCP, runtime-plugin/plugin-front, pane-status, WorkspaceBridge,
  agent/session/file/UI paths; non-invite dedicated signup creates no workspace.
- P3 proves trusted v1 plugin tools/routes/Pi prompt+resources/front surfaces
  derive from one verified boot-time record; disable/pre-registration failure
  leaves no server/prompt residue and browser failure preserves previous-good
  UI with diagnostics. D1 mounts only scoped routes over bound repositories and
  rejects raw routes; indirect foreign ids are part of the proof. D1/P6/P8 pin
  and reproduce its digest together with the immutable host-app artifact. Per-
  agent refs/requirements remain post-v1.
- Static host prompt input is part of desired identity and P6 retains the full
  source-labeled static prompt plan in resolved identity. Per-turn dynamic host
  context is the only prompt input deliberately outside that digest.
- The first external hostname publication occurs after complete-pointer CAS;
  reserved-host/no-pointer ingress fails inactive, and a dedicated process
  rejects every non-bound host without generic fallback. Capability minting is
  opaque in-process or nonce-bound over P5a's authenticated worker channel,
  never a caller-supplied record.
