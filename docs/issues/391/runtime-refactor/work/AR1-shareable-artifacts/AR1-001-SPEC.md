# AR1-001 — shareable artifact transfer and same-workspace share contract

Status: **spec draft — awaits adversarial review before AR1 implementation
beads are created**. This specification is the dispatch gate named by
[PLAN.md](./PLAN.md), [TODO.md](./TODO.md), [HANDOFF.md](./HANDOFF.md),
[PR-PLAN.md](../../PR-PLAN.md) row 6, and
[IMPLEMENTATION-GUARDRAILS.md](../../IMPLEMENTATION-GUARDRAILS.md) AR1 section.
No implementation bead exists until this spec is accepted with no unresolved
adversarial finding.

> Phase: Phase AR1 — shareable artifacts (after M1 recuts, before M2/E2)
> Ordering authority: [INDEX.md](../../INDEX.md) · Vision: [VISION.md](../../VISION.md)
> Binding decisions: [DECISIONS.md](../../../../DECISIONS.md) #21, #22, #23

## 1. Decision and scope

AR1 delivers two distinct sharing lanes that were reconciled into one spec by
the owner lane split of 2026-07-11 (PLAN "Binding v1 direction"). They share
neither storage nor authority model and MUST NOT share code beyond the deep-link
route family and the MCP resource seam:

- **Lane X — cross-workspace deliverable.** A producer agent in one authorized
  workspace hands an immutable, digest-pinned artifact to a *different*
  authorized workspace. This lane exists because Decision 22 presents boring as
  a contracting platform: a contracted agent returns artifacts across the
  projection boundary to a customer's workspace, and no live cross-workspace
  reference is permitted. Redemption materializes an immutable **copy** in the
  destination workspace. This lane is governed by `ArtifactTransferHandle` +
  host-owned `ArtifactBlob` and is the authoritative AR1 workpackage exit
  (INDEX.md priority 2).
- **Lane W — same-workspace share.** A producer returns a link to a file that
  lives in the *same* workspace the consumer already belongs to. This is #632's
  owner-ruled model: a `WorkspaceFileLink` share entry pointing at a live file,
  resolved through membership, with a tombstone when the file is gone. Nothing
  crosses a workspace boundary, so there is no blob capture, no expiry
  machinery, and no separate destination authorization — **membership IS the
  access boundary and membership IS revocation** (Guardrails AR1).

Both lanes depend on M1 (authenticated consumer identity + bounded artifact
shape) and the workspace contract; neither waits for M2, E2, T1/T2, P2, X1, or
ID1. The M1-backed tracer uses a pre-provisioned bearer mapped to an existing
regular principal (Decision 22); ID1 public self-service is not an AR1
prerequisite.

**A workspace path never appears in any handle, link, deep-link URL, error,
audit record, or MCP resource identifier in either lane.** Path is
server-internal; the public identity is always an opaque stable id.

### 1.1 What settles here vs what a later bead settles

This spec settles the *security and data contract* of both lanes: record
shapes, authorization checks, capture/copy semantics, expiry/revocation/GC
rules, limits, audit events, rollback, error codes, and the deep-link +
tombstone behavior. It does **not** write implementation code. Per TODO.md and
Guardrails, implementation beads (share-entry store, deep-link route, MCP
resource, and the cross-workspace copy path) are created only after this spec is
adversarially accepted.

## 2. Lane X — cross-workspace deliverable

### 2.1 Records

Three records, with strictly separated authority. Naming follows TODO.md so the
spec and the plan stay in lockstep.

**`ArtifactBlob` (host-owned, immutable byte capture).** The durable,
content-addressed store of the captured bytes. Never referenced by workspace
path.

