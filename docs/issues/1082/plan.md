---
github: https://github.com/hachej/boring-ui/issues/1082
issue: 1082
state: ready-for-human
updated: 2026-08-07
flag: not-needed
track: owner
---

# gh-1082 BYOK tenant keys — vault storage, migration, onboarding, fleet interaction

## Problem

Model-key policy on `main` today is instance-only: `MODEL_TIER_CANDIDATES`
(`packages/agent/src/server/agentDefinition/loadConfiguredAgentFleet.ts:30`)
resolves each seat's tier to the first candidate whose `envVar` is present in
`process.env` (currently `ANTHROPIC_API_KEY` for every tier). There is no
per-workspace key anywhere in that path. Separately, a generic encrypted
key-value store exists — `workspace_settings`
(`packages/core/src/server/db/schema.ts`), `pgpsym_encrypt/decrypt` under one
app-wide `WORKSPACE_SETTINGS_ENCRYPTION_KEY`
(`packages/core/src/server/db/stores/PostgresWorkspaceStore.ts:145,794`) — but
its only observed tenant is MCP source registration
(`__serverBoringMcpSourcesV1`), not model credentials. A complete, frozen BYOK
type contract already exists and is unreachable:
`packages/agent/src/shared/credentials/` (registry, bindings, ref, authority,
lease, sandboxDelivery — landed under 16f.1, `in_progress`), re-exported from
`packages/agent/src/server/index.ts` but constructed by nothing. The harness
has no seam that accepts an invocation-scoped credential; it delegates
model auth wholesale to Pi's env-only path (Decision 27's "instance key
remains the fallback" is really the *only* path right now, not a fallback).

New consumer that changes the urgency calculus: #1114 (fleet loader,
`loadConfiguredAgentFleet.ts`) landed and made per-seat model resolution
tier-based and per-candidate-env-var-gated — `resolveSeatModel()` walks
`MODEL_TIER_CANDIDATES[tier]` and returns the first candidate whose env var
is set. Today that only ever checks the *instance's* env, so all five seats
across all workspaces see the same availability. A workspace bringing its own
key is exactly a workspace wanting a **different availability answer** for
that same per-seat/per-tier resolution — the fleet loader's resolution
function is the natural extension point (workspace-scoped key presence
instead of / in addition to instance env presence), not a parallel
mechanism. No such extension exists yet; `resolveSeatModel()` takes only
`env: NodeJS.ProcessEnv`, not a workspace identity.

## Today vs delta

| | Today (verified against `origin/main`) | Delta to v1 BYOK |
|---|---|---|
| Model key storage | Instance-only, `process.env.ANTHROPIC_API_KEY` | Per-workspace credential row, envelope-encrypted |
| Generic settings encryption | One app-wide `WORKSPACE_SETTINGS_ENCRYPTION_KEY`, `pgp_sym_encrypt` | Per-workspace DEK, AES-256-GCM, AAD-bound, `KmsBackend` abstraction |
| Credential type contract | Complete, frozen, unreferenced (`16f.1`, in progress) | Wire it: construct a registry + resolver, reconcile SBX1's stub |
| Vault/store backend | None | `KmsBackend` (OVH-KMS default managed-EU, local-KEK dev fallback) — `16f.2` |
| Onboarding UI | None (only Stripe/LemonSqueezy credit surfaces exist) | Owner-only "Providers & credentials" settings surface, API-key + OAuth — `16f.3` |
| MCP credentials | Per-user `__serverBoringMcpSourcesV1` metadata, separate from BYOK | Migrated onto shared mechanism, consent-quarantine on collision — `16f.4` |
| First-party proxy tools (search/transcription) | Operator-owned keys only | Host-side per-workspace resolution, Tier-1 pattern — `16f.5` |
| In-sandbox credential delivery | N/A | Deferred (`16f.6`) — gated behind hostile-test harness + red-team |
| Fleet/model-tier interaction | Env-var presence only, instance-wide | Fleet resolver must also check workspace-scoped key presence — **new gap, not covered by any existing 16f bead** |
| Legacy key retirement | N/A | Real migration off `WORKSPACE_SETTINGS_ENCRYPTION_KEY` for credential rows, with rollback — `16f.7` |

## Prior design (reuse, do not reinvent)

`docs/issues/820/byok-secret-vault-plan.md` carries a full owner-ratified
design (2026-07-20, 11 ratified decisions, amendments A/D/E) that this plan
does not redo:

- **Amendment A** — pluggable `KmsBackend`, OVH-KMS default managed-EU
  implementation, local-KEK dev fallback, self-run Vault/OpenBao optional.
  Per-workspace DEK, AES-256-GCM, canonical AAD
  (`workspaceId:credentialId:providerId:fieldId:credentialVersion:dekGeneration`).
  Fail-closed on unreadable/wrong-backend — never falls through to another
  backend or to instance fallback.
