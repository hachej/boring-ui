---
github: https://github.com/hachej/boring-ui/issues/1082
issue: 1082
state: ready-for-human
updated: 2026-08-07
revision: r2
flag: not-needed
track: owner
---

# gh-1082 BYOK tenant keys — plan r2 (post-#1132)

Revision of the r1 draft (branch `docs/1082-byok-plan`, commit `5ebcd2422`)
now that **PR #1132 ([16f.2] KmsBackend + local-KEK envelope crypto) is open
and implements the crypto core**. This revision replans only what remains.
Companion decision memo: [`key-scope-decision.md`](key-scope-decision.md)
(per-workspace vs per-seat DEK scoping — owner decision required before the
rotation slice).

## What #1132 already delivers (verified against the PR diff)

`packages/agent/src/server/credentials/vault/`:

- `envelopeCrypto.ts` — AES-256-GCM field envelopes, 12-byte random nonce,
  16-byte tag, canonical **length-prefixed** AAD
  (`workspaceId:credentialId:providerId:fieldId:credentialVersion:dekGeneration`,
  versioned prefix, no boundary ambiguity), constant-time AAD compare,
  code-only errors (`CREDENTIAL_UNREADABLE`, never "absent").
- `kmsBackend.ts` — `WorkspaceKekProviderV1` local-KEK implementation:
  sealed 32-byte KEK file (explicit env selection, no plaintext-env default,
  never `WORKSPACE_SETTINGS_ENCRYPTION_KEY`), wrap/unwrap/rewrap of the
  per-workspace DEK with workspace+generation-bound AAD, readiness reporting,
  best-effort buffer zeroing.
- `vaultStoreBackend.ts` — composes KmsBackend + envelope crypto + an
  **injectable persistence port** into the `CredentialStoreBackendV1` the
  existing host resolver consumes. Every `writeCredentialFields` mints a fresh
  `credentialVersion`; `rewrapWorkspaceDek` rotates KEK wrapping in place.
- `persistence.ts` / `inMemoryPersistence.ts` — port + in-memory impl.
  **Postgres persistence is explicitly out of scope of #1132.**
- 700+ lines of conformance tests: tamper/swap/cross-workspace/cross-backend
  fail-closed proofs, no-secret-in-errors proofs, end-to-end through the
  frozen 16f.1 contract (`createHostSideCredentialResolverV1`,
  `withResolvedCredential`).

Known, filed gaps from the #1132 crypto review (beads):

- `wt-391-forward-byok-version-rollback-0th` (gh-1082-f1): AAD binds *which
  version a row is*, not *which version is current* — a DB-write attacker can
  point `record.credentialVersion` back at a rotated-away (leaked) version and
  it decrypts cleanly. Rotate-after-leak is not cryptographically durable.
- `wt-391-forward-byok-dek-rotation-fil` (gh-1082-f2): `dekGeneration` is
  always `existing ?? 1`; nothing increments it. The per-workspace crypto-shred
  lever currently depends entirely on destroying the KMS key; nonce-space never
  resets (safe at realistic volume, but unbounded DEK lifetime).

## Today vs delta