```ts
interface ArtifactBlobV1 {
  schemaVersion: 1
  blobId: string            // opaque host-allocated id, not a path, not a digest
  digest: `sha256:${string}`// content digest of the exact captured bytes
  byteLength: number        // exact captured length; enforced against caps
  contentType: string       // validated allowlisted media type (see 2.6)
  provenance: {             // redacted; no raw path, no secret
    sourceWorkspaceRef: string   // opaque workspace ref, not a path
    producerPrincipalRef: string // acting agent recorded as actor (Decision 22)
    definitionRef: string        // producing AgentDefinition id/version
    capturedAt: string           // server timestamp
  }
  retention: {
    ownerHandleId: string   // the handle whose lifecycle governs GC of this blob
    state: 'live' | 'expired' | 'revoked'
  }
}
```

The blob is keyed by `blobId`; `digest` is a verification and dedupe field, not
the primary key. Two captures of identical bytes MAY share one stored blob by
digest, but each capture allocates its own `blobId`/handle so retention is not
entangled across handles (a revocation of one handle must not delete bytes a
second live handle still pins — see 2.7).

**`ArtifactTransferHandle` (the transfer authority — signed, expiring,
revocable).** The only object a producer returns and the only thing a consumer
redeems. It carries an opaque blob reference + digest, never a source path.

```ts
interface ArtifactTransferHandleV1 {
  schemaVersion: 1
  handleId: string          // opaque; also the audit correlation id
  blobId: string            // -> ArtifactBlob (never a path)
  digest: `sha256:${string}`// pinned; redemption re-verifies bytes against it
  issuer: {
    principalRef: string    // originating user/workspace principal (Decision 22)
    sourceWorkspaceRef: string
    definitionRef: string
  }
  audience: {
    kind: 'workspace' | 'principal' | 'open-authenticated'
    ref?: string            // required for 'workspace'/'principal'; absent for open
  }
  pinned: {
    identityRef: string     // producing AgentDefinition identity
    version: string         // producing definition version
    digest: `sha256:${string}` // == blob digest, restated for tamper-evidence
  }
  issuedAt: string
  expiresAt: string         // REQUIRED; see 2.4 for default open item
  revoked: boolean
  maxRedemptions: number | null // null = unbounded within expiry; default 1 (open item)
}
```

The handle value transmitted to the consumer is a signed token whose payload is
the redacted subset above; it carries **no capability secret in any URL** and no
workspace path. Signature covers `{handleId, blobId, digest, audience,
expiresAt, maxRedemptions}` so audience and expiry cannot be widened by a
holder.

**`WorkspaceFileLink` (destination-local reference — created after copy).** The
membership-gated UI/MCP reference minted in the *destination* workspace once
redemption copies the bytes in. Its public deep-link stable id is **never**
transfer authority (TODO.md, HANDOFF contract line 13).

```ts
interface WorkspaceFileLinkV1 {
  schemaVersion: 1
  linkId: string            // public deep-link stable id; not a capability
  workspaceId: string       // destination workspace (membership-gated)
  path: string              // SERVER-INTERNAL destination path; never emitted
  provenance: {
    sourceHandleId: string
    sourceWorkspaceRef: string
    producerPrincipalRef: string
    digest: `sha256:${string}`
    copiedAt: string
  }
  tombstone: boolean        // true once the local copy is missing (2.9)
}
```

### 2.2 Handle issuance (mint)

Mint is a server-internal operation invoked by the producing agent through the
authorized surface; it is **not** an arbitrary HTTP endpoint the consumer can
call. Order of operations is mandatory and fails closed at each step:

1. **Source authorization.** The mint caller must be an authorized principal in
   the source workspace (existing membership check; no new ACL). A caller
   without source authorization fails with `AR1_SOURCE_UNAUTHORIZED` before any
   byte read.
2. **Immutable byte capture.** The first tracer accepts *only* M1's complete,
   bounded, self-contained artifact payload already produced in-process — it
   does not read a workspace file. A later file-backed mint (separate bead) may
   read through an authorized source `Workspace` adapter, but the source path
   stays server-internal and never enters the handle. Oversize, binary, or
   truncated payloads reject with `AR1_PAYLOAD_REJECTED` (see 2.6); there is no
   path fallback.
