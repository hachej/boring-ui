> **#391 status (2026-07-17): historical reference / non-dispatchable.**
>
> Active authority: `docs/issues/391/plan.md` and Decision 25 in
> `docs/DECISIONS.md`. Where this file conflicts, the active authority wins.

# AR1-shareable-artifacts - Spec handoff

Derived from [PLAN.md](./PLAN.md) and [TODO.md](./TODO.md). This checklist closes
the spec stage only; it does not claim artifact sharing is implemented.

## Contract

- [ ] Artifact identity, pinned version/digest, and allowed content kinds are
      explicit.
- [ ] Source authorization and complete immutable byte capture precede handle
      issuance; durable `ArtifactBlob` ownership, lookup, retention, and GC are
      explicit, and the handle contains no source path.
- [ ] `ArtifactTransferHandle` and destination-local `WorkspaceFileLink` are
      separate records; a deep-link stable ID is never transfer authority.
- [ ] Link issuer, audience/capability, expiry, revocation, and audit rules are
      explicit.
- [ ] Link access and destination-workspace authorization are separate checks.
- [ ] First slice uses immutable copy into the authorized destination;
      reference/projection is deferred.
- [ ] Only the canonical signed artifact handle is accepted. Arbitrary URLs,
      redirects, internal-network fetches, and workspace paths fail before
      mutation.
- [ ] Size/type validation, secret/path redaction, and stable error codes are
      specified.
- [ ] Deletion, revocation, retry/idempotency, and rollback behavior are
      specified.
- [ ] Source mutation/deletion after issuance does not change captured bytes;
      capture failure emits no handle, and the first tracer rejects oversize,
      binary, or truncated M1 payloads without a path fallback.

## Proof and slicing

- [ ] Public producer-to-consumer proof and denial cases are named.
- [ ] M1 is the only ingress prerequisite; M2/E2 may consume the accepted
      contract but do not block its definition.
- [ ] ID1 public self-service identity was not added as a tracer prerequisite.
- [ ] No dependency on E1, P2, X1, T1/T2, or raw workspace paths was added.
- [ ] Implementation beads each have exact proof and review budgets.
- [ ] Adversarial plan review has no accepted unresolved finding.

## Exit

- [ ] AR1 state is `ready-for-agent`, `ready-for-human`, or `needs-info` with a
      concrete blocker; it is never dispatched from the reservation stub.
