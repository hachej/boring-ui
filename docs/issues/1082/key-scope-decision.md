# Decision memo — DEK scope: per-workspace vs per-seat

**Issue:** gh-1082 · **Date:** 2026-08-07 · **Decide before:** rotation slice (S2)
**Context:** #1132 ships one DEK per workspace, keyed `(workspaceId, dekGeneration)`,
shared across all providers/credentials in that workspace. Fleets (#1114) give each
workspace five tier-differentiated seats. Question: should the DEK instead be scoped
per seat?

## Recommendation: keep the per-workspace DEK. Do not introduce per-seat DEKs.

The DEK is a **storage-encryption** key; it is not, and should not become, an
**authorization** boundary. Everything a per-seat DEK appears to buy is already
provided — or better provided — elsewhere in the ratified design.

### Threat model, option by option

**Cross-seat credential reuse.** Not a threat — it is the product. Decision 27 and
16f.3 define one active credential per `(workspaceId, providerId)`; all five seats of
a workspace are *supposed* to spend the same workspace key. Per-seat DEKs cannot
prevent misuse of a credential that is deliberately shared; the control point for
"which consumer may use which field over which channel" is the consumer-binding
registry and lease resolver (16f.1), which already enforces this per binding, with
`CREDENTIAL_CONSUMER_MISMATCH` / `CREDENTIAL_DELIVERY_FORBIDDEN` on violation.

**Blast radius on seat compromise.** Seats run in sandboxes and — under the shipped
Tier-1 model — **never hold the DEK, the KEK, or even the credential plaintext**;
resolution is host-side and the secret never enters the sandbox. A compromised seat
gets exactly the leases the host resolver grants that seat's bindings, and that is
identical under either key scope. Per-seat DEKs shrink nothing here; they only add
key-management surface. The keys' real blast-radius boundary is the host process,
and that is governed by KEK custody (local file vs remote KMS — a separate, already
ratified axis), not by DEK fan-out.

**Crypto-shred granularity vs operational complexity.** The shred unit should match
the data unit. Credential rows are per `(workspaceId, providerId)`; per-workspace
DEK rotation-then-destroy (S2) shreds a tenant cleanly in one operation. A per-seat
DEK gives a shred granularity — "seat 3's view" — that corresponds to no stored
object, while multiplying wrapped-DEK rows ×5, giving rotation five independent
generation counters per workspace, five rewrap paths on KEK rotation, and five ways
for the "record exists but key generation missing" fail-closed state to occur.
That is pure operational cost with no matching data boundary.

### Interaction with AAD and dekGeneration

The AAD (`workspaceId:credentialId:providerId:fieldId:credentialVersion:dekGeneration`)
contains **no seat identity**, and the wrapped-DEK AAD binds `(workspaceId,
dekGeneration)`. Per-workspace scoping is therefore what the ciphertext already
cryptographically asserts. Per-seat DEKs would require a seat component in both AAD
contexts — a new AAD encoding version, a new wrapped-DEK context, and re-encryption
of every existing envelope — and S2's rotation design would need per-seat generation
tracking before it is even built. Deciding per-workspace *now* lets S2 proceed on the
shipped AAD unchanged.

### If a real seat-scoped need appears later

The plausible future ask (r1 Q2: a Seneca-style tenant wanting a cheap key for
T4/Haiku and a premium key for T1/Fable) is a **different credential**, not a
different encryption key. Model it as seat/tier-qualified credential *profiles*:
`credentialId` (already AAD-bound) or a tier-qualified provider profile row under
the same workspace DEK. That is an additive schema + resolver-selection change —
no AAD version bump, no re-encryption, no rotation redesign. Migration cost of that
path later: **low** (new rows, new selection rule). Migration cost of switching to
per-seat DEKs later: **moderate but bounded** — a full decrypt/re-encrypt per
workspace, which is exactly the machinery S2 builds anyway, so we are not painting
ourselves into a corner by deciding per-workspace today.

### Decision asked of the owner

Ratify: **per-workspace DEK stands; seat/tier key differentiation, if ever needed,
ships as credential profiles under the same DEK.** Rejecting this means pausing S2
and re-opening the AAD contract before any rotation work.
