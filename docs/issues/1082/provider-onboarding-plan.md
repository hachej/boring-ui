---
github: https://github.com/hachej/boring-ui/issues/1082
issue: 1082 (follow-on: pi provider onboarding)
state: ready-for-human
updated: 2026-08-08
revision: r1
track: owner
depends: PR #1132 (vault crypto, merged), PR #1145 (durable Postgres persistence, branch 196d22bd9 — not yet on main), [`plan.md`](plan.md) r3 (PR #1137)
---

# gh-1082 pi provider onboarding workflow — BYOK key → usable pi runtime provider

Goal: a workspace owner pastes an LLM provider API key (Anthropic / OpenAI /
Gemini / OpenAI-compatible custom), the server validates it, stores it in the
BYOK vault, and every subsequent pi session in that workspace can select and
run models on that provider — with rotation/revocation and fail-closed
semantics.

This plan is the *onboarding-workflow* specialization of 1082 plan-r3 slices
S3 (registry + routes) and S4 (credential UI), extended with the two pieces
r3 leaves abstract: **key validation ("test this key")** and **per-session
resolution into the pi ModelRegistry**.

## Today vs Delta

| Area | Today | Delta |
|---|---|---|
| Where keys come from | Instance `process.env` only. `packages/agent/src/server/models/modelConfig.ts` reads `ANTHROPIC_API_KEY` etc. via `getEnv`, plus `BORING_AGENT_CUSTOM_MODEL_*` / Infomaniak env blocks; pi `AuthStorage.create()` reads pi's own env/settings/auth files (comment in `createHarness.ts`: "Auth/model credentials are Pi-owned"). | Workspace-scoped keys resolved from the BYOK vault take precedence; instance env remains operator fallback per Decision 27 tombstone semantics. |
| Per-session registry | `createPiSession` (packages/agent/src/server/harness/pi-coding-agent/createHarness.ts ~L548) builds `AuthStorage.create()` → `ModelRegistry.create(authStorage)` → `registerConfiguredModelProviders(modelRegistry)`; all env-derived, workspace-blind. | Same construction site gains a workspace credential step: an `AuthStorage`-compatible key source backed by the host-side credential resolver (16f.1 `createHostSideCredentialResolverV1` / `withResolvedCredential`). |
| Vault | Crypto core merged (#1132): `packages/agent/src/server/credentials/vault/` (envelopeCrypto, local-KEK KmsBackend, vaultStoreBackend, persistence port). #1145 adds Postgres persistence + versionAnchor (branch, not on main). | Consumed as-is. Onboarding writes through `CredentialStoreBackendV1.writeCredentialFields` (fresh `credentialVersion` each write). |
| Provider registry | `ProviderRegistryV1` / `ProviderDefinitionV1` contract exists in `packages/agent/src/shared/credentials/registry.ts` (category `"llm"`, api-key field defs, consumer bindings, sandboxEgressOrigins) but only test registries construct it. | Startup registry with real LLM provider definitions (anthropic, openai, gemini, openai-compatible-custom) + consumer binding `llm-model-call.v1`. |
| Routes/UI | No credential routes, no credential UI. | Owner-only CRUD + validate routes; "Providers & credentials" settings surface in the workspace front. |
| Fleet tiers | `resolveSeatModel()` / `MODEL_TIER_CANDIDATES` in `loadConfiguredAgentFleet.ts` check instance env presence only. | Consult workspace credential presence via the resolver (r3 S5, bead wt-391-forward-703w). |
| Validation | None. | Server-side "test key" probe per provider before commit; re-probe on demand. |
| Rotation/revocation | Vault supports versioning + KEK rewrap; no user-facing trigger. | Replace (new version), disable, revoke+tombstone actions in routes/UI; revoked key suppresses instance fallback. |

## UX flow

Surface: **owner-only "Providers & credentials" panel in workspace settings**
(workspace front chrome, alongside existing settings; governance RBAC from
boring-governance gates it — non-owners see nothing, not a disabled panel).

1. **Provider list** — rendered from the server's provider registry (`GET
   /api/credentials/providers`): display name, category=llm badge, status per
   provider: `not-configured | active (…last4, vN, connected-at) | disabled |
   revoked | instance-fallback` .
2. **Connect** — clicking a provider opens a write-only form (fields from
   `ProviderCredentialDefinitionV1`: one secret `apiKey` field; custom
   provider additionally baseUrl + model id, mirroring the
   `BORING_AGENT_CUSTOM_MODEL_*` shape). Paste key → **Validate & save**.
   The front never stores the value: input state lives only in the form,
   submitted once over the authenticated route, then cleared.
3. **Validation feedback** — server probes the key (below). Success → key is
   committed to the vault and the row flips to `active` with last-4 +
   validated-at. Failure → typed error (`CREDENTIAL_VALIDATION_FAILED` with
   provider-safe reason: unauthorized / rate-limited / network), nothing
   stored. Optionally "Save anyway" is **not** offered in v1 — invalid keys
   are never persisted (fail-closed onboarding).
4. **Post-connect** — the model picker in pi chat shows the provider's models
   for this workspace on the next session; a hint on the panel says "new
   sessions use this key" (no retroactive rebind of live sessions).
5. **Manage** — per-provider actions: **Replace key** (same form, mints new
   credentialVersion), **Re-test**, **Disable** (temporarily unusable, no
   fallback), **Revoke** (tombstone; suppresses instance fallback per
   Decision 27), **Delete** (owner confirmation; envelope deletion per r3 S1).
6. **No plaintext read, ever** — no reveal button, no GET returns the value;
   metadata only (last4 captured server-side at write time).

## Server-side validation ("test this key")

New module `packages/agent/src/server/credentials/validation/` — per-provider
probe adapters keyed by `ProviderId`:

- anthropic: `GET https://api.anthropic.com/v1/models` (cheap, no tokens).
- openai: `GET /v1/models`.
- gemini: `GET v1beta/models` with key.
- openai-compatible custom: `GET {baseUrl}/models`; if the gateway lacks it,
  fall back to a 1-token completion probe flagged in the definition.

Rules:
- Probe runs **host-side only** (never in sandbox), egress restricted to the
  provider definition's `sandboxEgressOrigins`/probe origin.
- 10s timeout; result is `{ ok } | { ok:false, code, retryable }` — the raw
  provider response body is never logged or returned (may echo the key).
- Validation happens on a **pending** (uncommitted) value: probe first, write
  to vault only on success — the invalid material never touches persistence.
- Re-test action runs the same probe via `withResolvedCredential` (leased,
  60s TTL, zeroed after use) and updates `validatedAt` metadata only.

## Storage

Exactly the #1132/#1145 path, no new crypto:

- Write: routes call `vaultStoreBackend.writeCredentialFields(workspaceId,
  providerId, fields)` → fresh `credentialVersion`, AES-256-GCM field
  envelopes, AAD-bound, DEK wrapped by the selected `WorkspaceKekProviderV1`
  (local-KEK now; KMS backends later behind the same port).
- Persistence: Postgres impl from #1145 (`postgresPersistence.ts`,
  `versionAnchor.ts`). **Hard dependency: land #1145 on main first** — the
  onboarding UI must not ship against in-memory persistence.
