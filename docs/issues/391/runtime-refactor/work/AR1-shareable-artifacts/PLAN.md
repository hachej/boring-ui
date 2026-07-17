> **Work-package status:** follow this package’s linked Bead/GitHub tracker. It is
> not part of Decision 25’s static P0→N1 critical path, but Decision 25 does not
> cancel it. AgentHost/D1-dependent passages must be recut before dispatch.

# AR1-shareable-artifacts — Plan

Status: priority-2 spec package. AR1-001 accepts Lane W for dispatch;
AR1-002…004 queue after priority 1. Lane X remains build-gated and requires a
focused staged-write/recovery protocol review before implementation.

> Phase: Phase AR1 — shareable artifacts (after M1 recuts, before M2/E2)
> Ordering authority: [INDEX.md](../../INDEX.md) · Vision: [VISION.md](../../VISION.md)

## Binding v1 direction

- A producer returns a canonical platform-issued handle for one immutable,
  digest-pinned artifact. The handle never exposes a workspace path.
- Mint succeeds only after source authorization and immutable byte capture.
  The first M1 tracer captures its already-bounded self-contained artifact
  bytes into a durable host-owned `ArtifactBlob` keyed by opaque id + digest;
  oversize/binary output keeps M1's existing stable rejection. A later
  workspace-file mint may read through an authorized `Workspace` adapter, but
  its source path remains server-internal and never enters the handle.
- `ArtifactTransferHandle` identifies the captured blob, not the mutable source
  file. Source edits/deletion after issuance do not change redemption; failed
  capture issues no handle. Expiry/revocation drives blob retention/GC rules.
- Redemption authorizes the handle and the destination workspace separately,
  then materializes an immutable copy before returning a destination-local
  stable ID and web deep link.
- The deep link opens the authorized destination workspace focused on its local
  copy. A missing local copy renders provenance and last-known metadata rather
  than leaking source state.
- Agent and MCP adapters accept no arbitrary URL, redirect, internal-network
  fetch, absolute path, or workspace-relative path. Rejection happens before
  destination mutation.
- Lane split (owner-reconciled 2026-07-11): this immutable-copy contract
  governs the CROSS-WORKSPACE deliverable lane (e.g. a contracted agent
  returning artifacts to a customer workspace, per Decision 22's projection
  boundary). WITHIN a single workspace, #632's owner-ruled model stands
  unchanged: share entry (stable ID + provenance), live reference to current
  file state, membership-auth deep link, tombstone on missing files — no blob
  capture, because nothing crosses a workspace boundary. Live/re-pointable
  CROSS-workspace references remain deferred.

## Dependencies

- M1 (MCP ingress) — fixes the authenticated consumer-agent and bounded-result
  shape AR1 serves. AR1 does not wait for M2, E2, T1/T2, P2, or X1.
- The workspace contract ([`docs/WORKSPACE_CONTRACT.md`](../../../../../WORKSPACE_CONTRACT.md))
  — deep-link landing and MCP resource access respect workspace authorization.
- [ID1](../ID1-agent-identity/PLAN.md) is required for later public self-service
  identity, not for the authenticated M1-backed AR1 tracer.

## Deliverables

- AR1-001 specifies canonical handle issuance/audience, expiry, revocation,
  pinned identity/version/digest, idempotent copy, payload/type limits, content
  validation, source authorization, durable immutable blob ownership/retention,
  audit events, rollback, and stable errors.
- AR1-001 names the public producer-to-consumer proof and creates the smallest
  reviewable implementation beads only after adversarial acceptance.
- Those later beads implement redemption/copy, the destination-local deep-link
  route, tombstone/provenance rendering, and MCP access to the local copy.

## Exit criteria

- A cross-workspace consumer can materialize a pinned copy in its own
  authorized workspace; foreign, expired, revoked, redirected, internal-network,
  and raw-path attempts fail before mutation.
- The returned human link contains neither a capability secret nor a workspace
  path; the authenticated member lands on the destination-local copy.
- A machine consumer reads the same destination-local copy through the MCP
  resource contract.
- AR1-001 is adversarially reviewed with public-seam proof and rollback,
  revocation, retry, and idempotency semantics before implementation beads are
  created.
