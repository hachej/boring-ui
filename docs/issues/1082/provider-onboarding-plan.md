---
github: https://github.com/hachej/boring-ui/issues/1082
issue: 1082 (follow-on: pi provider onboarding)
state: ready-for-human
updated: 2026-08-08
revision: r3
track: owner
depends: PR #1132 (vault crypto, merged), PR #1145 (durable Postgres persistence, branch 196d22bd9 — not yet on main), [`plan.md`](plan.md) r3 (PR #1137)
---

# gh-1082 pi provider onboarding workflow — BYOK key → usable pi runtime provider

Goal: a workspace **member** connects an LLM provider for themselves
(Anthropic / OpenAI / Gemini / OpenAI-compatible custom — via OAuth
subscription login where the provider supports it, or an API key otherwise),
the server validates the credential, stores it in the BYOK vault, and every
subsequent pi session that member starts runs on their credential. A
workspace **owner** can additionally set a workspace-wide credential per
provider as the fallback for members without a personal one. Rotation/
revocation and fail-closed semantics throughout.

**Scope (owner directive 2026-08-08): user-specific onboarding first, with
the possibility to set a credential workspace-wide.**

## Ratified decisions (2026-08-08)

Owner rulings folded into this revision; the rest of the plan is
interpreted through them.

- **(a) Maximal pi reuse.** pi's `AuthStorage`, OAuth login flows, token
  refresh, and `ModelRegistry` are used **out of the box**. Net-new code is
  **only**: (1) the vault-backed `AuthStorageBackend` keyed `(workspaceId,
  userId, providerId)`, (2) the personal → workspace → env scoping rule,
  and (3) the settings menu (My providers / Workspace providers). Anything
  else a slice appears to build is wiring, not construction.
