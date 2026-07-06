# P5-provisioning-secrets — Plan

> Phase: Phase 5 — Extend provisioning/readiness (bash track; hard dependency P3, parallel to P4) · Work order: [TODO.md](./TODO.md) · Handoff: [HANDOFF.md](./HANDOFF.md)
> Ordering authority: [INDEX.md](../../INDEX.md) · Vision: [VISION.md](../../VISION.md)

## Governing architecture
- [03-policy-provisioning-readiness.md](../../architecture/03-policy-provisioning-readiness.md) — requirement shape, provisioning-ownership rules, readiness model, secrets, managed services, remote-worker hardening, two-phase lifecycle, fingerprint key composition.

## Design context

P5 makes runtime needs declarative, scoped, readiness-gated, and secret-safe by
**extending** the existing provisioning engine — no parallel provisioning path. Its
hard prerequisite is Phase 3 (routes/tools moved + host-composed bash bundle) plus
the Phase 2 provider capability matrix: `ProviderCapabilities` exported from
`@hachej/boring-sandbox/shared`, with the concrete table at
`packages/boring-sandbox/src/shared/providerMatrix.ts` after P2. It runs parallel
to Phase 4 and does not gate on it. Ownership is fixed: the engine + options stay
agent-side over an injected adapter; the `BashRequirement` normalizer and every
`Bash*` declarative data shape live in `@hachej/boring-bash/shared`; concrete
provider adapters + capability facts live in `@hachej/boring-sandbox`; the host wires
them. `@hachej/boring-agent` keeps **zero value imports** from boring-bash or
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
Unchanged from v1: `BashRequirement` normalizer outside agent feeding `provisionWorkspaceRuntime()` via host/core/CLI composition; re-point callers; import-free requirement validation; per-requirement readiness metadata; `optional_failed` derived state; health checks; SDK archive support; managed service requirements; secret status/grant model; remote-worker capability handshake; two-phase bootstrap/onSession reconciliation.

Additional v2 deliverable: **credential brokering rule** (00 invariant 14, 08 trust boundary) — brokered secrets are host-side handles consumed only by trusted-core tools; they never enter any sandboxed environment or the model transcript. There is no raw-env injection path: the `direct` provider is not a sandbox, so nothing is "injected" there either — the distinction is sandbox vs. host process, not an exception clause.

Runtime-image amendment: fold `{ image: { ref, digest } }` into the existing
two-phase bootstrap/onSession fingerprint model; do not create an image-specific
provisioning engine.

## Exit criteria
As v1, plus:
- No test can read a brokered secret from inside the sandbox.
- No brokered secret is reachable from inside any sandboxed environment (there is no raw-env injection path — the `direct` provider is a host process, not a sandbox).