| | Today (with #1132 merged) | Delta to v1 BYOK |
|---|---|---|
| Envelope crypto + local-KEK backend | Done (#1132) | — |
| Persistence | In-memory port impl only | Postgres schema/store behind the same port (S1) |
| Rollback prevention | AAD version binding only; current-version pointer unauthenticated | Monotonic authenticated current-version marker (S1, gh-1082-f1) |
| DEK rotation | KEK rewrap only; `dekGeneration` frozen at 1 | Generation bump + field re-encrypt + old-generation destruction (S2, gh-1082-f2) |
| Provider registry wiring | Test-only registries constructed in tests | Startup registry (Anthropic + Tavily/Firecrawl/Deepgram), backend selector, server wiring (S3) |
| Credential UI | None | Owner-only "Providers & credentials" surface, API-key write-only forms (S4, 16f.3 subset) |
| Fleet/seat interaction | `resolveSeatModel()` reads instance `process.env` only | Workspace-scoped key presence in tier resolution (S5, 16f.8 / wt-391-forward-703w) |
| First-party proxy tools | Operator keys only | Tier-1 host-side per-workspace resolution (S6, 16f.5) |
| MCP credentials | Separate `__serverBoringMcpSourcesV1` | Migrate onto shared mechanism (S7, 16f.4) |
| Legacy key migration | N/A | Off `WORKSPACE_SETTINGS_ENCRYPTION_KEY` for credential rows (S8, 16f.7) |

## Remaining slices (ordered)

### S1 — Postgres persistence + authenticated current-version marker
**Beads:** new (Postgres pass) + `wt-391-forward-byok-version-rollback-0th`
**Blocked by:** #1132 merge.
Implement `CredentialVaultPersistenceV1` on Postgres (3 tables matching the
ratified model: credential record, wrapped DEK, field envelopes). Fold the
rollback fix into this pass, per the bead ("do before the Postgres pass"):
make the current-version pointer cryptographically authenticated — e.g. a
per-record MAC/mini-envelope under the workspace DEK covering
`(credentialId, currentVersion, dekGeneration, materialKind)`, verified on
every read, plus monotonic-version enforcement in the store (reject any write
that does not strictly increase `credentialVersion`). A DB-write rollback then
fails as `CREDENTIAL_UNREADABLE`, not a silent downgrade.
**Proof:** #1132's conformance suite re-run against Postgres persistence;
new test: pointer rolled back to v1 after rotation to v2 → fail closed.

### S2 — DEK-generation rotation (crypto-shred lever)
**Bead:** `wt-391-forward-byok-dek-rotation-fil`
**Blocked by:** S1 (needs durable persistence + the authenticated marker so
rotation state itself cannot be rolled back) **and the key-scope decision**
(rotation machinery is per-key-scope; don't build it twice).
Owner-triggered + operator-triggered `rotateWorkspaceDek(workspaceId)`:
mint generation N+1, re-encrypt all live field envelopes under the new DEK
(new AAD `dekGeneration`), atomically bump record `dekGeneration`, then
destroy generation-N wrapped-DEK rows after verification. Crypto-shred =
rotate-then-destroy without re-encrypting (deliberate data loss path, owner
confirmation required).
**Proof:** post-rotation reads succeed; generation-N ciphertext no longer
decryptable via the store; interrupted-rotation recovery (idempotent resume);
shred leaves `CREDENTIAL_UNREADABLE`, never a plaintext residue or fallback.

### S3 — Provider registry + backend selector wiring
**Bead:** part of 16f.3 scope, server side.
Startup provider registry (Anthropic model key first; Tavily/Firecrawl/
Deepgram definitions), consumer bindings, KMS backend selection from env
(local-KEK now; OVH-KMS provider is a follow-up implementation of the same
`WorkspaceKekProviderV1` port — owner Q1 from r1 stands), owner-only CRUD
routes (create/replace/disable/revoke/delete; masked last-4 metadata reads
only, no plaintext read API). Instance-fallback tombstone semantics per
Decision 27.
**Proof:** route tests — role gating, no secret in any GET/list/status
response, disable/revoke tombstone suppresses instance fallback.

### S4 — Front-end credential UI
**Bead:** 16f.3 (UI subset; API-key only, **OAuth deferred** — owner Q3
from r1: v1 providers are all API-key, OAuth is 16f.3's highest-complexity
part and not needed for the motivating model-key case).
Owner-only "Providers & credentials" workspace settings surface: provider
list from registry, write-only key form, last-4 + status + version +
connected-at display, disable/revoke/replace actions, fallback-state
indicator.
**Proof:** SettingsSurface tests; no credential value ever present in any
front-end store, prop, or network response.

### S5 — Fleet-seat integration (workspace-key tier resolution)
**Bead:** `wt-391-forward-703w` (16f.8).
Extend `resolveSeatModel()` / `MODEL_TIER_CANDIDATES` in
`loadConfiguredAgentFleet.ts` to consult workspace-scoped credential presence
(via the resolver) alongside instance env. Precedence: explicit workspace key
> instance-fallback-enabled state > unavailable. Per the key-scope memo's
recommendation, seat/tier key differentiation (if ever wanted) arrives as
distinct credential profiles, not as a resolver fork.
**Proof:** fleet-compile tests — workspace key unlocks a tier the instance
lacks; keyless workspace behaves exactly as today; revoked key never silently
falls back.

### S6 — First-party proxy tools, Tier-1 host-side (16f.5)
Unchanged from r1. **Blocked by:** S3.

### S7 — MCP generalization onto shared mechanism (16f.4)
Unchanged from r1 (consent-quarantine, amendment E, no auto-promotion).
**Blocked by:** S3/S4.

### S8 — Migration off `WORKSPACE_SETTINGS_ENCRYPTION_KEY` (16f.7)
Unchanged from r1 (decrypt-once/re-encrypt/verify/switch-pointer, rollback
restores previous safe path only, retirement gated on backup retention +
owner approval). **Blocked by:** S1.

## Non-goals

- Reopening Decision 27 (BYOK-per-workspace policy) or platform-billed pooled
  keys (#809/BL1, pending #819 metering).
- Tier-2 in-sandbox credential delivery (16f.6) — still deferred behind the
  hostile-test harness + red-team pass.
- OAuth provider flows (PKCE, refresh rotation) — deferred out of v1 with the
  error codes already reserved (`CREDENTIAL_OAUTH_*`).
- Multi-profile-per-provider — one active credential per
  `(workspaceId, providerId)` stands; the key-scope memo shows how seat-tier
  profiles would extend this *without* a crypto change if ever ratified.
- Self-run Vault/OpenBao Transit as a shipped backend (optional alternative
  only; the `vault-transit-ciphertext.v1` wrapped-DEK format is reserved).
- OVH-KMS backend implementation is **scheduled but not specced here** — it is
  a second `WorkspaceKekProviderV1` implementation, gated on owner Q1 (r1).

## Owner decisions needed

1. **Key scope** — decide from [`key-scope-decision.md`](key-scope-decision.md)
   (blocks S2).
2. r1's Q1 (local-KEK-first vs OVH-KMS-first for production) and Q4
   (instance-fallback default for existing workspaces at S8 migration time)
   remain open; Q3 (OAuth) and Q5 (separate fleet bead) are resolved in this
   revision (deferred; separate bead `wt-391-forward-703w`).