3. **Content validation** (2.6): media-type allowlist, size cap, secret scan,
   path-shaped-content rejection.
4. **Digest + persist.** Compute `sha256` over the exact captured bytes, persist
   the `ArtifactBlob` durably, and only *then* allocate the handle. A failed
   persist emits **no handle** and leaves no partial blob (fails closed with
   `AR1_CAPTURE_FAILED`).
5. **Handle issuance.** Allocate `handleId`, set `expiresAt` (2.4), sign, and
   return. Emit `artifact.handle.issued` audit event (2.8).

**Source edits or deletion after issuance do not change redemption:** the handle
identifies the captured blob, not the mutable source file. Failed capture issues
no handle. This is the load-bearing immutability guarantee (PLAN lines 19-21).

### 2.3 Redemption

Redemption is the destination-side operation. It authorizes the handle and the
destination workspace **separately** (PLAN line 22; HANDOFF line 17):

1. **Handle authorization.** Verify signature, `expiresAt > now`,
   `revoked == false`, and `redemptionCount < maxRedemptions` (if bounded).
   Verify the redeeming principal satisfies `audience` (workspace/principal
   match, or `open-authenticated` = any authenticated principal). Any failure →
   `AR1_HANDLE_EXPIRED`, `AR1_HANDLE_REVOKED`, `AR1_HANDLE_AUDIENCE_MISMATCH`, or
   `AR1_HANDLE_INVALID` **before any destination mutation**.
2. **Destination authorization.** The redeeming principal must be an authorized
   member of the destination workspace (separate membership check).
   Failure → `AR1_DESTINATION_UNAUTHORIZED` before mutation.
3. **Byte re-verification.** Load the `ArtifactBlob`, re-hash, and compare to the
   handle's pinned `digest`. Mismatch → `AR1_DIGEST_MISMATCH`, no copy.
4. **Idempotent copy.** Materialize an immutable copy into the destination
   workspace and mint a `WorkspaceFileLink`. Redemption is **idempotent** keyed
   by `(handleId, destinationWorkspaceId)`: a retry after a completed copy
   returns the *same* `linkId` and does not create a second copy or consume a
   second redemption. A retry after a *failed partial* copy rolls the partial
   back (2.10) and retries cleanly.
5. **Return.** Emit `artifact.handle.redeemed`, return the destination-local
   `linkId` and its deep link (2.11). No source state, no path, no capability
   secret is returned.

Redemption never fetches an arbitrary URL, follows a caller redirect, reaches an
internal-network address, or accepts an absolute/workspace-relative path
(2.6.4). The only accepted input is the canonical signed handle.

### 2.4 Expiry and revocation

- **Expiry is mandatory.** Every handle has `expiresAt`. After expiry the handle
  is unredeemable (`AR1_HANDLE_EXPIRED`) and the blob becomes GC-eligible (2.7).
- **Revocation** flips `revoked = true` on the handle. It is authorized to the
  handle issuer's principal or a source-workspace owner. Post-revocation
  redemption fails `AR1_HANDLE_REVOKED`. Revocation is durable and MUST survive
  process restart; a cached "not revoked" view must reload authoritative state
  before the copy commits.
- **Already-materialized copies are unaffected by later expiry/revocation.**
  Once a `WorkspaceFileLink` exists, it is a normal destination-local file
  governed by destination membership — expiring or revoking the transfer handle
  does not reach into the destination workspace to delete an already-delivered
  copy. Revocation stops *future* redemptions, not delivered work. (This mirrors
  Lane X's "immutable copy" contract: delivery is final once it lands.)

### 2.5 Pinned identity / version / digest

The handle pins the producing `AgentDefinition` identity + version and the byte
digest. Redemption restates and re-verifies the digest (2.3 step 3). A consumer
can therefore prove *which* agent definition at *which* version produced the
exact bytes it received. Pinned fields are covered by the handle signature so a
holder cannot rewrite provenance.

### 2.6 Payload, type, and size limits; content validation

The first tracer inherits M1's already-ratified caps (PR-PLAN.md M1 row
BBM1-002) as the AR1 starting proposal — reuse, do not reinvent:

