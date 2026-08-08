---
github: https://github.com/hachej/boring-ui/issues/1082
issue: 1082 (follow-on: pi provider onboarding)
state: ready-for-human
updated: 2026-08-08
revision: r2
track: owner
depends: PR #1132 (vault crypto, merged), PR #1145 (durable Postgres persistence, branch 196d22bd9 — not yet on main), [`plan.md`](plan.md) r3 (PR #1137)
---

# gh-1082 pi provider onboarding workflow — BYOK key → usable pi runtime provider

Goal: a workspace owner connects an LLM provider (Anthropic / OpenAI /
Gemini / OpenAI-compatible custom — via OAuth subscription login where the
provider supports it, or an API key otherwise), the server validates the
credential, stores it in the BYOK vault, and every subsequent pi session in
that workspace can select and run models on that provider — with
rotation/revocation and fail-closed semantics.

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
| Where credentials come from | Instance `process.env` only. `packages/agent/src/server/models/modelConfig.ts` reads `ANTHROPIC_API_KEY` etc. via `getEnv`, plus `BORING_AGENT_CUSTOM_MODEL_*` / Infomaniak env blocks; pi `AuthStorage.create()` reads pi's own env/settings/auth files (comment in `createHarness.ts`: "Auth/model credentials are Pi-owned"). | Workspace-scoped credentials (API key **or** pi OAuth token) resolved from the BYOK vault take precedence; instance env remains operator fallback per Decision 27 tombstone semantics. |
| Per-session registry | `createPiSession` (packages/agent/src/server/harness/pi-coding-agent/createHarness.ts ~L548) builds `AuthStorage.create()` → `ModelRegistry.create(authStorage)` → `registerConfiguredModelProviders(modelRegistry)`; all env-derived, workspace-blind. | Same construction site swaps in `AuthStorage.fromStorage(vaultBackend)` — a workspace-scoped `AuthStorageBackend` bridging pi's lock protocol to the vault via the host-side credential resolver (16f.1 `createHostSideCredentialResolverV1` / `withResolvedCredential`), with env-backed fallback. |
| OAuth | None (env keys only). | pi's built-in OAuth providers (anthropic Claude Pro/Max, openai-codex, github-copilot, …) become connectable per workspace: login brokered host-side, tokens vault-stored, refresh via pi's own machinery writing through the vault backend. |
| Vault | Crypto core merged (#1132): `packages/agent/src/server/credentials/vault/` (envelopeCrypto, local-KEK KmsBackend, vaultStoreBackend, persistence port). #1145 adds Postgres persistence + versionAnchor (branch, not on main). | Consumed as-is. Onboarding writes through `CredentialStoreBackendV1.writeCredentialFields` (fresh `credentialVersion` each write — including pi-initiated OAuth refresh writes). |
| Provider registry | `ProviderRegistryV1` / `ProviderDefinitionV1` contract exists in `packages/agent/src/shared/credentials/registry.ts` (category `"llm"`, api-key field defs, consumer bindings, sandboxEgressOrigins) but only test registries construct it. | Startup registry **derived from pi**: LLM provider definitions generated from pi's `ModelRegistry` provider set + `getOAuthProviders()` (auth kinds, display names), annotated with vault consumer binding `llm-model-call.v1` and egress origins — not a hand-maintained list. |
| Routes/UI | No credential routes, no credential UI. | Owner-only connect (OAuth broker + API-key), status, revoke routes; "Providers & credentials" settings surface rendered from the pi-derived registry. |
| Fleet tiers | `resolveSeatModel()` / `MODEL_TIER_CANDIDATES` in `loadConfiguredAgentFleet.ts` check instance env presence only. | Consult workspace credential presence via the resolver (r3 S5, bead wt-391-forward-703w). |
| Validation | None. | OAuth: completing pi's login flow. API key: pi auth resolution + provider model-list probe before commit; re-probe on demand. |
| Rotation/revocation | Vault supports versioning + KEK rewrap; no user-facing trigger. | Replace/re-login (new version), disable, revoke+tombstone actions in routes/UI; revoked credential suppresses instance fallback. OAuth refresh rotation handled by pi automatically. |

## Scope & attribution model (owner ruling, r2)

Owner ruling (PR #1151 comment): **"The creator of an automation should own
the associated tokens."** Generalized: **every session bills to the
credential of the human who caused it to exist.**

- **Interactive sessions** resolve the acting member's personal credential
  first; the workspace credential is the floor/fallback.
- **Automation/background runs** resolve the automation creator's
  credential, via a **persisted `creatorUserId`** on the automation record —
  independent of who later edits or triggers it (**editing ≠ funding
  transfer**; funding moves only by explicit reassignment).
- The **workspace credential remains the floor** for members/automations
  without a personal credential; instance env keys remain operator-owned
  fallback below that.

This supersedes r1's "workspace-scope only, per-user out of scope" note:
per-user credentials are **in scope** as an interactive+automation
attribution layer on top of the workspace vault (same envelope machinery,
credential scope key becomes `(workspaceId, userId | "workspace",
providerId)`; see [`key-scope-decision.md`](key-scope-decision.md) for the
DEK-scoping decision this feeds).

Consequences specced in this plan:
- **Actor-aware lease resolution** at session creation — including
  background sessions, which carry `creatorUserId` instead of an acting
  member (see per-session injection below).
- **Fail-closed pause on dead creator credentials:** if an automation's
  funding credential is revoked/expired/unrefreshable, the automation
  **pauses** and an **Inbox Human Intention item** is raised for
  reassignment — never silent fallback to the workspace key.
- **Offboarding gate:** removing a member requires reassigning the funding
  of automations they created (or accepting their pause).
- **Offline liveness:** host-side pi-brokered OAuth refresh (vault-backed
  backend below) keeps creator-funded automations alive while the creator
  is offline — refresh needs no interactive session.

## UX flow

Surface: **owner-only "Providers & credentials" panel in workspace settings**
(workspace front chrome, alongside existing settings; governance RBAC from
boring-governance gates it — non-owners see nothing, not a disabled panel).

1. **Provider list** — rendered from the server's pi-derived provider
   registry (`GET /api/credentials/providers`): display name (pi
   `getProviderDisplayName`), supported auth methods (`oauth` and/or
   `api_key`, from pi's provider auth contract), status per provider:
   `not-configured | active (kind: oauth|api-key, …last4/account, vN,
   connected-at) | disabled | revoked | instance-fallback` (status sourced
   from pi's `getProviderAuthStatus` over the workspace AuthStorage plus
   vault metadata).
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
   models for this workspace on the next session (pi `getAvailable()` over
   the workspace AuthStorage); a hint on the panel says "new sessions use
   this credential" (no retroactive rebind of live sessions).
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

- **Actor-aware resolution.** Session creation resolves a funding scope
  first: interactive → acting member's `userId`; background/automation →
  the automation's persisted `creatorUserId`. The vault backend is
  constructed for that scope and layers `(workspaceId, userId, providerId)`
  → `(workspaceId, "workspace", providerId)` → instance env, with the
  revoked-tombstone fail-closed rule applying at each layer. For automation
  sessions whose creator credential is dead (revoked/expired/unrefreshable),
  resolution fails closed with `CREDENTIAL_CREATOR_UNAVAILABLE`: the run
  pauses and an Inbox Human Intention item is raised — no silent drop to
  the workspace key.
- `createVaultAuthStorageBackend(fundingScope, resolver)` — implements pi's
  `AuthStorageBackend` (`withLock`/`withLockAsync`) over the vault:
  serialized read-modify-write per workspace, exposing the workspace's
  decrypted credentials to pi in pi's own `AuthStorageData` shape and
  persisting pi's writes (OAuth refresh, logout) back as versioned vault
  writes. Compose via `AuthStorage.fromStorage(backend)`. Fallback
  layering: a provider with no workspace credential delegates to the
  env-backed instance credential (instance fallback), **unless** the
  workspace credential is revoked-tombstoned, in which case the provider
  resolves to "no key" (fail closed, stable error `CREDENTIAL_REVOKED`
  surfaces as model-unavailable in the picker). This replaces r1's
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
- Model picker (`routes/models.ts`) becomes workspace-aware by asking pi:
  `getAvailable()` over the workspace AuthStorage (workspace credential or
  non-suppressed instance fallback).

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
- **Creator credential death (automations):** revoke/expiry/refresh failure
  of a member credential pauses every automation funded by it and raises an
  Inbox Human Intention item ("reassign funding for N automations");
  **offboarding a member is gated on resolving these** (reassign or accept
  pause). Editing an automation never silently re-funds it.
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
- Owner-only RBAC on every credential route including the OAuth broker
  stream, enforced server-side.

## PR-sized slices

1. **PR-A — land #1145** (Postgres persistence + version anchor) on main.
   Pre-existing branch; merge gate only.
2. **PR-B — pi-derived startup registry + resolver composition** (r3 S3
   server half): registry generated from pi's provider surface,
   `llm-model-call.v1` binding, composition in `buildAgentComposition.ts`,
   KMS backend env selection. Tests: registry mirrors pi's providers,
   resolver end-to-end through vault, fail-closed on missing KEK.
3. **PR-C — vault AuthStorage backend + credential routes + validation**:
   `createVaultAuthStorageBackend` (incl. versioned refresh writes +
   advisory lock), owner-gated routes (`connect`(api-key)/`status`/
   `disable`/`revoke`/`delete`, metadata-only GET/list), pi-based key
   validation, **host-brokered OAuth login route + event stream**. Tests:
   role gating, probe/login-before-write, refresh write mints new version
   under lock, no secret in any response/log/event, tombstone semantics.
4. **PR-D — per-session pi resolution**: `AuthStorage.fromStorage(vault
   backend)` in `createPiSession`, workspace-aware
   `registerConfiguredModelProviders`, workspace-aware model list via pi
   `getAvailable()`. Tests: workspace credential wins, OAuth refresh
   persists to vault, revoked suppresses fallback, keyless workspace
   identical to today, no plaintext outside session scope.
5. **PR-E — Providers & credentials UI** (r3 S4): settings surface rendered
   from the pi-derived registry, OAuth login flow UI (auth-url/device-code/
   code-paste states), API-key connect/manage flows, status chips. Tests:
   no credential value in any store/prop/response; RBAC invisibility for
   non-owners.
6. **PR-F — fleet tier integration** (r3 S5, bead wt-391-forward-703w):
   `resolveSeatModel()` consults workspace credential presence. Tests per r3.
7. **PR-G — creator-funding attribution layer** (owner ruling): per-user
   credential scope in vault + routes/UI ("My credentials" alongside the
   owner panel), persisted `creatorUserId` on automations, actor-aware
   funding-scope resolution wired into PR-D's backend construction,
   dead-credential pause + Inbox Human Intention item, offboarding
   reassignment gate. Tests: interactive resolves member-then-workspace,
   automation resolves creator, editing does not transfer funding, dead
   creator credential pauses (never falls back), offboarding blocked until
   reassignment.

Order: A → B → C → D → E → F → G (C precedes D since the vault backend
lives in C; A–F are workspace-floor-complete without G, and G layers
attribution on top without reworking them — PR-D's funding-scope parameter
is designed in from the start). Each slice green-gated and independently
revertible; UI (E) ships only after C+D so the flow is real end-to-end.

## Open questions (owner)

- r3 Q1 (local-KEK vs OVH-KMS for production) — unchanged, does not block.
- Fallback default for workspaces with an instance key but no workspace
  credential at UI launch (show "instance fallback" chip vs hide) —
  recommend show, it makes revoke semantics legible.
- Which providers in v1: recommend **anthropic (OAuth Claude Pro/Max +
  API-key) and openai-compatible custom** first (covers
  Gemini-via-OpenAI-compat and Infomaniak); other pi OAuth providers
  (openai-codex, github-copilot) come free from the pi-derived registry but
  can be flag-gated.
- **Subscription OAuth ToS posture:** pi's anthropic/openai-codex OAuth
  flows authenticate personal subscription accounts (Claude Pro/Max,
  ChatGPT Codex). Is offering these in a multi-user workspace product
  acceptable, or is v1 OAuth limited to providers whose terms clearly
  permit shared use? Recommend an owner ruling before PR-E exposes them.
