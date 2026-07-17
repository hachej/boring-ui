> **#391 status (2026-07-17): historical reference / non-dispatchable.**
>
> Active authority: `docs/issues/391/plan.md` and Decision 25 in
> `docs/DECISIONS.md`. Where this file conflicts, the active authority wins.

# P5-provisioning-secrets — Plan

> **Owner-reframed v1 scope (2026-07-11).** Only P5a host-readiness,
> fingerprint, and credential work required by the D1 multi-agent Docker host
> is a v1 support slice. P2/runsc provider validation, generic provisioning
> engines, managed-service lifecycle, and broad secrets/provider abstractions
> remain later work.

> Phase: narrow P5a — D1 Docker-host readiness/secrets alongside D1; full
> provisioning expansion is post-v1 · Work order: [TODO.md](./TODO.md) · V1 handoff: [P5A-HANDOFF.md](./P5A-HANDOFF.md)
> Ordering authority: [INDEX.md](../../INDEX.md) · Vision: [VISION.md](../../VISION.md)

## Active v1 prerequisites and work

P5a depends only on the exact D1/workspace/host facts its named consumers must
validate. P2, P3, and E1 are not gates.

The sole active order is tracer-led and recorded in
[`P5A-HANDOFF.md`](./P5A-HANDOFF.md):

1. build the D1 tracer with the existing host/workspace composition;
2. recut BBP5-007 only if D1 needs a host-side secret-reference/status broker;
3. recut the smallest BBP5-003/004 readiness projection only if existing host
   readiness cannot express a fact D1 demonstrably consumes.

D1 owns its redacted desired-state digest, apply reconciliation, and rollback.
BBP5-008 remote-worker/runsc facts stay with P2. BBP5-009 and BBP5-011/012 are
not preselected v1 work; dispatch them only from a new named product gap.

V1 does not move the generic requirement normalizer or provisioning engine,
create an E1 attachment lifetime, or add SDK archives, services, or remote
mounts. Requirements/readiness validate host/workspace/D1 authority; they do
not grant it.

## Active v1 exit

D1-R0 records either (a) existing seams are sufficient and P5a ships no code,
or (b) one demonstrated missing seam. In case (b), its focused proof covers
only that secret-reference or readiness seam and no leakage. D1 owns the host,
N bindings, desired digest, and rollback proof. Provider-specific isolation/
network/image facts belong to P2 and do not gate this exit.

## Historical broad P5 plan — non-dispatchable for v1

Everything below records the superseded 2026-07-09 P3/E1-dependent engine
extraction. Do not dispatch it or use it as P8 acceptance.

## Historical governing architecture
- [03-policy-provisioning-readiness.md](../../architecture/03-policy-provisioning-readiness.md) — requirement shape, provisioning-ownership rules, readiness model, secrets, managed services, remote-worker hardening, two-phase lifecycle, fingerprint key composition.

## Former v1 scope correction (superseded)

**P5a v1:** requirement normalization, caller migration, per-requirement
readiness/health, host-side secret brokerage, deterministic fingerprinting, and
non-dev fail-closed governance roots, plus the authenticated remote-worker
capability/hardening handshake required to select P2's runsc provider. **P5b
post-v1:** SDK archives, managed services/ports, the remote-worker attachment
mount/generalization, and hot shared-tenant
provisioning. P5a depends on E1 because it fingerprints and readies a resolved
attachment lifetime, not a speculative runtime profile. Host/core owns
orchestration; P5a moves the existing environment provisioning engine/runners
to `@hachej/boring-bash/server` and migrates every host caller atomically.
Agent core receives methodless readiness facts and owns no operational runner.

## Design context

P5 makes runtime needs declarative, scoped, readiness-gated, and secret-safe by
**extending** the existing provisioning engine — no parallel provisioning path. Its
hard prerequisite is Phase 3 (routes/tools moved + host-composed bash bundle) plus
the Phase 2 provider capability matrix: `ProviderCapabilities` exported from
`@hachej/boring-sandbox/shared`, with the concrete table at
`packages/boring-sandbox/src/shared/providerMatrix.ts` after P2. It runs parallel
to Phase 4 and does not gate on it. Ownership is fixed: declarative shapes live
in `@hachej/boring-bash/shared`; normalization, the extracted provisioning
engine, health checks, fingerprints, and later environment runners live in
`@hachej/boring-bash/server`; concrete provider adapters + capability facts live
in `@hachej/boring-sandbox`; the host orchestrates both and injects readiness
facts into agent. `@hachej/boring-agent` keeps **zero value imports** from boring-bash or
boring-sandbox. The v2
credential-brokering rule is central: brokered secrets are host-side handles
consumed only by trusted-core tools and **never enter any sandboxed environment**
or the model transcript — there is no raw-env injection path, and the `direct`
provider is a host process (not a sandbox), so nothing is "injected" there either.
Remote-worker capabilities are reported facts (`reported | unknown`); consumers
fail closed on `unknown`.

Runtime images compose with, not replace, provisioning. A pinned image digest is
the base provisioning fingerprint (build-time bake); normalized
`BashRequirement` contributions are runtime/bootstrap overlays on top of that
base. A digest change forces a fresh template/bootstrap path; a requirement
change re-runs the overlay/onSession path. Fingerprints carry image refs/digests,
requirement ids/content, provider contract version, and secret names/status only
— never raw secret values.

## Deliverables
P5a: `BashRequirement` normalizer plus extraction of the existing provisioning
implementation into boring-bash/server; host/core/CLI caller migration;
import-free validation;
per-requirement readiness and health; secret status/brokerage; deterministic
two-phase fingerprint; authenticated remote-worker contract and fail-closed
hardening validation. P5b retains SDK archives, managed services, and the
remote-worker attachment mount/generalization as later work.

Additional v2 deliverable: **credential brokering rule** (00 invariant 14, 08 trust boundary) — brokered secrets are host-side handles consumed only by trusted-core tools; they never enter any sandboxed environment or the model transcript. There is no raw-env injection path: the `direct` provider is not a sandbox, so nothing is "injected" there either — the distinction is sandbox vs. host process, not an exception clause.

Runtime-image amendment: fold `{ image: { ref, digest } }` into the existing
two-phase bootstrap/onSession fingerprint model; do not create an image-specific
provisioning engine.

## Exit criteria
As v1, plus:
- No test can read a brokered secret from inside the sandbox.
- No brokered secret is reachable from inside any sandboxed environment (there is no raw-env injection path — the `direct` provider is a host process, not a sandbox).
- A remote D1 target is selectable only after an authenticated handshake proves
  contract version, runsc systrap, netns/nftables policy, resource limits,
  persistence/image facts, and no silent downgrade; unknown facts fail closed.