| Field | M1-inherited cap | Notes |
| --- | --- | --- |
| final artifact bytes | 96 KiB | self-contained inline artifact |
| Markdown artifact | 256 KiB | Markdown content kind |
| serialized total | 384 KiB | full transfer payload ceiling |

- **Exact caps for AR1 are an open item (2.12)** — the above are the proposed
  defaults, to be ratified in review. Oversize → `AR1_PAYLOAD_REJECTED`.
- **Content-type allowlist.** Only explicitly allowed media types (text/plain,
  text/markdown, application/json, and the M1-agreed self-contained kinds).
  Binary/unknown types reject; no path fallback.
- **Secret scan.** Captured bytes are scanned for secret-shaped content; a hit
  fails `AR1_PAYLOAD_REJECTED` (no secret ever enters a durable blob or audit).
- **No-path-fetch invariant (SSRF/path guard).** The mint/redeem adapters reject
  every arbitrary caller URL, redirect, internal-network address, absolute path,
  and workspace-relative path *before* any capture or destination mutation
  (`AR1_SOURCE_INPUT_REJECTED`). Only in-process M1 bytes (tracer) or an
  authorized `Workspace` adapter read (later bead) are valid sources.

### 2.7 Durable blob ownership, retention, and GC

- The `ArtifactBlob` is host-owned and lifecycle-tied to its owning handle via
  `retention.ownerHandleId`.
- A blob is **GC-eligible** when its owning handle is expired *or* revoked *and*
  no other live handle pins the same `blobId`. GC never deletes bytes a live
  handle still references.
- **A materialized destination copy does not depend on the blob.** Once
  redemption copies bytes into the destination workspace, that copy is
  independent; blob GC after expiry does not affect delivered `WorkspaceFileLink`
  files.
- GC is a bounded sweep (or reference-count on state transition) — **not** a
  background reconciler/daemon (Guardrails: boring by default). Retention
  duration default is an open item (2.12).
- Retention/GC state transitions emit audit events (2.8).

### 2.8 Audit events

Stable, redacted, append-only. No secret, no raw path, no foreign workspace id.
Actor = the acting agent; principal = the originating user/workspace
(Decision 22 provenance model).

| Event | Emitted when |
| --- | --- |
| `artifact.handle.issued` | mint completes and a handle is returned |
| `artifact.handle.redeemed` | redemption copies bytes and mints a link |
| `artifact.handle.revoked` | issuer/owner revokes a handle |
| `artifact.handle.expired` | expiry observed on a redemption attempt or sweep |
| `artifact.handle.redeem_denied` | any pre-mutation authorization/validation failure, with stable code |
| `artifact.blob.gc` | a blob is collected after expiry/revocation |

Where a durable event store is warranted, reuse T1 `eventStreamStore` rather
than a new sink (Guardrails reuse-first). AR1 does not require T1 to ship.

### 2.9 Missing local copy → tombstone (destination-local)

If the destination-local copy is later deleted, the `WorkspaceFileLink`
deep link renders **provenance + last-known metadata** (source handle,
producer, digest, `copiedAt`), never a bare 404 and never source state
(PLAN lines 25-27). `tombstone = true`.

### 2.10 Rollback

- **Mint rollback:** a failed capture/persist leaves no handle and no partial
  blob.
- **Redemption rollback:** a copy that fails partway leaves no `WorkspaceFileLink`
  and no partial destination file; the redemption count is not consumed; a retry
  starts clean. Rollback is per-`(handleId, destinationWorkspaceId)` and never
  mutates the source workspace or the blob.
- Rollback never moves an already-committed delivery backward (delivery is
  final, 2.4).

### 2.11 Destination-local deep link

- The returned human link opens the **authorized destination workspace focused
  on its local copy**. It contains neither a capability secret nor a workspace
  path — only the opaque `linkId` (e.g. `/a/<linkId>`), gated by destination
  membership on open.