- **Amendment D** — credential-injection tiers. Tier 1 (host-side resolution,
  secret never leaves the host process) ships in v1. Tier 2 (in-sandbox
  delivery for untrusted tenant custom tools) is explicitly deferred behind a
  hostile-test harness (canary-secret exfiltration probe across env, `/proc`,
  `ps`, argv, docker inspect/labels/image layers, durable workspace, logs) plus
  a red-team pass.
- **Amendment E** — reuse pi's existing MCP connection/auth edge rather than
  duplicating it when generalizing MCP onto the shared mechanism.
- One active credential profile per `(workspaceId, providerId)` in v1 (no
  multi-profile-per-provider yet).
- Owner-only lifecycle (create/replace/OAuth-connect/disable/revoke/delete);
  consumers get a resolved lease, never a plaintext read API.
- Instance-key fallback is preserved only for an explicit
  `instance-fallback-enabled` state per (workspace, provider) — not a silent
  default — and disable/revoke leaves a durable fallback-suppression
  tombstone.
- MCP: never auto-promote a personal connection to workspace authority;
  quarantine collisions; require connected-user consent + current-owner
  approval.

Decision 27 (`docs/DECISIONS.md:436`) already records BYOK-per-workspace as
accepted policy; this plan does not reopen that, only its storage/onboarding/
migration/fleet-interaction mechanics.

## Solution (slices)

Six slices reuse the existing 16f.x bead IDs (already scoped, owner-ratified,
DoR-shaped); one slice is new (fleet/tier interaction — not covered by any
existing bead).

### Slice: 16f.2 vault storage — KmsBackend + envelope crypto
**Bead:** wt-391-forward-16f.2 (reuse)
**Delivers:** Dedicated credential schema/store, per-workspace DEK, AES-256-GCM
envelopes, `KmsBackend` abstraction (OVH-KMS default, local-KEK dev fallback).
**Blocked by:** 16f.1 (contract — `in_progress`)
**Proof:** Per bead's acceptance gates — no plaintext canary/DEK/KEK found in
raw Postgres inspection; corrupt ciphertext/nonce/tag/AAD/backend-ID/key-ref
each fail closed; cross-workspace/provider/field/version copies fail auth;
wrong/missing KMS key never triggers instance fallback.
**Review budget:** exceeds — crypto-conformance surface, split into schema +
backend-selector + OVH-KMS impl + local-KEK impl passes if picked up.

### Slice: 16f.3 onboarding flow — provider registry + API key + OAuth
**Bead:** wt-391-forward-16f.3 (reuse)
**Delivers:** Owner-only "Providers & credentials" settings surface; write-only
API-key forms (masked last-4 only); OAuth authorization-code + PKCE with
server-side refresh.
**Blocked by:** 16f.1, 16f.2
**Proof:** Per bead's acceptance gates — role-gated (owner only), no secret in
any GET/list/status/callback response, forged/replayed/cross-workspace OAuth
callbacks rejected, refresh-token rotation atomic under concurrency.
**Review budget:** exceeds — OAuth state machine + UI; likely a stacked pair
(API-key path first, OAuth second).

### Slice: 16f.4 MCP generalization onto shared mechanism
**Bead:** wt-391-forward-16f.4 (reuse)
**Delivers:** Migrate `@hachej/boring-mcp` onboarding/state/adapter onto the
shared credential mechanism; consent-quarantine on personal-connection
collision; reuse pi's MCP connection/auth edge (amendment E).
**Blocked by:** 16f.3
**Proof:** Per bead's acceptance gates — no auto-promotion of a personal
connection; departed-user promotion rejected; existing origin allowlisting/
redaction/readonly-tool policy preserved.
**Review budget:** inside, if pi's MCP edge inventory (prerequisite research)
is done separately first.

### Slice: 16f.5 first-party proxy tools (Tier-1 host-side)
**Bead:** wt-391-forward-16f.5 (reuse)
**Delivers:** Tavily/Firecrawl (web-search) and Deepgram/Whisper
(transcription) resolve their credential host-side via the 16f.1 contract;
secret never enters the sandbox.
**Blocked by:** 16f.2
**Proof:** Per bead's acceptance gates — two workspaces × ≥2 providers ×
concurrent calls observe only matching canaries; no secret in host-proxy
response headers/body/errors/logs/traces.
**Review budget:** inside.