- Metadata sidecar (non-secret): last4, validatedAt, status
  (active/disabled/revoked), createdBy — stored as plain columns beside the
  envelopes; last4 computed server-side before encryption, never derived by
  decrypting later.

## Provider registration → pi runtime resolution

Two layers:

**(a) Startup registry (r3 S3).** `packages/agent/src/server/credentials/
startupRegistry.ts`: `ProviderDefinitionV1` entries for anthropic / openai /
gemini / custom, consumer binding `llm-model-call.v1`, composed with the
authority verifier + vault backend into `createHostSideCredentialResolverV1`
inside `buildAgentComposition.ts`. Env selection of the KMS backend
(`BORING_CREDENTIAL_KMS_BACKEND=local-kek` + KEK file) stays explicit and
fail-closed.

**(b) Per-session injection.** In `createPiSession` (createHarness.ts), before
`ModelRegistry.create`: resolve workspace LLM credentials through the resolver
for the session's `workspaceId` and layer them into the key lookup pi uses:

- Introduce `createWorkspaceAuthStorage(baseAuthStorage, resolvedKeys)` — a
  thin wrapper implementing pi's `AuthStorage` read surface: workspace key for
  a provider wins; otherwise delegate to the env-backed base (instance
  fallback), **unless** the workspace credential is revoked-tombstoned, in
  which case the provider resolves to "no key" (fail closed, stable error
  `CREDENTIAL_REVOKED` surfaces as model-unavailable in the picker).
