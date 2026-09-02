---
github: https://github.com/hachej/boring-ui/issues/1082
issue: 1082
state: ready-for-human
updated: 2026-08-31
revision: r3.1
flag: not-needed
track: owner
---

# gh-1082 BYOK tenant keys — plan r3.1 (post-#1132)

> **Roadmap scope:** This document describes the broad generic credential-vault
> roadmap. It is not the controlling delivery plan for the first personal
> OpenAI Codex release. For that bounded slice,
> [`provider-onboarding-plan.md`](provider-onboarding-plan.md) r4 and the
> accepted asynchronous CredentialStore decision take precedence. Workspace
> credentials, generic provider onboarding, fleet, MCP, proxy-tool, migration,
> rotation, and sandbox work below are later roadmap slices.

Revision of the r1 draft (branch `docs/1082-byok-plan`, commit `5ebcd2422`)
now that **PR #1132 ([16f.2] KmsBackend + local-KEK envelope crypto) is open
and implements the crypto core**. This revision replans only what remains.
r3 folds the adversarial review of r2: external rollback anchor (S1),
envelope deletion port ops (S1), authenticated store pointer + dual-read
write rules (S8), S3 shipping dependency.
Companion decisions:

- [`key-scope-decision.md`](key-scope-decision.md) — retain per-workspace DEK
  scope.
- [`pi-async-credential-store-decision.md`](pi-async-credential-store-decision.md)
  — accepted 2026-08-31: migrate from Pi 0.80.7's synchronous
  `AuthStorageBackend` integration to the latest tested published Pi
  `CredentialStore` + `ModelRuntime` contract before provider onboarding.
  PR #1500 historically established 0.84.3; the PR 1 baseline is exact 0.84.4.

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
| Stale-write prevention | AAD version binding only | Complete-scope expected-version CAS (S1) |
| Historical snapshot rollback | Not protected | Deferred pending a qualified complete-scope external anchor and recovery protocol |
| DEK rotation | KEK rewrap only; `dekGeneration` frozen at 1 | Generation bump + field re-encrypt + online old-generation retirement (S2, gh-1082-f2) |
| Provider registry wiring | Test-only registries constructed in tests | Startup registry (Anthropic + Tavily/Firecrawl/Deepgram), backend selector, server wiring (S3) |
| Credential UI | None | Owner-only "Providers & credentials" surface, API-key write-only forms (S4, 16f.3 subset) |
| Fleet/seat interaction | `resolveSeatModel()` reads instance `process.env` only | Workspace-scoped key presence in tier resolution (S5, 16f.8 / wt-391-forward-703w) |
| First-party proxy tools | Operator keys only | Tier-1 host-side per-workspace resolution (S6, 16f.5) |
| MCP credentials | Separate `__serverBoringMcpSourcesV1` | Migrate onto shared mechanism (S7, 16f.4) |
| Legacy key migration | N/A | Off `WORKSPACE_SETTINGS_ENCRYPTION_KEY` for credential rows (S8, 16f.7) |

## Remaining slices (ordered)

### S1 — Postgres persistence + CAS + envelope deletion
**Blocked by:** #1132 merge.
Implement `CredentialVaultPersistenceV1` on Postgres using the ratified record,
wrapped-DEK, and field-envelope model. Subject-scoped consumers extend the
credential identity to `(workspaceId, subjectKind, subjectId, providerId)`.

Every mutation uses expected-version CAS under the complete-scope lock. CAS
prevents stale application writes; AEAD binds workspace, subject, provider,
field, version, and generation. Do not claim these controls detect restoration
of a complete internally consistent historical database snapshot.

Delete superseded field ciphertext transactionally after the new version is
durable. Retain one credential-scope authorization tombstone where product
semantics require it and one value-free lifecycle audit event; do not create a
per-field tombstone subsystem.

A future historical-rollback defense requires a separate `RollbackAnchorV1`
keyed by the complete credential identity and authenticating all authoritative
state. It must prove replica-safe external CAS, crash recovery, and
restore-forward behavior. A workspace-wide integer, mutable Postgres row, sealed
local file, or unqualified KMS metadata is not an accepted anchor.

**Proof:** conformance suite against Postgres; concurrent expected-version CAS;
subject/workspace/provider/field/version/generation swap rejection; interrupted
write recovery; superseded ciphertext absent after successful replacement.

### S2 — DEK-generation rotation and online retirement
**Bead:** `wt-391-forward-byok-dek-rotation-fil`
**Blocked by:** S1 and the resolved per-workspace DEK decision.

`rotateWorkspaceDek(workspaceId)` mints generation N+1, re-encrypts live field
envelopes with fresh nonces and generation-bound AAD, verifies them, atomically
switches current references, and then removes generation-N wrapped-DEK rows from
the live store.

