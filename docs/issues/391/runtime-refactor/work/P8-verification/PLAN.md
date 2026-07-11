# P8-verification — Plan

## Binding reduced v1 verification (2026-07-11)

P8 gates only the workspace-first delivery set:

- P1 workspace/Fastify boundary and bounded agent-local lifecycle;
- P6-D minimal definition/deployment schemas/digests plus A1 compiled bundle;
- A1 compile plus explicit workspace/runtime local dev;
- any D1-R0-demonstrated P5a seam, if required; zero P5a code is valid when
  existing host seams suffice; P2 provider extraction is later;
- stateless P6-R over one host-authorized composition identity, with the
  canonical redacted producer specified by D1-R0;
- D1 multi-agent Docker delivery.

M1/AR1/M2/E2, T1/T2, P2/X1, full P3, E1, plugin snapshots/scoped registrars, attachment
catalogs, and P6 generation/session-retirement machinery are post-v1 and
contribute no P8 gate, import check, documentation promise, or proof step.

### Active proof

- One command records elapsed setup-to-first-run time and a stage breakdown for
  compile -> workspace-backed local turns -> D1 apply -> at least two exact
  HTTPS landings -> existing-member sign-in -> distinct authorized workspaces
  -> their deployed `default` agents in one EU Docker host. Compare the result with the provisional
  15-minute target; do not assert a pass/fail threshold before a baseline exists.
- The target materializes the verified definition bundle and immutable host
  artifact without source-checkout access, and records definition/deployment
  plus workspace-composition manifest digests.
- Cross-binding requests reject foreign hostname/workspace/agent selectors
  before effects; hostname selection itself grants no authority.
- Any demonstrated P5a slice proves only its readiness/secret seam; otherwise
  P8 records that existing seams sufficed. P2 provider extraction is not part
  of v1, but D1 still proves isolated-profile sibling filesystem/process
  denial for the shared N-workspace host. Trusted-direct can prove only local
  development or a single-workspace dedicated composition, never shared-host
  isolation.
- Identical reapply is a no-op. The proof changes and applies site-level desired
  values, then rolls back the prior complete redacted D1 host snapshot/digest.
  It compares restoration of the full site collection: hostnames, bounded
  landing config, auth/membership/owner bindings, workspace/default-agent bindings, roots/storage/
  runtime desired inputs, immutable host artifact, workspace-composition
  manifest/digest, definition/deployment, and secret reference identities.
  Fresh observed readiness/status is recorded separately and is not rollback
  identity. No secret value enters the snapshot or evidence, and the prior stateless P6-R
  digests are reproduced.
- V1-owned removal markers are zero. A residual grep rejects public/product
  `runtime: 'none'` and pure-mode acceptance in product code and non-historical
  docs; explicit rejection tests and clearly marked historical sections are
  allowlisted. Applicable package/import invariants pass, and no raw secret
  appears in evidence.

## Historical 2026-07-09 verification plan — non-dispatchable for v1

### Former v1 gate correction

The former broad gate list is void. Use only the binding reduced gate and proof
above; deferred lanes contribute no v1 acceptance.

> Phase: Phase 8 — Verification + cleanup · Work order: [TODO.md](./TODO.md) · Handoff: [HANDOFF.md](./HANDOFF.md)
> Ordering authority: [INDEX.md](../../INDEX.md) · Vision: [VISION.md](../../VISION.md)

### Governing architecture
- [07-tests-review-acceptance.md](../../architecture/07-tests-review-acceptance.md) — the tests/review/acceptance regime P8 sweeps to green (invariant scripts, import audits, full build+test).
- [08-pluggable-agent-surfaces.md](../../architecture/08-pluggable-agent-surfaces.md) — the four-part surface contract + `createAgent()` façade P8 documents as the stable public API.

### Design context
Phase 8 is terminal v1 verification, not a deferred-deletion dump. Import
migrations happen in their owner PRs; surviving markers reopen the owner. P8
documents the public contract and runs the product golden path. It does not
require post-v1 presentation, mount, shared-tenancy, or control-plane work.
V1 uses the D1 durable local/provider workspace volume; no FUSE/S3 proof is
required.

### Deliverables
Assert zero removal markers, update package docs, run the v1 component gates,
and execute the A1-to-D1 product proof through two real URLs on one host. Track
post-v1 work explicitly.

### Exit criteria
- Zero `TODO(remove:*)` markers repo-wide, asserted by a check wired into `pnpm lint:invariants`.
- `@hachej/boring-agent` README documents the four-part surface contract (08) + the `createAgent()` public runtime API as the stable public surface.
- Remaining plan tasks converted into tracked beads/issues — nothing left only in prose.
- No code imports old moved paths for delivered P2/P3/T1/T2 relocations.
- All `00` invariants + package invariant scripts + `audit:imports` green; full build+test green.
- Executable A1→D1 proof records measured setup-to-first-run time and stage
  breakdown against the provisional 15-minute target, zero platform-source edits,
  source-checkout-independent materialization, all identity digests, idempotent
  reapply, complete-snapshot rollback, and secret-canary absence.
- Each exact HTTPS hostname serves only its bounded landing content. Existing-
  member sign-in reaches the configured authorized workspace, cross-binding
  selectors fail, and each workspace's deployed agent is `default`.
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
