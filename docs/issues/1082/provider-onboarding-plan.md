---
github: https://github.com/hachej/boring-ui/issues/1082
issue: 1082 (personal OpenAI Codex onboarding)
state: ready-for-review
updated: 2026-09-02
revision: r4.1
track: owner
depends: [`pi-async-credential-store-decision.md`](pi-async-credential-store-decision.md), [`key-scope-decision.md`](key-scope-decision.md)
---

# gh-1082 personal OpenAI Codex onboarding — implementation plan r4.1

## Goal

A workspace member connects their own ChatGPT Plus/Pro subscription and uses
Pi's `openai-codex` provider in interactive sessions inside that workspace.
Only that authenticated member may list, refresh, disconnect, or use the
credential, and only in the workspace where they connected it.

Pi owns provider behavior: OAuth, expiry detection, refresh-token rotation,
request authentication, model availability, and login/logout orchestration.
Boring owns actor authorization, scope selection, durable encrypted custody,
concurrency, audit, failure policy, and rollout. Seneca consumes the resulting
published Boring packages after the upstream slices are green.

## Controlling scope

This document is the controlling delivery plan for the first personal Codex
release. The broader plans in [`plan.md`](plan.md) and
[`../820/byok-secret-vault-plan.md`](../820/byok-secret-vault-plan.md) remain
long-term credential-platform roadmaps where they do not conflict with this
bounded slice.

### In scope

- one Pi provider: `openai-codex`;
- one auth kind: Pi-managed OAuth subscription;
- one credential identity: `(workspaceId, userId, "openai-codex")`;
- request-attached interactive sessions only;
- actor-bound asynchronous Pi `CredentialStore`;
- Postgres ciphertext and a per-workspace DEK protected by OVH KMS;
- Pi-native device-code connect, metadata-only status, refresh, and disconnect;
- actor-aware Codex model availability;
- a minimal personal settings card and model-picker connection CTA;
- one-workspace, feature-flagged canary rollout.

### Explicitly deferred

- workspace-wide credentials, sharing, promotion, or fallback;
- API-key onboarding and personal API-key/OAuth coexistence;
- Anthropic, Google, custom OpenAI-compatible providers, or a generic provider UI;
- automations, scheduled/queued/detached work, unattended agents, or background
  agent workers funded by a subscription;
- funding-source selection, provenance picker rows, fleet-tier integration, and
  workspace billing policy;
- MCP, search, transcription, plugins, and sandbox credential delivery;
- dynamic KMS-key provisioning, DEK generation rotation, crypto-shred workflows,
  legacy credential migration, and external rollback anchoring.

The existing env/file behavior for non-Codex providers remains unchanged during
this slice. `openai-codex` is intercepted by the personal actor store and never
falls through to process env, a global `auth.json`, a workspace credential, or
another user's credential.

## Completed prerequisite

