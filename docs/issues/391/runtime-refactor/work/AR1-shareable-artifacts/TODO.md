# TODO-AR1 - Shareable artifacts

Coordinator: never assign this whole file. AR1 is spec-only until AR1-001 is
accepted; implementation beads are created from that accepted contract.

## Context

- Plan: `docs/issues/391/runtime-refactor/work/AR1-shareable-artifacts/PLAN.md`.
- Ordering: `docs/issues/391/runtime-refactor/INDEX.md` priority 2.
- Workspace authority: `docs/WORKSPACE_CONTRACT.md`.
- Surface architecture:
  `docs/issues/391/runtime-refactor/architecture/08-pluggable-agent-surfaces.md`.

## Prerequisites

- The current-main M1 recut fixes authenticated consumer identity, authorized
  workspace/default-agent resolution, and bounded result delivery.
- ID1 public self-service identity is not a prerequisite for this authenticated
  M1-backed tracer.
- No implementation starts from the reservation stub alone.
- AR1 does not introduce generic E1 attachment registries, P2 providers, X1
  mounts, public workspace paths, or a second MCP runtime owner.

## Beads

### AR1-001 - Artifact share and intake contract (spec, S)

- Define immutable identity/version/digest and link capability scope.
- Define host-owned `ArtifactBlob { blobId, digest, bytes/contentType,
  provenance }` persistence and retention. Mint authorizes the source, captures
  complete bounded bytes, verifies the digest, persists the blob, and only then
  issues a handle. The handle carries an opaque blob reference/digest, never a
  source workspace path.
- Name two records: `ArtifactTransferHandle` is the signed, expiring,
  revocable authority for one pinned source digest; `WorkspaceFileLink` is the
  membership-gated destination-local UI/MCP reference created after copy. The
  public deep-link stable ID is never transfer authority.
- Define issuer authorization, expiry, revocation, audit, and stable errors.
- First tracer accepts only M1's complete bounded self-contained artifact
  payload. Oversize, binary, or truncated payloads reject; no path fallback.
  A future file-backed mint must read through an authorized source `Workspace`
  adapter and is a separate bead.
- Define destination-workspace authorization independently from link access.
- First tracer uses an immutable copy into the authorized destination workspace.
  Live/re-pointable cross-workspace reference/projection requires a later named
  consumer and re-specification.
- Specify source-edit/delete semantics: redemption uses captured bytes and is
  unaffected by later source mutation; failed capture emits no handle; expiry/
  revocation and retry define blob GC and idempotent destination copy behavior.
- Accept only the platform's canonical signed artifact handle. The agent/MCP
  adapter never fetches an arbitrary caller URL, follows caller redirects, or
  accepts a workspace-relative/absolute path; SSRF and path access fail before
  mutation.
- Set payload/type limits, validation, and no-secret/no-path requirements.
- Name the public proof seam: producer publishes, stock consumer opens, an
  authorized destination receives the artifact, and foreign/expired/revoked
  attempts fail before workspace mutation.
- Produce implementation beads only after adversarial review accepts the spec.

## Exit

- AR1-001 is accepted and `HANDOFF.md` is complete for the spec stage.
- Implementation slices, dependencies, proof, rollback, and review budgets are
  explicit; otherwise AR1 remains `needs-info` and undispatchable.