- **(b) Subscription posture.** **Subscriptions are interactive-only and
  personal-only; anything that runs without the user present requires an
  API key.** OAuth subscription tokens (Claude Pro/Max, Codex) are never
  promotable to workspace scope and never fund background runs. An
  automation whose creator lacks an API key for the needed provider
  **pauses with an Inbox Human Intention prompt** ("connect an API key or
  reassign") instead of running on a subscription.
- **(c) v1 provider set.** Connectable in v1: **Anthropic** (API key +
  Claude Pro/Max OAuth), **OpenAI** (API key + Codex OAuth), **Google**
  (API key). The rest of the pi catalog (github-copilot, xai, radius,
  openai-compatible custom, …) is **listed but not connectable** in v1 —
  rows render from pi's registry with a "not yet available" state.
- **(d) Funding-provenance chip.** The composer shows a small chip
  indicating which credential funds the current session (personal /
  workspace / provider label).
- **(e) Picker model.** The model picker shows **provenance-labeled
  provider rows** — workspace / personal / (platform credits, later) —
  and **selecting a row = choosing the funding source**, not just a model.

This plan is the *onboarding-workflow* specialization of 1082 plan-r3 slices
S3 (registry + routes) and S4 (credential UI), extended with the two pieces
r3 leaves abstract: **credential validation** and **per-session resolution
into the pi ModelRegistry**.

**r2 principle (owner feedback on r1): leverage pi as much as possible per
provider.** pi already owns credential typing (`api_key` | `oauth`), OAuth
login/refresh machinery, provider registration, and auth-status enumeration.
We do not hand-roll any of that; we supply pi a **vault-backed credential
storage backend** and broker its interactive flows over our routes.

## What pi already provides (verified against `@earendil-works/pi-coding-agent` 0.80.7 / `pi-ai` 0.80.x dist)

- **`AuthStorage`** (`dist/core/auth-storage.d.ts`) stores one credential per
  provider: `ApiKeyCredential { type:"api_key", key, env? }` or
  `OAuthCredential { type:"oauth", access, refresh, expires, … }`. Storage is
  pluggable: `AuthStorageBackend { withLock, withLockAsync }` +
  `AuthStorage.fromStorage(backend)` (file and in-memory backends ship; a
  custom backend is the supported extension point).
- **OAuth login flows ship with pi.** `AuthStorage.login(providerId,
  callbacks)` runs the provider's flow headlessly via `OAuthLoginCallbacks`
  (`onAuth{url}`, `onDeviceCode{userCode,verificationUri}`, `onPrompt`,
  `onManualCodeInput`, `onSelect`, `onProgress`, `signal`) — no TTY
  required, so a host can broker it to a browser UI. pi-ai ships provider
  implementations (`dist/auth/oauth/`): **anthropic (Claude Pro/Max, PKCE),
  openai-codex, github-copilot, xai, radius**, plus PKCE/device-code helpers
  and a local callback page. `ProviderAuth { apiKey?, oauth? }` with
  `OAuthAuth.login/refresh/toAuth` is the per-provider contract.
- **Token refresh is pi-owned and lock-serialized.**
  `AuthStorage.getApiKey()` auto-refreshes expired OAuth tokens under the
  backend lock (`refreshOAuthTokenWithLock`) and **persists the rotated
  token through the backend** — so a vault-backed backend receives refresh
  writes for free.
- **ModelRegistry is the provider catalog + status source.**
  `getAvailable()` (models whose provider has auth configured, no refresh),
  `hasConfiguredAuth(model)`, `getProviderAuthStatus(provider)` (`{configured,
  source, label}` — no secret values), `getProviderDisplayName`,
  `isUsingOAuth(model)`, and `registerProvider(name, config)` for custom
  OpenAI-compatible providers — including an `oauth` field for custom OAuth.
- **No dedicated "test this key" API.** The pi-native probe is: resolve auth
  (`getApiKeyAndHeaders`) and hit the provider's model-list endpoint using
  the provider's own base URL/header config; for OAuth, completing pi's
  login flow *is* the validation.

## Today vs Delta

| Area | Today | Delta |
|---|---|---|
| Where credentials come from | Instance `process.env` only. `packages/agent/src/server/models/modelConfig.ts` reads `ANTHROPIC_API_KEY` etc. via `getEnv`, plus `BORING_AGENT_CUSTOM_MODEL_*` / Infomaniak env blocks; pi `AuthStorage.create()` reads pi's own env/settings/auth files (comment in `createHarness.ts`: "Auth/model credentials are Pi-owned"). | Vault credentials (API key **or** pi OAuth token) take precedence, resolved per actor: personal `(workspaceId, userId, providerId)` → workspace-wide → instance env, per Decision 27 tombstone semantics. |
| Per-session registry | `createPiSession` (packages/agent/src/server/harness/pi-coding-agent/createHarness.ts ~L548) builds `AuthStorage.create()` → `ModelRegistry.create(authStorage)` → `registerConfiguredModelProviders(modelRegistry)`; all env-derived, workspace-blind. | Same construction site swaps in `AuthStorage.fromStorage(vaultBackend)` — a workspace-scoped `AuthStorageBackend` bridging pi's lock protocol to the vault via the host-side credential resolver (16f.1 `createHostSideCredentialResolverV1` / `withResolvedCredential`), with env-backed fallback. |
| OAuth | None (env keys only). | pi's built-in OAuth providers (anthropic Claude Pro/Max, openai-codex, github-copilot, …) become connectable per workspace: login brokered host-side, tokens vault-stored, refresh via pi's own machinery writing through the vault backend. |
| Vault | Crypto core merged (#1132): `packages/agent/src/server/credentials/vault/` (envelopeCrypto, local-KEK KmsBackend, vaultStoreBackend, persistence port). #1145 adds Postgres persistence + versionAnchor (branch, not on main). | Consumed as-is. Onboarding writes through `CredentialStoreBackendV1.writeCredentialFields` (fresh `credentialVersion` each write — including pi-initiated OAuth refresh writes). |
| Provider registry | `ProviderRegistryV1` / `ProviderDefinitionV1` contract exists in `packages/agent/src/shared/credentials/registry.ts` (category `"llm"`, api-key field defs, consumer bindings, sandboxEgressOrigins) but only test registries construct it. | Startup registry **derived from pi**: LLM provider definitions generated from pi's `ModelRegistry` provider set + `getOAuthProviders()` (auth kinds, display names), annotated with vault consumer binding `llm-model-call.v1` and egress origins — not a hand-maintained list. |
| Routes/UI | No credential routes, no credential UI. | Member-scoped connect (OAuth broker + API-key), status, revoke routes for personal credentials; owner-only workspace-scope + promote; "My providers" and "Workspace providers" surfaces rendered from the pi-derived registry. |
| Fleet tiers | `resolveSeatModel()` / `MODEL_TIER_CANDIDATES` in `loadConfiguredAgentFleet.ts` check instance env presence only. | Consult workspace credential presence via the resolver (r3 S5, bead wt-391-forward-703w). |
| Validation | None. | OAuth: completing pi's login flow. API key: pi auth resolution + provider model-list probe before commit; re-probe on demand. |
| Rotation/revocation | Vault supports versioning + KEK rewrap; no user-facing trigger. | Replace/re-login (new version), disable, revoke+tombstone actions in routes/UI; revoked credential suppresses instance fallback. OAuth refresh rotation handled by pi automatically. |

## Scope & resolution model (owner directive 2026-08-08)

**User-specific first, workspace-wide as fallback.**

- **Primary: per-user credentials.** Each member connects providers for
  themselves ("My providers"); stored in the vault keyed `(workspaceId,
  userId, providerId)` — the credential-profile pattern: additive rows, no
  AAD/crypto changes (see [`key-scope-decision.md`](key-scope-decision.md)).
- **Secondary: workspace-wide credential.** An owner can set one credential
  per provider workspace-wide — either directly or by **promoting their own
  personal credential** — as the fallback for members without a personal
  one. Stored as `(workspaceId, "workspace", providerId)`.
- **Resolution order, fail-closed and simple:** session actor's personal
  credential → workspace-wide credential → instance env. A
  revoked-tombstoned credential at any layer stops the chain for that layer
  per Decision 27 semantics (revoke suppresses fallback).
- **Automations/background runs** resolve with the **creator's** personal
  credential (persist `creatorUserId` on the automation record), then the
  same fallback chain — restricted to **API-key credentials only** per
  ratified decision (b): subscription OAuth tokens never fund unattended
  runs. If nothing API-key-backed resolves, the run **pauses** and an
  Inbox Human Intention item is raised ("connect an API key or reassign").
  An owner can reassign an automation's creator; that is the whole
  reassignment story in v1.
- **Offline liveness:** host-side pi-brokered OAuth refresh (vault-backed
  backend below) keeps creator-funded automations alive while the creator
  is offline — refresh needs no interactive session.

**Deferred directions (explicitly out of scope, one paragraph, kept for the
record):** agent-as-principal credential modeling, seat/tier credential
profiles, and funding-transfer/offboarding machinery beyond the minimal
"owner can reassign an automation's creator" above. None of these change
the vault schema chosen here; they layer on the same scope key.

## UX flow

Two surfaces, same components:

- **Primary: "My providers" in user settings** — every member connects
  providers for themselves. Personal credentials are visible/manageable
  only by their owner (and existence-only metadata to workspace owners).
- **Secondary: "Workspace providers" in workspace settings** — owner-only
  (governance RBAC from boring-governance; non-owners see nothing, not a
  disabled panel). Sets the workspace-wide fallback credential per
  provider, directly or via **"Promote to workspace"** on one of the
  owner's personal **API-key** credentials (copy, not move — mints a new
  workspace-scoped credentialVersion). Subscription OAuth credentials are
  never promotable (ratified decision (b)).

1. **Provider list** — rendered from the server's pi-derived provider
   registry (`GET /api/credentials/providers`): display name (pi
   `getProviderDisplayName`), supported auth methods (`oauth` and/or
   `api_key`, from pi's provider auth contract), status per provider and
   scope: `not-configured | active (kind: oauth|api-key, …last4/account,
   vN, connected-at) | disabled | revoked | workspace-fallback |
   instance-fallback` (status sourced from pi's `getProviderAuthStatus`
   over the resolved AuthStorage plus vault metadata).
2. **Connect (OAuth-capable provider — preferred path)** — "Sign in" starts
   a host-brokered pi login: the server runs `authStorage.login(providerId,
   callbacks)` against the workspace's vault-backed AuthStorage; the
   `OAuthLoginCallbacks` events stream to the front over the authenticated
   route (SSE/WS): `auth_url` opens the provider page in a new tab,
   `device_code` renders user-code + verification URI, `prompt`/
   `manual_code` render an input for the pasted callback code. On completion
   pi hands the `OAuthCredential` to the backend, which envelopes it into
   the vault. The login flow itself is the validation — no separate probe.
3. **Connect (API key)** — for key-only providers (or as the alternate
   method): write-only form (fields from `ProviderCredentialDefinitionV1`:
   one secret `apiKey` field; custom provider additionally baseUrl + model
   id, mirroring the `BORING_AGENT_CUSTOM_MODEL_*` shape). Paste key →
   **Validate & save**. The front never stores the value: input state lives
   only in the form, submitted once, then cleared.
4. **Validation feedback** — server validates via pi (below). Success →
   credential committed to the vault, row flips to `active` with
   last-4/account + validated-at. Failure → typed error
   (`CREDENTIAL_VALIDATION_FAILED` with provider-safe reason: unauthorized /
   rate-limited / network), nothing stored. "Save anyway" is **not** offered
   in v1 — invalid credentials are never persisted (fail-closed onboarding).
5. **Post-connect** — the model picker in pi chat shows the provider's
   models on the next session (pi `getAvailable()` over the actor-resolved
   AuthStorage) as **provenance-labeled rows** (personal / workspace;
   platform credits later) — selecting a row = choosing the funding source
   (ratified decision (e)). The composer shows a small
   **funding-provenance chip** for the current session (decision (d)). A
   hint on the panel says "new sessions use this credential" (no
   retroactive rebind of live sessions).
6. **Manage** — per-provider actions: **Reconnect / Replace key** (rerun
   login or key form, mints new credentialVersion), **Re-test**, **Disable**
   (temporarily unusable, no fallback), **Revoke** (tombstone; suppresses
   instance fallback per Decision 27; for OAuth also pi `logout` +
   best-effort provider-side revocation where pi's provider exposes it),
   **Delete** (owner confirmation; envelope deletion per r3 S1).
7. **No plaintext read, ever** — no reveal button, no GET returns the value;
   metadata only (last4/account label captured server-side at write time).

## Validation — delegate to pi

No hand-rolled per-provider probe adapters. Two cases:

- **OAuth providers:** pi's `login()` flow completing successfully *is*
  validation — pi exchanged codes with the provider and holds a working
  token. No additional probe. Re-test = pi auth resolution
  (`getApiKeyAndHeaders` on a cheap model of the provider), which exercises
  refresh if the token is expired.
- **API-key providers:** thin wrapper in `packages/agent/src/server/
  credentials/validation/` that (a) constructs a throwaway in-memory pi
  `AuthStorage` holding only the pending key, (b) resolves auth through
  pi's `ModelRegistry` for that provider — so base URLs, headers, and
  custom-provider config all come from pi's provider definitions, including
  workspace custom providers registered via `registerProvider` — and (c)
  issues the provider's model-list request with the resolved auth; providers
  whose gateway lacks a model-list endpoint fall back to a 1-token
  completion probe flagged in the definition.

Rules (unchanged from r1):
- Probe/login runs **host-side only** (never in sandbox), egress restricted
  to the provider definition's `sandboxEgressOrigins`/probe origin plus the
  OAuth endpoints pi's provider declares.
- 10s probe timeout (the OAuth login flow gets a longer, abortable window
  via the callbacks' `signal`); result is `{ ok } | { ok:false, code,
  retryable }` — the raw provider response body is never logged or returned
  (may echo the key).
- Validation happens on a **pending** (uncommitted) value: probe first,
  write to vault only on success — invalid material never touches
  persistence. (OAuth: pi's flow yields the credential only on success.)
- Re-test runs via `withResolvedCredential` (leased, 60s TTL, zeroed after
  use) and updates `validatedAt` metadata only.

## Storage

Exactly the #1132/#1145 path, no new crypto:

- Write: the vault-backed `AuthStorageBackend` (below) and the API-key route
  call `vaultStoreBackend.writeCredentialFields(workspaceId, providerId,
  fields)` → fresh `credentialVersion`, AES-256-GCM field envelopes,
  AAD-bound, DEK wrapped by the selected `WorkspaceKekProviderV1` (local-KEK
  now; KMS backends later behind the same port). OAuth credentials store the
  full pi `OAuthCredential` JSON (`access`, `refresh`, `expires`, provider
  extras) as encrypted fields; kind (`oauth` vs `api_key`) is non-secret
  metadata.
- **OAuth refresh write path:** each pi-initiated refresh is a normal
  versioned write — **new `credentialVersion` per refresh**, not a mutable
  token row. Justification: (1) the #1132 envelope AAD binds
  `credentialVersion`, so mutating in place would break AAD/anchor
  semantics; (2) the #1145 version anchor already provides atomic
  supersede + rollback detection — exactly the anti-double-refresh property
  pi's file lock provides locally; (3) refresh cadence (hours-scale token
  lifetimes) makes version churn negligible, and superseded envelopes are
  deleted per r3 S1. The backend's `withLockAsync` maps to a
  per-(workspace, provider) advisory lock around read-current-version →
  refresh → write-new-version.
- Persistence: Postgres impl from #1145 (`postgresPersistence.ts`,
  `versionAnchor.ts`). **Hard dependency: land #1145 on main first** — the
  onboarding UI must not ship against in-memory persistence.
- Metadata sidecar (non-secret): kind, last4/account label, validatedAt,
  status (active/disabled/revoked), createdBy — plain columns beside the
  envelopes; last4 computed server-side before encryption, never derived by
  decrypting later.

## Provider registration → pi runtime resolution

Two layers:

**(a) Startup registry (r3 S3), derived from pi.**
`packages/agent/src/server/credentials/startupRegistry.ts` builds
`ProviderDefinitionV1` entries **from pi's provider surface** — the provider
ids/display names/auth kinds that `ModelRegistry` +
`authStorage.getOAuthProviders()` expose, plus the workspace custom
OpenAI-compatible definition — annotated with consumer binding
`llm-model-call.v1` and egress origins, composed with the authority verifier
+ vault backend into `createHostSideCredentialResolverV1` inside
`buildAgentComposition.ts`. Adding a provider pi supports must not require a
hand-edited list here. Env selection of the KMS backend
(`BORING_CREDENTIAL_KMS_BACKEND=local-kek` + KEK file) stays explicit and
fail-closed.

**(b) Per-session injection.** In `createPiSession` (createHarness.ts),
replace `AuthStorage.create()` with:

- **Actor-aware resolution.** Session creation resolves an actor first:
  interactive → acting member's `userId`; background/automation → the
  automation's persisted `creatorUserId`. The vault backend is constructed
  for that actor and layers `(workspaceId, userId, providerId)` →
  `(workspaceId, "workspace", providerId)` → instance env, with the
  revoked-tombstone rule applying at each layer. If nothing resolves for
  an automation run, it fails closed with `CREDENTIAL_UNRESOLVED`: the run
  pauses and an Inbox Human Intention item is raised.
- `createVaultAuthStorageBackend(actorScope, resolver)` — implements pi's
  `AuthStorageBackend` (`withLock`/`withLockAsync`) over the vault:
  serialized read-modify-write per workspace, exposing the workspace's
  decrypted credentials to pi in pi's own `AuthStorageData` shape and
  persisting pi's writes (OAuth refresh, logout) back as versioned vault
  writes. Compose via `AuthStorage.fromStorage(backend)`. Fallback
  layering per provider: actor's personal credential → workspace-wide
  credential → env-backed instance credential, **unless** a credential in
  the chain is revoked-tombstoned, in which case the chain stops there
  (fail closed, stable error `CREDENTIAL_REVOKED` surfaces as
  model-unavailable in the picker). This replaces r1's
  read-only `createWorkspaceAuthStorage` wrapper — a full backend is
  required so **pi's OAuth refresh writes land in the vault** instead of
  being lost.
- `registerConfiguredModelProviders` gains a workspace-aware variant that
  also registers the workspace's custom OpenAI-compatible provider via pi's
  `registerProvider` (baseUrl/model metadata from non-secret credential
  metadata, key via the backend).
- Decrypted material is resolved lazily inside the backend under a
  short-lived lease; plaintext lives only inside pi's auth path for that
  session. Live sessions keep the credential they started with; rotation
  applies to new sessions (documented in UI) — except pi-initiated OAuth
  refresh, which updates the vault and the running session's in-memory
  token (pi's normal behavior).
- Model picker (`routes/models.ts`) becomes actor-aware by asking pi:
  `getAvailable()` over the actor-resolved AuthStorage (personal →
  workspace-wide → non-suppressed instance fallback).

Invariant compliance: all of this is server-side (`packages/agent/src/server`),
shared contract stays `node:`-free and Uint8Array-only; routes receive
Workspace-scoped context, not raw paths; every error has a stable code in the
`CREDENTIAL_*` family (docs/ERROR_CODES.md parity test).

## Rotation / revocation touchpoints

- **Replace / Reconnect** = new write → new `credentialVersion`; version
  anchor (#1145) makes the old version unreadable-current; superseded
  envelopes deleted per r3 S1. New sessions pick it up immediately.
- **OAuth refresh** = pi-automatic; versioned write through the backend as
  above. No UI affordance needed.
- **Disable/Revoke** = status flip + tombstone; the session-creation
  resolver treats both as "no workspace credential"; revoke additionally
  suppresses instance fallback (Decision 27) and, for OAuth, runs pi
  `logout` (+ provider-side revoke where pi's provider supports it). Both
  are metadata ops vault-side — no crypto required.
- **DEK rotation / crypto-shred** (r3 S2) is out of scope here but the UI
  reserves an "Advanced → rotate workspace encryption" affordance stub gated
  on the key-scope owner decision.
- **Creator credential death (automations):** if an automation's chain
  resolves to nothing (creator credential revoked/expired/unrefreshable and
  no workspace/instance fallback), the automation pauses and an Inbox Human
  Intention item is raised; an owner can reassign the automation's creator.
- Instance-env keys are untouched by all of the above (operator-owned).

## Security constraints (fail-closed)

- No secret in logs: routes and the login broker log provider id + error
  code only; OAuth callback events forwarded to the front carry URLs/user
  codes, never tokens; request-body logging disabled on credential routes;
  test asserting key/token material absent from any log/route response/
  broker event (extend #1132's no-secret-in-errors proofs).
- No plaintext read API; front never holds a key outside the transient
  API-key form; OAuth tokens never reach the client at all (flow is
  brokered server-side).
- Refresh happens host-side only, inside the vault-backed backend's lock;
  the sandbox never sees Tier-1 keys or OAuth tokens (Tier-2 in-sandbox
  delivery stays deferred per r3 non-goals).
- Missing/unreadable KEK, failed AAD, stale version anchor → typed
  `CREDENTIAL_*` error; **never** silent fallback to env for a workspace
  that has (or had) a workspace credential in revoked state.
- Scope RBAC on every credential route including the OAuth broker stream,
  enforced server-side: members touch only their own credentials;
  workspace-scope writes (including promote) are owner-only.

## PR-sized slices

1. **PR-A — land #1145** (Postgres persistence + version anchor) on main.
   Pre-existing branch; merge gate only.
2. **PR-B — pi-derived startup registry + resolver composition** (r3 S3
   server half): registry generated from pi's provider surface,
   `llm-model-call.v1` binding, composition in `buildAgentComposition.ts`,
   KMS backend env selection. Tests: registry mirrors pi's providers,
   resolver end-to-end through vault, fail-closed on missing KEK.
Trimmed per ratified decision (a): pi already provides auth storage
semantics, OAuth flows, refresh, validation-by-resolution, and the model
catalog — slices below build only the vault backend, the scoping rule, and
the menu; everything else is wiring pi surfaces to routes/UI. Expected
sizes shrink accordingly.

3. **PR-C — vault AuthStorage backend + routes** (the one real net-new
   module): `createVaultAuthStorageBackend` (scope rows, versioned refresh
   writes + advisory lock) and thin routes that call pi — member-scoped
   `connect`(api-key)/`status`/`disable`/`revoke`/`delete`, owner-gated
   workspace scope + promote (API-key only), metadata-only GET/list,
   **host-brokered pi `login()` event stream**. Validation is pi auth
   resolution + model-list call, no custom adapters. Tests: scope gating,
   probe/login-before-write, refresh mints new version under lock, no
   secret in any response/log/event, tombstone semantics. *Expected size:
   medium — backend + route shells; the auth logic is pi's.*
4. **PR-D — per-session wiring**: actor resolution + persisted
   `creatorUserId` (API-key-only rule for unattended runs),
   `AuthStorage.fromStorage(vaultBackend)` swapped into `createPiSession`,
   actor-aware model list via pi `getAvailable()`. No changes to pi's
   registry/refresh machinery. Tests: personal > workspace > env, creator
   API key funds automation, subscription never funds unattended runs,
   OAuth refresh persists to vault, revoked stops the chain, unresolved
   automation pauses + inbox item, keyless workspace identical to today.
   *Expected size: small — a swap at one construction site + resolution
   rule.*
5. **PR-E — settings menu + picker/chip**: "My providers" (all members) +
   "Workspace providers" (owner-only) rendered from pi's registry with v1
   connectable set (Anthropic, OpenAI, Google; rest listed as not yet
   available), pi login flow states (auth-url/device-code/code-paste),
   promote (API-key only), provenance-labeled picker rows + composer
   funding chip. Tests: no credential value in any store/prop/response;
   RBAC invisibility of the workspace panel; subscription rows show no
   promote affordance. *Expected size: medium — UI only, no new server
   concepts.*
6. **PR-F — fleet tier integration** (r3 S5, bead wt-391-forward-703w):
   `resolveSeatModel()` consults workspace credential presence. Tests per
   r3. *Expected size: small.*

Order: A → B → C → D → E → F (C precedes D since the vault backend lives
in C; B itself shrinks to composition/wiring since the provider catalog is
pi's). Each slice green-gated and independently revertible; UI (E) ships
only after C+D so the flow is real end-to-end.

## Open questions (owner)

- Plan-r3 Q1 of [`plan.md`](plan.md) (local-KEK vs OVH-KMS custody for
  production) — unchanged, does not block.
- Fallback default for workspaces with an instance key but no workspace
  credential at UI launch (show "instance fallback" chip vs hide) —
  recommend show, it makes revoke semantics legible.

(Provider set, subscription posture, picker/chip model: answered by the
ratified decisions above.)