The coordinated Pi 0.84.3 compatibility migration is merged in
[PR #1500](https://github.com/hachej/boring-ui/pull/1500) as commit
`150465a03966ac316c609ceecd28bf487d9297c2`. Boring now constructs Pi through
`ModelRuntime`, preserves existing provider behavior, and exposes the
asynchronous `CredentialStore` injection seam. PR CI and post-merge main CI
completed successfully in runs
[`33417316976`](https://github.com/hachej/boring-ui/actions/runs/33417316976) and
[`33418777339`](https://github.com/hachej/boring-ui/actions/runs/33418777339).
A dirty or stale local checkout is not evidence that this upstream prerequisite
is unmerged; implementation branches must start from the cited merge commit or a
newer `origin/main`.

This plan must not reintroduce `AuthStorage`, `AuthStorageBackend`, or
`ModelRegistry` in production source.

## Forward Pi version policy

PR #1500 remains the historical 0.84.3 prerequisite. It is not a version ceiling.
At execution time on 2026-09-02, npm reported 0.84.4 as latest for the coordinated
Pi family, and PR 1 moved the exact lockfile-pinned set to 0.84.4 after package
contract, conformance, typecheck, build, and invariant validation.

Every implementation slice must re-check npm for the latest published Pi release
before coding. It must pin the complete coordinated family to exactly one tested
version: `pi-coding-agent`, `pi-agent-core`, `pi-ai`, `pi-client`, `pi-protocol`,
`pi-telemetry`, and `pi-tui`. Versions must never float and a family must never be
mixed. Each slice runs published-package contract/conformance tests. If the
latest release is incompatible, the slice records the exact failing contract,
the pinned holdback version, and an intentional owner-approved holdback; it does
not silently retain an older release.

## Ratified decisions

1. **Personal and workspace-bound.** Credential identity is
   `(workspaceId, subjectKind="user", subjectId=userId,
   providerId="openai-codex")`.
2. **Interactive only.** The store is available only to a currently authorized,
   request-attached interactive execution. Automation, detached, queued,
   scheduled, and background-worker construction never receives it.
3. **No fallback for Codex.** Absent, disconnected, unreadable, or revoked means
   Codex is unavailable. The resolver never tries workspace, env, or file auth.
4. **Pi-native credential.** Persist the complete bounded Pi Codex credential
   needed for restart-safe native refresh: `type`, `access`, `refresh`,
   `expires`, and `accountId`.
5. **Per-workspace DEK.** Authorization scope does not become encryption-key
   scope. Personal records share the workspace DEK but use subject-bound AAD v2.
6. **OVH production custody.** OVH KMS is the production KEK holder. The first
   canary uses one manually provisioned, non-exportable regional wrapping key;
   product traffic cannot create, rotate, or delete it.
7. **Honest rollback boundary.** The MVP protects confidentiality, row binding,
   ciphertext integrity, and stale application writes. It does not claim
   cryptographic continuity against restoration of a complete internally
   consistent historical database snapshot.
8. **No plaintext delivery.** Tokens never enter browser responses, workspace
   files, session/event payloads, transcripts, logs, traces, analytics, tool
   arguments, sandbox processes, or automation records.

## Target architecture

```text
Authenticated member browser
  │
  │ Codex device-code connect / status / disconnect
  ▼
Actor-authorized host route
  │ verified workspaceId + current userId + interactive execution
  ▼
Actor-bound ModelRuntime
  │
  ▼
Composite CredentialStore
  ├─ openai-codex ──> personal vault store (no fallback)
  └─ other providers ──> existing compatibility store
                         (unchanged env/file behavior)
  │
  ▼
Postgres advisory lock + expected-version CAS
  │
  ▼
Envelope vault
  │ subject-bound AAD v2
  ▼
Postgres ciphertext + wrapped per-workspace DEK
  │
  ▼
Manually provisioned OVH KMS regional wrapping key
```

The browser sees a verification URI and short-lived user code during device
login. It never sees an OAuth access token, refresh token, provider auth header,
plaintext DEK, wrapped DEK, ciphertext, or KMS reference.

## Credential identity, schema, and AAD

### Logical identity

Use the future-compatible identity:

```text
(workspaceId, subjectKind, subjectId, providerId)
```

For this release:

```text
subjectKind = "user"
subjectId   = verified authenticated userId
providerId  = "openai-codex"
```

`userId` comes from current server-side authentication and membership
verification. It is never accepted from a browser field or copied from an
unverified session payload. Session resume and model-list requests re-authorize
current membership and bind each credential operation to the current acting
user. Authorized members share one serialized Pi runtime and transcript writer
for the workspace session, but cannot reuse one another's credential resolution.

The complete identity appears in:

- credential primary/unique keys and every query predicate;
- advisory-lock derivation;
- expected-version CAS;
- credential lifecycle audit records;
- the operation-scoped verified request context;
- canonical credential-envelope AAD v2.

### AAD v2

Canonical, length-prefixed AAD v2 binds:

```text
credential-envelope.v2
workspaceId
subjectKind
subjectId
providerId
fieldId
credentialVersion
dekGeneration
```

Personal credentials are never written under workspace-only AAD v1. The wrapped
DEK AAD remains workspace/generation/backend-bound; adding a credential subject
does not require a per-user DEK or a wrapped-DEK format change.

### Stored secret

Map Pi's Codex credential to one atomic encrypted field, for example
`piCredential`. Before encryption and after decryption, validate the object
against the lockfile-pinned, published Pi 0.84.4 Codex schema:

```ts
type PersistedCodexCredentialV1 = Readonly<{
  type: "oauth"
  access: string
  refresh: string
  expires: number
  accountId: string
}>
```

Apply per-property and aggregate byte limits. Reject unknown shapes, missing
fields, non-finite expiry, oversized values, and unexpected credential kinds as
`CREDENTIAL_SCHEMA_MISMATCH`. The entire object is secret; `accountId` is not
returned by status APIs in the MVP.

Non-secret metadata contains only:

- state: `connected | disconnected | needs_reauth`;
- credential kind: `oauth`;
- credential version and schema/AAD version;
- connected/updated/last-refresh timestamps;
- creating/updating actor IDs for audit;
- selected KMS backend/key-reference metadata required for deterministic unwrap.

Status queries use explicit metadata-only selects and do not decrypt credentials
or call KMS.

## Actor-bound Pi CredentialStore

Implement `createVaultCredentialStore()` as a server-only Pi `CredentialStore`
closed over an immutable verified scope:

```ts
createVaultCredentialStore({
  authorizedWorkspaceScope,
  verifiedAuthority,
  providerId: "openai-codex",
  executionMode: "interactive",
})
```

A composite store delegates only `openai-codex` to this personal vault store.
All other provider IDs delegate to the existing compatibility store so the slice
does not regress current env/file/custom-provider behavior. The delegation rule
is fixed server policy, not caller input.

The constructor does not trust `executionMode` as authority. It receives the
Core-issued opaque authorized workspace scope and verified current authority
used by the shipped `CredentialStoreBackendV1`/host-resolver path, plus a trusted
request-attached execution classification from session composition. The personal
store extends that existing backend/persistence path with subject-aware identity
and AAD v2; it does not create a second crypto or authorization path to the same
tables. A copied object, TypeScript cast, browser field, persisted job argument,
or raw `"interactive"` string cannot construct the store.

### `read(providerId)`

- reject provider IDs other than `openai-codex` at the personal store boundary;
- verify current interactive authority before selecting storage;
- read the exact personal metadata row;
- return `undefined` only when genuinely never configured/disconnected according
  to the Pi contract;
- fail closed on unreadable ciphertext, wrong AAD, unknown schema/backend,
  missing KMS material, or inconsistent state;
- unwrap/decrypt, validate the bounded Pi credential, and return it to Pi;
- clear mutable byte buffers best-effort in `finally` without claiming guaranteed
  JavaScript string zeroization.

The MVP adds no application plaintext or DEK cache. Measure KMS latency during
qualification before considering a bounded cache with explicit revocation
semantics.

### `list()`

Return Pi `CredentialInfo` for Codex from metadata only when the actor's record is
connected. Do not decrypt or expose account labels. Composite listing merges this
with existing non-Codex compatibility information without allowing a global
Codex credential to appear.

### `modify(providerId, fn)`

`modify()` is the only Codex write path and covers both initial Pi login and
Pi-owned refresh-token rotation.

1. Validate provider and immutable actor scope.
2. Acquire a dedicated PostgreSQL session-level advisory lock derived from the
   complete credential identity, with a bounded wait timeout.
3. Read the canonical current version and decrypt it when present.
4. Invoke and await Pi's callback while holding serialization. Pi may perform the
   provider refresh network request inside this callback. Apply a bounded refresh
   callback deadline and abort signal; device-code polling must be proved to occur
   before `modify()` and must never hold a lock-pool connection for its 15-minute
   user-interaction window.
5. If the callback throws, make no secret-field write. An unrecoverable refresh
   error may trigger the separately specified metadata-only `needs_reauth`
   transition guarded by the exact credential version that failed.
6. If it returns `undefined`, preserve and return the current credential, matching
   Pi's contract.
7. Otherwise validate and encrypt the complete returned credential as a fresh
   credential version with fresh nonces and AAD v2.
8. Re-check lock-connection health and commit with expected-version CAS.
9. Delete superseded field ciphertext in the same durable transition and emit one
   value-free lifecycle audit event; do not create a tombstone row per field.
10. Release the advisory lock and clear temporary mutable buffers in `finally`.
    Return the dedicated connection to its pool only after unlock is positively
    confirmed. If unlock fails or its outcome is ambiguous, destroy the
    connection so an idle pooled session cannot retain the lock indefinitely.

The advisory lock serializes only while its database connection remains healthy;
it is not called a fencing token. Tie the provider callback's abort signal to
lock-connection health where the client supports cancellation. CAS prevents a
stale local commit, but the plan does not claim exactly-once upstream refresh
across PostgreSQL and OpenAI. Connection-loss ambiguity fails closed, is
observable, and retries only from a fresh canonical read.

Use a bounded dedicated lock pool. A lock-hash collision may safely
overserialize unrelated credentials but must never select another credential's
row. Do not hold a normal business transaction open across the provider network
request.

### `delete(providerId)`

Serialize against `modify()`. `ModelRuntime.logout("openai-codex")` delegates to
`CredentialStore.delete()`, which atomically fences future reads, deletes the
encrypted credential fields, and leaves metadata state `disconnected`. The store
never calls back into Pi. Pi 0.84.4's Codex logout path provides local deletion,
not a provider-side revocation endpoint; UI and runbooks must not claim upstream
revocation. A user who needs upstream invalidation is directed to their OpenAI
account security controls. There is no lower Codex fallback to suppress.

## Connect flow — Pi device code only

Pi 0.84.4's OpenAI Codex OAuth implementation supports browser and device-code
methods. Its browser method starts a localhost callback server intended for CLI
use. The web MVP therefore always answers Pi's login-method selection prompt with
`device_code`.

An authenticated streaming connect route:

1. verifies current workspace membership and the workspace canary flag;
2. constructs the personal actor store and `ModelRuntime`;
3. calls `runtime.login("openai-codex", "oauth", interaction)`;
4. answers the interaction's method selection with `device_code`;
5. forwards only `verificationUri`, `userCode`, expiry, and allowlisted progress
   to the initiating browser;
6. lets Pi poll, exchange, validate, and persist the credential through
   `CredentialStore.modify()`;
7. reports `connected` only after the encrypted write is durable.

Use one authenticated streaming request over an existing server transport. No
localhost callback server, pasted redirect URL, browser-delivered OAuth token,
generic OAuth transaction table, or undecided SSE-vs-WebSocket framework is
needed. Abort the Pi operation on client cancellation or the provider's bounded
15-minute device-code expiry. Proxy buffering and request-body/event logging are
disabled for this route.

The verification URI, user code, authorization URLs, and provider errors are
classified as ephemeral sensitive interaction data for logging and tracing even
though the URI/code must be displayed to the initiating browser.

Completing OAuth proves credential issuance and durable connection; it does not
prove entitlement to every Codex model. Do not label local auth derivation as a
provider validation probe. The first bounded model request may still return a
sanitized entitlement/provider error.

## Runtime and model availability

Interactive session construction must resolve and verify the actor before it
constructs or resumes model operations. Pi handle/cache identity remains
`(sessionId, workspaceId)`: one `AgentSession`, `SessionManager`, `ModelRuntime`,
and transcript writer are shared by authorized members of that workspace
session. Actor identity and trusted execution class live only in the
per-operation request context. The shared runtime receives one delegating
`CredentialStore`; for every actor-scoped operation it resolves a fresh immutable
actor-bound inner store from that live context and never caches the actor.
Missing actor context or a workspace/execution-class mismatch fails closed.

The personal Codex store is never injected into automation, scheduled, queued,
detached, or background-worker runtime construction. Persisting a creator user ID
is not authorization to use a subscription unattended.

The model route first re-authorizes the request, then resolves an actor-aware
catalog for display. Its availability snapshot is advisory. The operation-scoped
store at Pi's request-auth seam is authoritative, so a stale picker selection can
fail as unavailable but can never reuse another actor's credential. Other
providers continue using existing compatibility behavior.

The store is consulted at Pi's request-auth seam. A credential replacement,
refresh, disconnect, or `needs_reauth` transition affects the next provider-auth
request, including a follow-up in an existing session. An already-sent OpenAI
request may complete. The initial implementation does not intentionally retain
credential plaintext across provider requests.

When Pi reports an unrecoverable refresh failure such as `invalid_grant`, the
host credential adapter classifies the pinned Pi error and performs a
metadata-only `needs_reauth` transition under the same complete-scope lock or an
expected-version CAS. The transition applies only if the failing credential
version is still current, so a stale failed refresh cannot overwrite a newer
successful reconnect. Fail the request with a stable redacted error and show
Reconnect. Network/KMS/lock timeouts remain retryable operational failures and
do not falsely mark the subscription revoked.

## Routes and UI

Route names are plan-level and should follow the repository's existing route
composition conventions:

- `GET .../me/providers/openai-codex` — metadata-only personal status with an
  explicit DTO allowlist: `state`, `kind`, `connectedAt`, `updatedAt`, and
  `lastRefreshAt`; KMS backend, region, and key reference never enter the DTO;
- `POST .../me/providers/openai-codex/connect` — authenticated device-code
  streaming flow;
- `DELETE .../me/providers/openai-codex` — personal disconnect;
- the existing model-availability route becomes actor-aware.

Every route derives the workspace and user from authenticated server context.
Members can act only on their own credential. Workspace owners receive no
plaintext, no personal account identifier, and no special ability to use,
refresh, or disconnect another member's subscription in this MVP.

The UI is deliberately small:

```text
OpenAI Codex — ChatGPT Plus/Pro

Disconnected        [Connect]
Connecting          user code + Open verification page + [Cancel]
Connected           connected-at + [Disconnect]
Needs reauthentication                   [Reconnect]
Temporarily unavailable                  [Retry]
```

The model picker keeps its current model-row structure. When Codex is not
connected, it may show a small `Connect ChatGPT subscription` CTA deep-linking
to the personal settings card. Connected Codex models may show a simple
`Personal subscription` badge. There is no workspace provider panel, funding
selector, promotion action, reveal action, or generic provider catalog.

Browser component state may hold the short-lived device user code but never a
credential token. Clear the code when the attempt succeeds, fails, expires, is
cancelled, or the component unmounts.

## OVH KMS custody and qualification

The production adapter implements the existing `WorkspaceKekProviderV1` port.
For the canary, manually provision one non-exportable OVH KMS wrapping key in the
selected EU region. Store its opaque key reference and region alongside the
wrapped workspace DEK for deterministic fail-closed routing.

Product runtime permissions are limited to the exact data-key/decrypt operations
required by the adapter. Product traffic cannot create, rotate, disable, export,
or delete KMS keys. Operator credentials use sealed-file custody and never enter
workspace configuration or logs.

Before production canary, qualify with disposable resources:

- exact regional endpoint and authentication mechanism;
- `datakey` and `datakey/decrypt` request/response behavior and size bounds;
- least-privilege allow and explicit denial of key administration;
- context/AAD or opaque-payload integrity behavior;
- wrong key, disabled key, malformed payload, IAM denial, timeout, rate limit,
  and regional outage behavior;
- connection pooling, retry guidance, quotas, observed latency, and actual KMS
  unwrap/read calls per interactive session turn and agentic tool loop;
- key version/retirement and audit-record behavior;
- redaction of credentials, wrapped payloads, key references, certs, and provider
  response bodies.

Use bounded timeout, retry with jitter only where the operation is safe, and a
circuit breaker. KMS failure makes credential-backed operations unavailable but
does not fail application liveness or trigger fallback to local KEK, env,
`auth.json`, or plaintext. Local KEK remains a development/self-host option and
is not the production Codex canary path.

One manually provisioned canary key does not claim independently retireable
per-workspace crypto-shred. Deleting a live wrapped-DEK row is online retirement,
not guaranteed erasure of database or key backups.

## Rollback and deployment safety

The feature has a global kill switch and a workspace allowlist/flag. Disabling
the feature stops new Codex connects and use but leaves encrypted records intact
for safe re-enable or explicit disconnect.

Before enabling any workspace, production configuration is audited to prove the
absence of global Codex env, file, and `auth.json` credentials. This is an
operational precondition because an already-built older binary cannot understand
future vault state. After enablement, the rollback runbook rechecks that absence
before deploying an older binary; if it cannot be proved, rollback stops and the
feature is disabled on the current binary instead. No rollback may change payer
or authority.

Schema changes are forward-compatible and are not destructively rolled back.
Rollback never decrypts a credential into generic settings, clears a disconnect
state, changes its subject, or routes it through global `auth.json`.

The MVP uses AEAD identity binding plus expected-version CAS. A separate future
decision is required before claiming protection against a complete historical
Postgres snapshot restore. Do not implement the earlier single workspace-wide
monotonic counter: it cannot independently authenticate multiple credentials,
and OVH KMS metadata has not been shown to provide a replica-safe atomic CAS
anchor.

## Failure model

Stable external errors reveal no token, account ID, credential existence outside
the authorized actor, KMS key reference, ciphertext, provider response body, or
cross-user distinction.

| Condition | Behavior |
|---|---|
| never connected/disconnected | Codex unavailable; Connect CTA |
| expired access token | Pi refreshes through serialized `modify()` |
| `invalid_grant`/unrecoverable refresh | mark `needs_reauth`; fail closed |
| KMS timeout/outage | retryable unavailable; no fallback |
| lock wait timeout | retryable busy error; no provider call before lock |
| lock connection lost during refresh | abort where possible; no stale commit; observable ambiguity |
| CAS conflict | discard attempted local write; re-read before retry |
| malformed schema/ciphertext/AAD | `CREDENTIAL_UNREADABLE`; no fallback |
| current membership lost | forbidden before storage selection |
| background/unattended construction | personal Codex store not provided |
| disconnect during in-flight request | new auth requests fail; already-sent request may complete |

## Security and privacy gates

- No production personal Codex path reads or writes global `auth.json`.
- No plaintext credential read/reveal/export endpoint exists.
- Credential routes disable request/event body logging and session replay.
- Secret canaries cover access/refresh tokens, authorization headers, account
  identifiers, device codes, KMS payloads, and provider error echoes across HTTP
  responses, logs, traces, analytics, sessions, events, errors, files, and
  sandbox process inspection.
- The complete subject identity is verified before decrypt and repeated in AAD.
- Cross-user, cross-workspace, provider, field, version, and generation swaps fail
  closed.
- The sandbox and tools receive only normalized model output, never credential
  material or a credential-resolving capability.
- JavaScript strings cannot be reliably zeroized; mutable buffers are cleared
  best-effort and the residual host-process compromise risk is documented.
- A compromised authorized host process can ask KMS to unwrap active material;
  KMS protects key custody and offline database disclosure, not a malicious
  currently authorized process.

## Performance and observability

Do not add a plaintext/DEK cache before measuring OVH behavior. Status/list paths
are metadata-only, so KMS latency affects only connect, refresh, and provider-auth
resolution. Record qualification baselines and set budgets from observed data.

Emit bounded-cardinality, value-free metrics for:

- KMS operation latency, timeout, and error by backend operation;
- credential read/decrypt failures by stable reason code;
- advisory-lock wait, timeout, and connection loss;
- refresh success, failure, CAS conflict, and ambiguous connection-loss outcome;
- OAuth connect started/completed/failed/expired/cancelled;
- `needs_reauth` transitions;
- global/workspace feature-disable counts.

Do not use workspace IDs, user IDs, account IDs, credential IDs, OAuth URLs or
codes, key references, ciphertext, or token-derived data as metric labels or
trace attributes. Lifecycle audit records may contain authorized actor/workspace
identity and stable operation outcomes, but never secret-bearing values.

Runbooks cover KMS regional outage, IAM denial, exhausted lock pool, refresh
storm/invalid grant, unreadable credential, stuck device flow, emergency feature
disablement, and database restore against newer application state.

## Delivery slices

### Completed — Pi 0.84.3 compatibility (#1500)

`ModelRuntime` migration and the async injection seam are on `main` with green
post-merge CI.

### PR 1 — verified actor propagation

- preserve current verified `userId` through interactive session and model-list
  construction;
- bind actor and trusted request-attached execution class into the live
  per-operation context while keeping Pi handle/transcript identity
  `(sessionId, workspaceId)`;
- re-authorize current membership on every request and resume;
- prove two authorized members share one serialized runtime/transcript writer
  but cannot reuse one another's actor-scoped credential resolution;
- no vault behavior enabled.

### PR 2 — OVH KMS adapter and live qualification

- implement `WorkspaceKekProviderV1` for the qualified OVH API;
- use disposable qualification resources and one manually provisioned canary key;
- add readiness, timeout, circuit-breaker, IAM-denial, region, and redaction
  proofs;
- keep credential feature disabled when OVH custody is not ready.

### PR 3 — personal Codex CredentialStore

- add a pinned published-Pi contract suite proving `CredentialStore.modify()`
  undefined-preserve behavior, refresh recheck/serialization, credential shape,
  login mutation timing, and stable classification of unrecoverable refresh;
- add subject-aware persistence keys and personal AAD v2;
- store one bounded encrypted Pi Codex credential field;
- implement personal-only `read/list/modify/delete`;
- add complete-scope advisory locking, expected-version CAS, and refresh tests;
- compose Codex personal store with existing non-Codex compatibility behavior;
- keep feature behind global and workspace flags.

### PR 4 — Codex connect/status/disconnect and runtime use

- extend the pinned published-Pi contract suite to prove the built-in
  `openai-codex` device-code method and 15-minute expiry against intercepted
  synthetic OAuth endpoints;
- test route orchestration through a narrow fake login-runtime adapter that emits
  device/progress events and persists a synthetic credential, while a separate
  package-contract test exercises Pi's real provider implementation without a
  live or billable OpenAI call;
- implement device-code-only Pi login streaming;
- add metadata-only status and fail-closed disconnect;
- make Codex model availability actor-aware;
- add the personal settings card and model-picker CTA/badge;
- handle `needs_reauth` without exposing provider errors.

### PR 5 — Seneca canary

- publish and consume the coordinated Boring packages;
- register schema/configuration and enable one workspace;
- exercise real connect, model call, expiry/refresh, restart, disconnect, KMS
  outage, and kill-switch behavior;
- inspect browser/network/log/trace/session/file/sandbox artifacts for canaries;
- expand only after the canary acceptance record is complete and a separate
  decision defines KMS-key provisioning/retirement for more than the manually
  provisioned canary scope.

Each slice is green-gated. “Revertible” means behavior can be disabled safely;
it does not mean an old binary may bypass personal custody or silently reactivate
global Codex auth after vault state exists.

## Acceptance gates

### Authorization and isolation

- Member A can connect and use their Codex credential only in workspace W.
- Member B in W cannot list, decrypt, refresh, disconnect, or use A's credential.
- A in workspace X cannot use the credential connected in W.
- Session resume and cache reuse cannot cross acting user or workspace identity.
- Automation, scheduled, queued, detached, and background-worker construction
  cannot access the subscription.

### Pi behavior

- A contract suite runs against the exact published, lockfile-pinned Pi package;
  it does not infer behavior from development docs or an unreleased branch.
- Device-code login is Pi-owned and route success occurs only after durable
  encrypted commit.
- Expired credentials refresh through one serialized `modify()` outcome while
  lock ownership remains healthy.
- A rotated refresh token survives process restart and is used by the next call.
- `modify()` preserves current credential when Pi returns `undefined` and writes
  nothing when Pi throws.
- Existing non-Codex streaming, tools, custom providers, cancellation, model
  selection, and session resume remain green.

### Storage and failure

- Raw Postgres inspection finds no plaintext token, auth header, or DEK.
- Subject/provider/field/version/generation swaps fail authentication.
- Wrong/disabled key, IAM denial, malformed payload, lock timeout, connection
  loss, CAS conflict, and KMS outage return stable redacted errors with no
  fallback.
- Concurrent refresh normally makes one provider refresh and one durable write;
  the connection-loss upstream side-effect race is tested, fails closed locally,
  and is observable rather than described as exactly once.
- Status and disconnected UI work from metadata without KMS decrypt.

### Leakage and operations

- Canary material is absent from browser responses except the intended ephemeral
  device URI/code, and absent from logs, traces, analytics, error objects,
  transcripts, session events, workspace files, sandbox processes, and test
  snapshots.
- Device URI/code is visible only to the initiating browser and absent from
  platform-controlled retained sinks.
- Feature disablement stops Codex use without deleting ciphertext or restoring
  global auth.
- Non-credential application liveness remains healthy during OVH outage.
- Runbooks and value-free dashboards exist before the production canary.

## Later roadmap — requires separate approval

After the personal Codex canary proves custody and usability, evaluate each
expansion independently:

1. personal API keys and multiple auth profiles per provider;
2. workspace credentials and explicit payer/funding selection;
3. Anthropic and Google onboarding under reviewed host policy entries;
4. unattended API-key-only automation funding and reassignment;
5. generic provider UI and provenance-aware picker;
6. fleet-tier integration;
7. first-party search/transcription proxies and MCP migration;
8. dynamic KMS key lifecycle, DEK rotation, and honest crypto-shred runbooks;
9. external rollback-resistant state continuity if a qualified atomic anchor and
   recovery protocol justify the complexity;
10. hostile-tested, red-teamed sandbox delivery only if a real tenant tool needs
    it.

None of these is a hidden dependency of the personal interactive Codex MVP.