### Slice: 16f.7 migration off WORKSPACE_SETTINGS_ENCRYPTION_KEY
**Bead:** wt-391-forward-16f.7 (reuse)
**Delivers:** Inventory every `workspace_settings` key + MCP source record,
classify metadata vs. credential material; for each legacy credential,
decrypt-once/re-encrypt-into-new-envelope/verify-via-resolver/dispose/switch
read pointer atomically per (workspace, provider); tombstone migrated rows;
never dual-write plaintext.
**Blocked by:** 16f.2
**Rollback:** Rollback restores the previous safe path only (re-point reads at
the legacy encrypted column) — it never converts new ciphertext back to
plaintext, and a row already migrated is never decrypted back into generic
settings. Retiring `WORKSPACE_SETTINGS_ENCRYPTION_KEY` for credentials happens
only after a full rollback window, backup retention, and owner approval; the
key may keep serving unrelated non-credential settings indefinitely.
**Proof:** Per bead's acceptance gates — every migrated envelope verified
before switching reads; no dual-write of secret values; rollback proof;
retirement gated on backup-retention + owner approval.
**Review budget:** inside, if scoped to one migration batch at a time
(inventory pass, then per-provider migration passes).

### Slice: NEW — fleet loader workspace-key extension
**Bead:** wt-391-forward-703w (new — "16f.8 BYOK fleet-loader workspace-key
resolution"; genuinely new, not covered by any prior 16f.x bead)
**Delivers:** Extend `resolveSeatModel()` / `MODEL_TIER_CANDIDATES` resolution
in `loadConfiguredAgentFleet.ts` to accept a workspace-scoped credential-
presence check (via the 16f.1 resolver, once 16f.2 lands) alongside instance
`env` presence, so a workspace with its own Anthropic key sees that tier's
candidate as available even when the instance env var is absent (or diverges
from the instance's key). Precedence: explicit workspace key when configured
> instance-fallback-enabled state (per the 16f.2/Decision 27 tombstone
semantics) > unavailable.
**Blocked by:** 16f.1, 16f.2 (needs a real resolver to query, not just the
type contract)
**Proof:** Fleet-compile test: workspace with a configured key resolves a
tier the instance env does not support; workspace without a key still falls
through to instance env exactly as today; a disabled/revoked workspace key
never silently falls back per the tombstone rule.
**Review budget:** inside, once 16f.2 lands — this is a small, well-bounded
resolver-signature change plus tests.

## Out of Scope

- Reopening Decision 27's BYOK-vs-platform-billed-pooled-keys policy (already
  decided; deferred to #809/BL1 pending #819 metering).
- Tier-2 in-sandbox credential delivery (`16f.6`, explicitly deferred behind a
  hostile-test harness + red-team; not scheduled by this plan).
- Multi-profile-per-provider (more than one active credential per
  `(workspaceId, providerId)`).
- Self-run HashiCorp Vault/OpenBao Transit as a shipped backend (named
  optional alternative only).

## Open Questions (owner)

1. **OVH-KMS vs. alternatives for the actual first backend build.** The plan
   names OVH-KMS as default with Scaleway/Exoscale as named alternates and
   local-KEK as dev fallback. Which one does 16f.2's first implementation pass
   target — OVH-KMS immediately (owner is already on OVH), or local-KEK first
   to unblock 16f.3–16f.5 development before the managed-KMS integration is
   qualified?
2. **Per-workspace vs. per-agent/per-seat keys.** The new fleet-interaction
   slice above assumes one workspace key per provider feeds all seats/tiers
   in that workspace uniformly (matching 16f.3's "one active profile per
   (workspaceId, providerId)"). Is that still correct now that fleets are
   tier-differentiated per seat (#1114), or does a Seneca-style tenant need
   distinct keys per seat/tier within one workspace (e.g. a cheaper key for
   T4/Haiku vs. a premium key for T1/Fable)? If yes, that's a new ratified
   decision, not an extension of the existing one-profile-per-provider rule.
3. **Are OAuth providers in v1**, or does v1 ship API-key-only providers
   (Anthropic, Tavily, Firecrawl, Deepgram) and defer OAuth (16f.3's PKCE flow)
   to a follow-up? OAuth is the highest-complexity slice in 16f.3 and isn't
   required for the model-key case that motivates this epic.
4. **Instance-fallback-enabled default for existing workspaces.** When 16f.7
   migrates today's all-instance-key world forward, do existing workspaces
   start in `instance-fallback-enabled` (so nothing breaks until they add a
   key) or unconfigured (so they must explicitly opt into the instance
   fallback)? Decision 27 says fallback is preserved only when explicitly
   registered — but every current workspace today is implicitly on the
   instance key with no registration at all.
5. **Does the new fleet-interaction slice get its own bead now**, or fold into
   16f.2/16f.3 review scope once those land? Filing it separately makes the
   fleet-loader gap explicit and reviewable on its own, but it has no
   independent value until 16f.1+16f.2 exist.