- `registerConfiguredModelProviders` gains a workspace-aware variant that also
  registers the workspace's custom OpenAI-compatible provider (baseUrl/model
  metadata from the non-secret credential metadata, key via the wrapper).
- Resolution happens **once per session creation** with a short-lived lease;
  the plaintext lives only inside the pi streaming client for that session.
  Live sessions keep the key they started with; rotation applies to new
  sessions (documented in UI).
- Model picker (`routes/models.ts`) becomes workspace-aware: list models whose
  provider has a usable key (workspace or non-suppressed instance fallback).

Invariant compliance: all of this is server-side (`packages/agent/src/server`),
shared contract stays `node:`-free and Uint8Array-only; routes receive
Workspace-scoped context, not raw paths; every error has a stable code in the
`CREDENTIAL_*` family (docs/ERROR_CODES.md parity test).

## Rotation / revocation touchpoints

- **Replace** = new write → new `credentialVersion`; version anchor (#1145)
  makes the old version unreadable-current; superseded envelopes deleted per
  r3 S1. New sessions pick it up immediately.
- **Disable/Revoke** = status flip + tombstone; the session-creation resolver
  treats both as "no workspace key"; revoke additionally suppresses instance
  fallback (Decision 27). Both are metadata ops — no crypto required.
- **DEK rotation / crypto-shred** (r3 S2) is out of scope here but the UI
  reserves an "Advanced → rotate workspace encryption" affordance stub gated
  on the key-scope owner decision.
- Instance-env keys are untouched by all of the above (operator-owned).

## Security constraints (fail-closed)

- No secret in logs: probe adapters and routes log provider id + error code
  only; request-body logging disabled on credential routes; test asserting
  key material absent from any log/route response (extend #1132's
  no-secret-in-errors proofs).
- No plaintext read API; front never holds the key outside the transient form.
- Missing/unreadable KEK, failed AAD, stale version anchor → typed
  `CREDENTIAL_*` error; **never** silent fallback to env for a workspace that
  has (or had) a workspace credential in revoked state.
- Validation and resolution run host-side; sandbox never sees Tier-1 keys
  (Tier-2 in-sandbox delivery stays deferred per r3 non-goals).
- Owner-only RBAC on every credential route, enforced server-side.

## PR-sized slices

1. **PR-A — land #1145** (Postgres persistence + version anchor) on main.
   Pre-existing branch; merge gate only.
2. **PR-B — startup provider registry + resolver composition** (r3 S3 server
   half): LLM provider definitions, `llm-model-call.v1` binding, composition
   in `buildAgentComposition.ts`, KMS backend env selection. Tests: registry
   shape, resolver end-to-end through vault, fail-closed on missing KEK.
3. **PR-C — credential routes + validation probes**: owner-gated CRUD
   (`create/replace/disable/revoke/delete`, metadata-only GET/list) +
   `POST …/validate` probe adapters. Tests: role gating, probe-before-write,
   no secret in any response/log, tombstone semantics.
4. **PR-D — per-session pi resolution**: `createWorkspaceAuthStorage`,
   workspace-aware `registerConfiguredModelProviders`, workspace-aware model
   list route. Tests: workspace key wins, revoked suppresses fallback,
   keyless workspace identical to today, no plaintext outside session scope.
5. **PR-E — Providers & credentials UI** (r3 S4): settings surface, connect/
   validate/manage flows, status chips. Tests: no credential value in any
   store/prop/response; RBAC invisibility for non-owners.
6. **PR-F — fleet tier integration** (r3 S5, bead wt-391-forward-703w):
   `resolveSeatModel()` consults workspace credential presence. Tests per r3.

Order: A → B → (C ∥ D) → E → F. Each slice green-gated and independently
revertible; UI (E) ships only after C+D so the flow is real end-to-end.

## Open questions (owner)

- r3 Q1 (local-KEK vs OVH-KMS for production) — unchanged, does not block.
- Fallback default for workspaces with an instance key but no workspace key
  at UI launch (show "instance fallback" chip vs hide) — recommend show, it
  makes revoke semantics legible.
- Which providers in v1: recommend anthropic + openai-compatible custom
  first (covers Gemini-via-OpenAI-compat and Infomaniak), native
  openai/gemini definitions in PR-B but can be flag-gated.