Removing a live wrapped-DEK row is **online generation retirement**, not a claim
of crypto-shredding database or key backups. “Crypto-shred” is reserved for a
separately authorized operational workflow that proves permanent retirement of
every KEK/key version capable of unwrapping the targeted EDKs and accounts for
backup retention. If the selected backend cannot retire one generation
independently, the product must not advertise that granularity.

**Proof:** post-rotation reads succeed; generation-N is unavailable through the
live store; interrupted rotation resumes idempotently; backup and KEK-retirement
limits are stated accurately.

### S3 — Provider registry + backend selector wiring
**Bead:** part of 16f.3 scope, server side.
Startup provider registry (Anthropic model key first; Tavily/Firecrawl/
Deepgram definitions), consumer bindings, KMS backend selection from env
(local-KEK now; OVH-KMS provider is a follow-up implementation of the same
`WorkspaceKekProviderV1` port — owner Q1 from r1 stands), owner-only CRUD
routes (create/replace/disable/revoke/delete; masked last-4 metadata reads
only, no plaintext read API). Instance-fallback tombstone semantics per
Decision 27.
**Dependency note:** S3 builds against the `CredentialVaultPersistenceV1`
port (in-memory impl) now and can proceed in parallel, but ships to
production only after S1's schema lands — the disable/revoke tombstone state
S3 depends on is defined by S1's schema work.
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
Core mechanics unchanged from r1 (decrypt-once/re-encrypt/verify/
switch-pointer per (workspace, provider), rollback restores the previous safe
path only, retirement gated on backup retention + owner approval), with two
r3 specifications:

- **Authenticated store pointer.** The which-store-is-authoritative pointer
  is itself a downgrade lever: a DB-write attacker who flips it back to
  "legacy" re-routes reads through `WORKSPACE_SETTINGS_ENCRYPTION_KEY`
  ciphertext. Pointer protection is blocked on the future complete-scope
  `RollbackAnchorV1` decision described in S1 and owner decision 4; it must
  authenticate the pointer and authoritative credential state together. The
  rejected workspace-wide counter is not used. Legitimate rollback goes
  through the qualified anchored path, not a raw DB write.
- **Dual-read-window write rules.** Between re-encrypt and pointer switch,
  writes are forbidden on the legacy path: the migration marks the
  (workspace, provider) entry migration-locked before re-encrypting; a
  legacy-path write attempt during the window fails visibly (retryable
  error), never lands silently in a store about to stop being read. After
  the pointer switch, all writes go to the vault store only — no dual-write,
  ever.

**Blocked by:** S1 (schema, anchor, deletion port).

## Non-goals

- Reopening Decision 27 (BYOK-per-workspace policy) or platform-billed pooled
  keys (#809/BL1, pending #819 metering).
- Tier-2 in-sandbox credential delivery (16f.6) — still deferred behind the
  hostile-test harness + red-team pass.
- Generic OAuth provider flows remain deferred from this broad workspace-vault
  roadmap. The separately bounded personal OpenAI Codex MVP is an explicit
  carve-out and reuses Pi's device-code OAuth and refresh implementation; see
  [`provider-onboarding-plan.md`](provider-onboarding-plan.md) r4.
- Multi-profile-per-provider — one active credential per
  `(workspaceId, providerId)` stands; the key-scope memo shows how seat-tier
  profiles would extend this *without* a crypto change if ever ratified.
- Self-run Vault/OpenBao Transit as a shipped backend (optional alternative
  only; the `vault-transit-ciphertext.v1` wrapped-DEK format is reserved).
- OVH-KMS backend implementation is **scheduled but not specced here** — it is
  a second `WorkspaceKekProviderV1` implementation, gated on owner Q1 (r1).

## Owner decisions needed for the broad roadmap

1. **Key scope is resolved:** retain one DEK per workspace; subject identity is
   an authorization/AAD boundary, not a DEK boundary. See
   [`key-scope-decision.md`](key-scope-decision.md).
2. **Production custody is resolved:** OVH KMS is the production target;
   local-KEK remains development/self-host custody. Exact OVH API, IAM, outage,
   retirement, and audit behavior still require live qualification.
3. The instance-fallback default for a future workspace-credential launch
   remains open. It does not apply to the personal Codex MVP, which has no
   workspace/env/file fallback.
4. The external rollback-anchor design in S1 is not accepted for personal
   credentials as written: one workspace-wide integer cannot authenticate
   multiple independently versioned records. Any future rollback-resistant
   continuity feature requires a separate complete-scope anchor protocol and
   qualified atomic external store.