- A member lands on the copy; a non-member gets a clean denial (not a 404 that
  leaks existence differently); a missing copy renders the tombstone (2.9).

### 2.12 Lane X open items (require ratification)

- **Exact size caps.** Proposed = M1-inherited (2.6 table). Ratify or override in
  review.
- **Retention duration defaults.** How long a blob persists past
  expiry/revocation before GC, and the default `expiresAt` window at mint.
  Proposed defaults to be set in review; marked here as unresolved.
- **`maxRedemptions` default.** Proposed = 1 (single-delivery). Ratify whether
  the tracer default is single-use or bounded-multi.

## 3. Lane W — same-workspace share

### 3.1 Record

The share entry is a live reference to a file in the *same* workspace, per #632.
No blob capture, because nothing crosses a boundary.

```ts
interface ShareEntryV1 {
  schemaVersion: 1
  id: string          // public deep-link stable id (/a/<id>); not a capability
  workspaceId: string
  path: string        // SERVER-INTERNAL live path; never emitted in URL/API/audit
  provenance: {
    producerPrincipalRef: string
    createdAt: string
  }
}
```

### 3.2 Behavior

- **Live-reference resolution.** The share resolves to the *current* state of the
  workspace file (not a snapshot). Edits to the file are reflected; this is the
  deliberate difference from Lane X.
- **Membership-auth deep-link route.** `/a/<id>` opens the workspace focused on
  the file, gated by workspace membership. No secret in the URL — only the opaque
  `id`.
- **Tombstone rendering.** A missing/deleted target renders provenance + last-
  known metadata, never a bare 404 (Guardrails accept criteria).
- **MCP resource exposure.** The same share entry is exposed as an MCP resource
  so a machine consumer reads the same current file through the MCP resource
  contract, membership-gated identically. This reuses the M1/M2 resource seam;
  it does not introduce a second MCP runtime owner (TODO.md prerequisite).
- **Revocation = membership.** There is no separate revoke operation, no expiry,
  and no capability token to leak. Removing membership removes access; deleting
  the entry removes the link.

### 3.3 Errors (Lane W)

Lane W reuses the workspace membership denial path; its only AR1-specific stable
codes are `AR1_SHARE_NOT_FOUND` (no such entry) and `AR1_SHARE_TOMBSTONED`
(entry exists, target file gone → render provenance). Access denial is the
existing generic membership denial, not an AR1 code.

## 4. Explicit non-goals

- **Live cross-workspace references/projection.** Lane X delivers an immutable
  copy only. A live or re-pointable cross-workspace reference requires a later
  named consumer and a separate spec (PLAN line 38; TODO lines 44-46).
- **Preview renderers per file type.** Neither lane builds content-type preview
  rendering (Guardrails "Do NOT build").
- **Expiry/revocation machinery for Lane W.** Lane W has no expiry and no
  capability revocation — membership is the only boundary (Guardrails).
- **Generic E1 attachment registry, P2 providers, X1 mounts, public workspace
  paths, or a second MCP runtime owner** (TODO.md prerequisites).
- **A billing/economic layer** on transfer (deferred with the workspace-budget
  concern, Decision 22).

## 5. Stable error codes

Tests assert codes, not messages. Errors expose no raw path, secret value, or
foreign workspace/deployment id.

| Code | Lane | Meaning |
| --- | --- | --- |
| `AR1_SOURCE_UNAUTHORIZED` | X | mint caller lacks source-workspace authorization |
| `AR1_SOURCE_INPUT_REJECTED` | X | arbitrary URL/redirect/internal-net/absolute/relative path source rejected before capture |
| `AR1_PAYLOAD_REJECTED` | X | oversize, binary, disallowed type, truncated, or secret-shaped payload |
| `AR1_CAPTURE_FAILED` | X | byte capture/persist failed; no handle issued, no partial blob |
| `AR1_HANDLE_INVALID` | X | signature/shape invalid or tampered |
| `AR1_HANDLE_EXPIRED` | X | `expiresAt` passed |
| `AR1_HANDLE_REVOKED` | X | handle revoked |
| `AR1_HANDLE_AUDIENCE_MISMATCH` | X | redeeming principal outside handle audience |
| `AR1_DESTINATION_UNAUTHORIZED` | X | redeeming principal not a member of destination workspace |
| `AR1_DIGEST_MISMATCH` | X | blob bytes do not match pinned digest at redemption |
| `AR1_REDEMPTION_EXHAUSTED` | X | `maxRedemptions` reached |
| `AR1_SHARE_NOT_FOUND` | W | no such share entry |
| `AR1_SHARE_TOMBSTONED` | W | entry exists but target file is gone (render provenance) |

