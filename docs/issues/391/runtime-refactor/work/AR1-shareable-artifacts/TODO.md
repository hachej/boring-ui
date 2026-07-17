> **Work-package status:** follow this package’s linked Bead/GitHub tracker. It is
> not part of Decision 25’s static P0→N1 critical path, but Decision 25 does not
> cancel it. AgentHost/D1-dependent passages must be recut before dispatch.

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

### AR1-002 - Lane W share-entry store (new, S)

- Dispatch now (AR1-001-SPEC.md §8: Lane W beads dispatch on acceptance; Lane X
  stays build-gated on the first contracted-mode engagement).
- File area: new `ShareEntryV1` persistence (§3.1) — `id`, `workspaceId`,
  server-internal `path` (never emitted), `provenance { producerPrincipalRef,
  createdAt }`. No blob capture, no expiry/revocation fields (Lane W has none).
- Proof requirement: create/get by opaque `id`; `path` never appears in any
  returned payload, log, or audit record; a deleted target's entry still reads
  back with tombstone metadata (feeds AR1-003's tombstone rendering).
- Review budget: small — one store module + focused tests, no route/UI wiring.

### AR1-003 - `/a/<id>` deep-link route, membership auth, tombstone (new, S-M)

- Dispatch now (spec §8 Lane W).
- File area: new deep-link route family (`/a/<id>`) reusing the existing
  workspace membership-denial path (§3.2); no new ACL. Renders live-reference
  resolution to the current file state, not a snapshot.
- Proof requirement (spec §6.2 items 1-3): a member opens `/a/<id>` and lands
  focused on the file; a deleted target renders provenance + last-known
  metadata (`AR1_SHARE_TOMBSTONED`), never a bare 404; a non-member gets a
  clean membership denial. No secret or workspace path in the URL — only the
  opaque `id`.
- Review budget: small-medium — route + tombstone rendering + membership-gate
  tests; no expiry/token machinery (explicitly out of scope, spec §4).

### AR1-004 - MCP resource for same-workspace share (new, S)

- Dispatch now (spec §8 Lane W).
- File area: current M1/M2 servers expose MCP tools only — no MCP RESOURCE
  (`listResources`/`readResource`) support exists yet. This bead BUILDS
  minimal MCP resource support scoped to share entries; it does not reuse an
  existing resource seam. Expose the AR1-002 share entry as that resource,
  through the same server process as the M1/M2 tool surface (reuse of the
  server/transport, not of resource machinery).
- Proof requirement (spec §6.2 item 4): a machine consumer reads the same
  current file state through the MCP resource contract, membership-gated
  identically to the `/a/<id>` route.
- Review budget: small-medium — new minimal MCP resource handler
  (`listResources`/`readResource`) + resource-scoping to share entries + one
  integration test against the AR1-003 route's membership/tombstone behavior
  for parity.

## Exit

- AR1-001 is accepted and `HANDOFF.md` is complete for the spec stage.
- Implementation slices, dependencies, proof, rollback, and review budgets are
  explicit; otherwise AR1 remains `needs-info` and undispatchable.