## 6. Acceptance criteria

Machine-checkable where marked (CI or integration-provable).

### 6.1 Lane X (cross-workspace) — authoritative AR1 exit

1. **[machine]** A producer in workspace A mints a handle; the returned handle
   contains no workspace path and no capability secret (assert on serialized
   token + returned payload).
2. **[machine]** Source edit/deletion after issuance does not change redemption:
   redeeming after mutating the source yields byte-identical content matching the
   pinned digest.
3. **[machine]** A consumer authorized in destination workspace B materializes a
   pinned immutable copy in B; the copy's digest equals the handle's pinned
   digest.
4. **[machine]** Foreign (audience-mismatch), expired, revoked, digest-mismatch,
   arbitrary-URL, internal-network, and raw-path attempts each fail with their
   stable code **before any destination mutation** (assert no `WorkspaceFileLink`
   and no destination file created).
5. **[machine]** Redemption is idempotent: two redeems of the same
   `(handleId, destinationWorkspaceId)` return the same `linkId`, one copy, one
   consumed redemption.
6. **[machine]** The returned deep link contains only an opaque `linkId`; an
   authenticated destination member lands on the local copy; a non-member gets a
   clean denial; a deleted copy renders a provenance tombstone, not a 404.
7. **[machine]** A machine consumer reads the same destination-local copy through
   the MCP resource contract.
8. **[machine]** Revocation and expiry are durable across process restart (a
   restart between revoke and redeem still fails `AR1_HANDLE_REVOKED`).
9. **[machine]** Blob GC after expiry/revocation does not affect an
   already-materialized destination copy; a second live handle pinning the same
   blob prevents GC.
10. **[review]** No secret value or raw path appears in any handle, link, URL,
    audit record, error, or MCP identifier.

### 6.2 Lane W (same-workspace)

1. **[machine]** An agent returns a `/a/<id>` link; the workspace owner opens it
   logged-in and lands focused on the file.
2. **[machine]** A deleted target renders a provenance tombstone
   (`AR1_SHARE_TOMBSTONED`), never a bare 404.
3. **[machine]** A non-member gets a clean membership denial.
4. **[machine]** The same entry read as an MCP resource returns the current file
   state, membership-gated identically.
5. **[machine]** No expiry/revocation/capability token exists in Lane W; removing
   membership removes access.

## 7. Non-goals and stop signs

Stop and re-review if implementation adds: a live cross-workspace reference,
a preview-rendering engine, an expiry/token machinery in Lane W, a background
GC reconciler/daemon, a second MCP runtime owner, a generic attachment registry,
a capability secret in any URL, or any workspace path in a handle/link/audit
record. Cross-workspace live access and the billing layer are deferred with
named triggers (Decision 22).

## 8. Review closeout

This spec is accepted only when adversarial review confirms: both lanes' record
shapes, the mint→capture→persist→issue ordering, the separate handle vs
destination authorization, expiry/revocation/GC durability, idempotent copy +
rollback, the SSRF/path guard, the no-secret/no-path invariant across both
lanes, the stable error set, and the three open items (2.12) are ratified.
Implementation beads (share-entry store, `/a/<id>` route + tombstone, MCP
resource, and the cross-workspace copy path) are created **only** after that
acceptance, each with its own proof and review budget (TODO.md exit).
