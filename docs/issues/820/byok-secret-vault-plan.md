---
github: https://github.com/hachej/boring-ui/issues/820
issue: 820
state: ready-for-human
updated: 2026-07-20
flag: not-needed
track: owner
---

# gh-820 Generic per-workspace provider credentials and secret vault

## Outcome

Generalize Decision 27's single model-key policy into one workspace-scoped
provider-credential system for LLM/chat, search, transcription, MCP, plugins,
and future providers. A trusted provider registry describes onboarding once;
one credential lifecycle and UI handles API-key, OAuth, and public providers;
one typed resolution contract gives authorized consumers a credential for one
execution; and a pluggable envelope-encryption backend keeps the storage layer
independent from HashiCorp Vault or a self-host fallback.

The crypto backend is a pluggable `KmsBackend` abstraction that fails closed
(amendment A, ratified 2026-07-20). The **default is a managed EU KMS with
OVHcloud KMS as the primary implementation**; **Scaleway Key Manager** and
**Exoscale KMS** are named alternate managed-EU-KMS implementations; the
**local-KEK envelope** (a separately sealed master key in a host file) is the
zero-external-dependency fallback; and **self-run HashiCorp Vault/OpenBao
Transit** is an optional heavy alternative. Whichever backend is selected, the
service receives a plaintext per-workspace DEK only while encrypting or
decrypting a credential; it never receives the KEK. All backends share the same
Node envelope contract and differ only in the KEK-holder / data-key
wrap-unwrap call. No mode silently degrades to plaintext or to the legacy
app-wide `WORKSPACE_SETTINGS_ENCRYPTION_KEY`. The dev-infra Vault at
`100.77.36.113` is not the production backend.

This document is plan-only. It makes no product-code or Beads changes. It
proposes the replacement 16f.x chain under `wt-391-forward-16f`; implementation
remains human-gated because it changes an accepted security decision, a public
cross-package contract, credential custody, authorization, OAuth, and migration.

## Owner ratifications — RATIFIED 2026-07-20 (owner, with amendments)

The owner RATIFIED this plan on **2026-07-20** with three folded-in amendments:
(A) the crypto backend becomes a pluggable `KmsBackend` abstraction defaulting to
a managed EU KMS (OVHcloud KMS primary) instead of a forced HashiCorp Vault
Transit default; (D) the credential-injection contract splits into **Tier 1**
host-side resolution (shipped in v1) and a **DEFERRED Tier 2** in-sandbox
injection gated behind a hostile-test harness plus red-team; and (E) an explicit
pi-reuse requirement on the connection/consumption edge. Each of the 11 items
below is marked with its disposition inline.

OWNER RATIFY: Amend Decision 27 from an Anthropic/model-key policy to the generic workspace-scoped provider-credential system in this plan, and treat `docs/issues/820/plan.md` as historical narrow-scope guidance where it conflicts with this plan; retain Decision 27's payer/billing deferrals. — RATIFIED 2026-07-20 (owner)

OWNER RATIFY: [AMENDED per amendment A] The crypto backend is a **pluggable `KmsBackend` abstraction that fails closed**, not a forced HashiCorp Vault Transit default. The **default is a managed EU KMS, with OVHcloud KMS as the primary implementation** (the owner is already on OVH; OVH KMS does encrypt/decrypt + generate-data-key, REST + KMIP, FIPS 140-3 / ISO 27001, EU regions Gravelines/Strasbourg/Frankfurt, ~$0.06/key/mo). **Scaleway Key Manager and Exoscale KMS are named alternate managed-EU-KMS implementations** (Scaleway ships a first-party Node SDK). A **local-KEK envelope** (master key in a sealed host file, separate from the DB) is the zero-external-dependency fallback. **Self-run HashiCorp Vault/OpenBao Transit is an optional heavy alternative**, not required of anyone. All backends keep the Node envelope crypto identical (per the research brief); only the KEK-holder / data-key wrap-unwrap call differs. The dev-infra Vault at `100.77.36.113` is **NOT** the prod backend. Startup or credential operations fail closed when the selected backend is unavailable; no deployment is forced onto HashiCorp Vault. (Supersedes the original "Vault Transit is the required default" wording.) — RATIFIED 2026-07-20 (owner, AMENDED)

OWNER RATIFY: Adopt one active credential profile per `(workspaceId, providerId)` in v1, with a tenant-chosen display label and multi-field values inside that profile; add multiple same-provider profiles only after a named consumer defines an unambiguous reference shape and selection policy. — RATIFIED 2026-07-20 (owner)

OWNER RATIFY: Restrict create, replace, OAuth-connect, disable, revoke, and delete operations to workspace owners; make the resulting credential reusable by authorized plugins, MCP sources, first-party tools, and tenant custom tools in that workspace, without granting those consumers a plaintext read API. — RATIFIED 2026-07-20 (owner)

OWNER RATIFY: Generalize the existing `@hachej/boring-mcp` onboarding UI, state model, and server adapter now, migrating MCP from per-user source metadata to the common workspace provider-credential mechanism; do not ship a parallel BYOK onboarding surface. — RATIFIED 2026-07-20 (owner)

OWNER RATIFY: Do not automatically promote an existing user-owned MCP connection into workspace-wide authority; quarantine collisions, and require explicit consent from the connected user plus approval/reconnection by a current workspace owner before selecting one account as the workspace credential. — RATIFIED 2026-07-20 (owner)

OWNER RATIFY: Accept the residual boundary that tenant-controlled code can exfiltrate its OWN workspace credential once that credential is deliberately delivered to its OWN execution; the security guarantee is strict cross-workspace isolation, one-execution delivery, and minimization—not prevention of a tenant reading a key it asked its own untrusted code to use. — RATIFIED 2026-07-20 (owner) [decision #7, ratified as written]

OWNER RATIFY: Reconcile SBX1 H3 to this plan by replacing its proposed child `secretEnv` population with a non-environment credential channel (dedicated pipe/file descriptor preferred, per-execution tmpfs file as fallback); no credential value may enter environment variables, argv, image layers, common create context, or static fleet configuration. — RATIFIED 2026-07-20 (owner) [decision #8, ratified as written]. Amended by the two-tier injection split (amendment D, "Credential-injection tiers" below): this non-environment in-sandbox channel is **Tier 2 and DEFERRED** behind a hostile-test harness + red-team; **Tier 1 host-side resolution is the only injection tier built in v1**.

OWNER RATIFY: Preserve the Decision 27 instance-key fallback only for explicitly registered self-host/model-provider policy when the workspace/provider is in an explicit `instance-fallback-enabled` state (initially never configured, or restored by a separate confirmed owner action); all other providers default to no fallback, and disable/revoke/delete retains a durable fallback-suppression tombstone. — RATIFIED 2026-07-20 (owner)

OWNER RATIFY: Use a per-workspace DEK and a workspace-scoped Transit key/reference so an out-of-band security administrator can crypto-shred one workspace without affecting another; before implementation, confirm `datakey/plaintext`, `decrypt`, `rewrap`, key rotation, `min_decryption_version`, and destructive key/version retirement behavior against the owner's deployed Vault version and record the exact tested version and runbook. — RATIFIED 2026-07-20 (owner). Per amendment A the "workspace-scoped Transit key/reference" generalizes to a **workspace-scoped KMS key/reference** under the pluggable `KmsBackend`; the per-workspace DEK and crypto-shred-one-workspace property are unchanged and backend-agnostic. The deployed-version behavioral confirmation applies to whichever managed backend is selected (OVH KMS primary), and to self-run Vault only if that optional backend is chosen.

OWNER RATIFY: Migrate only inventoried credential-bearing legacy settings into the new vault, verify each migrated envelope before switching reads, never dual-write plaintext, and retire the legacy `WORKSPACE_SETTINGS_ENCRYPTION_KEY` credential path only after rollback and backup-retention requirements are satisfied. — RATIFIED 2026-07-20 (owner)

## Grounding and constraints

### Locked repository direction

- [Decision 26](../../DECISIONS.md#26-domain-routed-agent-workspaces-before-same-workspace-multi-agent-expansion)
  makes an authenticated, membership-authorized workspace the runtime authority;
  domain, workspace type, and agent identity never grant membership. This plan
  binds every credential lookup to that same workspace authority and creates no
  AgentHost, mutable runtime registry, or second Workspace/Sandbox owner. The
  existing [`authorizeRequestScopedWorkspace()`](../../../packages/core/src/server/auth/requestWorkspaceScope.ts#L20)
  re-reads current membership and app ownership from the store; the credential
  authority below preserves that current-state check at resolution time rather
  than trusting caller-supplied workspace strings.
- [Decision 27](../../DECISIONS.md#27-workspace-scoped-provider-credentials-and-byok-before-platform-billed-model-keys)
  currently chooses BYOK per workspace, metadata-only APIs, per-request
  resolution, no general sandbox propagation, an explicit instance-key fallback,
  and fail-closed behavior for unreadable BYOK. This plan retains those safety
  properties while asking the owner to ratify the broader provider and custody
  model above.
- The existing narrow [`docs/issues/820/plan.md`](plan.md) identifies Pi's
  request-time model-auth seam, cached-session hazards, ambient-auth rejection,
  and the two-workspace proof. Those tests remain required for LLM consumers;
  its proposed single setting and `WORKSPACE_SETTINGS_ENCRYPTION_KEY` storage are
  superseded by this plan after ratification.
- [`docs/issues/391/AGENT-CLOUD-VISION.md`](../391/AGENT-CLOUD-VISION.md#4-custom-tools)
  splits a custom tool into control-plane declaration data and sandbox-only
  tenant handler code. It requires per-invocation secrets and default-deny
  egress. Provider registration and credential metadata therefore stay on the
  control plane; tenant handler code and any deliberate untrusted delivery stay
  on the data plane.
- The trust taxonomy in
  [`docs/issues/805/runtime-refactor/work/P3-routes-tools/DECISION-26-PLAN.md`](../805/runtime-refactor/work/P3-routes-tools/DECISION-26-PLAN.md#trust-taxonomy)
  assigns `trusted` or `untrusted` where the host constructs the tool catalog.
  Tenant bundles cannot self-declare trust. That exact host-owned fact selects
  host-only use versus sandbox delivery in this plan.
- SBX1's
  [`H3 tenant-key lifecycle and per-invocation secrets`](../808/sbx1-own-cloud-provider-plan.md#h3--decision-27-tenant-key-lifecycle-and-per-invocation-secrets)
  requires purpose-typed references to replace
  [`withRuntimeEnvContributions()`](../../../packages/agent/src/server/runtimeEnvContributions.ts),
  keeps model credentials host-side, excludes references from the common create
  context, and defines active-version/tombstone behavior. The shared contract
  below is the seam `SBX1.1` must stub against. The deliberate delta is that the
  research brief's stronger no-environment rule replaces H3's eventual child-env
  population.
- [`SandboxProviderV1`](../../../packages/boring-sandbox/src/shared/providerV1.ts)
  demonstrates the desired adapter style: a versioned interface plus provider
  ID, typed lifecycle inputs, capabilities, and stable errors. The vault backend
  follows that shape without becoming a sandbox provider.

### Mandatory security research

The controlling security brief is
[`docs/issues/820/byok-research-brief.md`](byok-research-brief.md). Its required
sources are the OWASP
[Cryptographic Storage](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html),
[Secrets Management](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html),
and [Key Management](https://cheatsheetseries.owasp.org/cheatsheets/Key_Management_Cheat_Sheet.html)
cheat sheets; HashiCorp's [Transit API](https://developer.hashicorp.com/vault/api-docs/secret/transit),
[envelope-encryption guide](https://developer.hashicorp.com/vault/docs/secrets/transit/envelope-encryption),
and [AppRole guide](https://developer.hashicorp.com/vault/docs/auth/approle);
the [Node environment-variable leakage analysis](https://www.nodejs-security.com/blog/do-not-use-secrets-in-environment-variables-and-here-is-how-to-do-it-better);
[crypto-shredding](https://en.wikipedia.org/wiki/Crypto-shredding); and the
[OAuth refresh-token lifecycle guidance](https://duendesoftware.com/learn/best-practices-managing-token-expiration-refresh-revocation-in-web-apis).
Use the official [Node 22 crypto API](https://nodejs.org/docs/latest-v22.x/api/crypto.html)
for GCM, AAD, authentication-tag, random-byte, and timing-safe comparison
behavior, and [OAuth 2.0 Security Best Current Practice (RFC 9700)](https://www.rfc-editor.org/rfc/rfc9700.html)
for authorization-code flow hardening.

The repository contains no deployed Vault version, address, mount declaration,
or compatibility evidence (`rg` found no Vault deployment configuration).
Current HashiCorp documentation confirms the generic endpoint forms, but the
owner ratification above deliberately gates exact operations on the deployed
version.

## Current state and weak baseline

### How workspace settings are encrypted today

The current path is one deployment-wide symmetric secret held by the app and
sent into PostgreSQL crypto functions:

1. [`fileSecrets.ts`](../../../packages/core/src/server/config/fileSecrets.ts#L6)
   pairs `WORKSPACE_SETTINGS_ENCRYPTION_KEY` with
   `WORKSPACE_SETTINGS_ENCRYPTION_KEY_FILE`. The file path is absolute,
   no-follow, owner-matched, mode `0400`, regular-file-only, one-link-only, and
   size-bounded; [`resolveConfigFileSecrets()`](../../../packages/core/src/server/config/fileSecrets.ts#L74)
   rejects direct-plus-file dual configuration. It nevertheless decodes and
   returns the secret as an immutable JavaScript string.
2. [`loadConfig.ts`](../../../packages/core/src/server/config/loadConfig.ts#L201)
   chooses the file value, then the direct environment value, and projects it as
   `config.encryption.workspaceSettingsKey`; development-only missing-secret mode
   can substitute an explicitly warned insecure placeholder.
3. Core constructs
   [`PostgresWorkspaceStore`](../../../packages/core/src/server/db/stores/PostgresWorkspaceStore.ts#L148)
   with that single key. The schema is one
   [`workspace_settings`](../../../packages/core/src/server/db/schema.ts#L106)
   row per `(workspace_id, key)` whose `value` is `bytea`.
4. [`encryptAndPut()`](../../../packages/core/src/server/db/stores/PostgresWorkspaceStore.ts#L797)
   executes `pgp_sym_encrypt(value, workspaceSettingsKey)` inside PostgreSQL;
   [`decryptSetting()`](../../../packages/core/src/server/db/stores/PostgresWorkspaceStore.ts#L770)
   executes `pgp_sym_decrypt(value, workspaceSettingsKey)` for an exact
   workspace/key pair. [`getWorkspaceSettings()`](../../../packages/core/src/server/db/stores/PostgresWorkspaceStore.ts#L814)
   currently decrypts each row merely to report `configured`, although the HTTP
   response returns only key/configured/timestamp metadata.
5. The generic settings route
   [`packages/core/src/server/routes/settings.ts`](../../../packages/core/src/server/routes/settings.ts#L8)
   allows members to list metadata and editors to submit arbitrary setting
   key/value records validated by
   [`routes/__schemas__/settings.ts`](../../../packages/core/src/server/routes/__schemas__/settings.ts).
   A credential store needs dedicated owner-only routes; the generic writer
   cannot be a bypass.
6. [`LocalWorkspaceStore`](../../../packages/core/src/server/db/stores/LocalWorkspaceStore.ts#L336)
   stores setting values as JSON strings in memory without encryption. It is not
   an acceptable production credential backend.

This baseline is better than plaintext database rows, but it is not a vault:
one app-held key unlocks all tenants; the key and plaintext are JS strings; the
database process receives the key during crypto operations; there is no
per-workspace crypto-shred lever; rotation requires coordinated whole-store key
replacement; and the generic store lacks a purpose-typed resolver. Vault Transit
envelope encryption replaces this baseline rather than wrapping another feature
around it.

### Existing MCP onboarding to generalize, not fork

The requested `packages/boring-mcp` directory does not exist on this branch; the
actual published package is [`plugins/boring-mcp`](../../../plugins/boring-mcp).
Its [README](../../../plugins/boring-mcp/README.md) describes a reusable provider
overlay, hosted OAuth/session onboarding, status/connection contracts, managed
connector adapter, and app-injected secret resolver.
The search under [`packages/workspace`](../../../packages/workspace) found the
generic plugin host/composition machinery, but no second MCP onboarding or
credential authority; the reusable flow is owned by `plugins/boring-mcp` and
mounted by host apps.

Existing reusable seams:

- [`plugins/boring-mcp/src/shared/index.ts`](../../../plugins/boring-mcp/src/shared/index.ts)
  defines provider templates, source states, credential-provider labels,
  metadata-only DTOs, workspace/user actors, access checks, redaction, and stable
  MCP error codes.
- [`plugins/boring-mcp/src/front/index.tsx`](../../../plugins/boring-mcp/src/front/index.tsx#L13)
  renders provider rows and the common connect/refresh/disconnect state. Its
  browser adapter binds a workspace header, posts to `/connect`, opens the
  provider URL without an opener, refreshes status, and never receives OAuth
  tokens.
- [`managedConnectorAdapter.ts`](../../../plugins/boring-mcp/src/server/managedConnectorAdapter.ts#L34)
  separates trusted provider configuration, provider operations, source
  persistence, and an app-owned server secret resolver. It validates connect URL
  origins and checks responses for secret canaries.
- [`composioManagedConnector.ts`](../../../plugins/boring-mcp/src/server/composioManagedConnector.ts#L342)
  implements the hosted connect/status/revoke sequence and keeps Composio API
  credentials server-side.
- [`appServerBinding.ts`](../../../plugins/boring-mcp/src/server/appServerBinding.ts#L151)
  persists sources under `__serverBoringMcpSourcesV1` in per-user settings,
  nested by workspace; the source still carries `userId` and defaults to
  `ownerKind: "user"`. Its routes authenticate, validate the trusted workspace,
  rate-limit connect/actions, and expose metadata/connect URLs only.
- Full-app registers Notion and Airtable once in
  [`apps/full-app/src/server/boringMcp.ts`](../../../apps/full-app/src/server/boringMcp.ts)
  and selects them in
  [`apps/full-app/src/front/boringMcp.ts`](../../../apps/full-app/src/front/boringMcp.ts).

The common provider picker, connect popup, metadata DTO, server adapter, origin
checks, and state controls are prior art to retain. The per-user persistence,
MCP-only provider type, instance-env Composio secret binding, and source-owned
authorization are not the new credential authority. MCP connection metadata
moves to the workspace provider-credential record; `createdByUserId` remains
audit metadata, not an access boundary. Where Composio holds the upstream OAuth
refresh token, record custody as `external-managed` and store no fictitious local
token. Whenever Boring receives a refresh token directly, it goes through the
same envelope pipeline as every other long-lived secret.

## Security invariants

These are acceptance gates, not aspirations:

1. **Tenant binding:** every read, write, rotate, refresh, resolve, disable, and
   audit operation is keyed by the already-authorized workspace plus provider.
   A credential ID or provider ID alone is never authority.
2. **Write-only API:** no HTTP, bridge, event, tool, DTO, support export, or UI
   response returns a stored field. UI metadata shows only configured state and
   a separately stored last-four suffix (or only `configured` for values too
   short to mask safely).
3. **One-execution lease:** plaintext is decrypted immediately before the
   provider call or sandbox delivery, never cached across requests, and disposed
   immediately after success, error, timeout, or abort.
4. **No ambient delivery:** plaintext never enters `process.env`, child env,
   argv, URLs/query strings, image layers, bundles, workspace files, static fleet
   config, common runtime-create context, sessions, task/event payloads, logs,
   traces, analytics, crash reports, or replay caches.
5. **Host before sandbox:** trusted first-party consumers resolve and call the
   provider on the host. A credential reaches a sandbox only for a host-approved
   untrusted tenant consumer that genuinely must call the provider itself.
6. **No trust self-declaration:** consumer trust, provider ID, requested fields,
   purpose, field-to-channel mapping, and allowed egress are host-composed from
   registered definitions. Prompts, model output, tool arguments, command text,
   tenant env, and bundle code cannot select an arbitrary credential.
7. **Authenticated encryption:** every secret field uses AEAD with unique nonce,
   verified tag, and AAD containing at least workspace, credential, field, and
   version. Row swapping fails authentication.
8. **Separate key custody:** ciphertext/EDKs live in Postgres; the Transit KEK
   does not. Local fallback KEKs live in a sealed file or external KMS, never in
   the credential database and never as a plaintext default.
9. **Tombstone beats fallback:** disabled/revoked differs from absent. It fences
   all new resolutions immediately and suppresses any allowed instance fallback.
10. **Audit without values:** record actor, workspace, provider, operation,
    version, outcome, stable error, request/execution ID, custody backend, and
    timestamps—never plaintext, ciphertext, EDK, OAuth code/token, auth header,
    secret hash, or request/response body.
11. **Fail closed:** unreadable ciphertext, failed tag/AAD validation, unknown
    backend/version, Vault/KMS outage, expired/replayed OAuth state, schema drift,
    ownership mismatch, and cleanup uncertainty deny the operation without
    changing backends or using ambient credentials.
12. **Prefer delegated, short-lived authority:** where a provider supports
    OAuth, use authorization code plus short-lived access tokens and server-side
    refresh; store only the long-lived refresh material required to continue.

## Threat model

### Assets and boundaries

Primary assets are API keys, OAuth refresh tokens, transient access tokens,
multi-field credentials, plaintext DEKs, wrapped per-workspace DEKs, Transit key
references/versions, local KEKs, provider account identifiers, last-four
metadata, authorization transactions, and the audit trail. The tenant boundary
is the authenticated workspace. Same-workspace agents intentionally share the
Workspace+Sandbox trust domain under Decisions 25/26; agent identity is not a
secret-isolation boundary.

The trusted computing base includes the control-plane Node process, Core
authorization, provider/consumer registries, credential store and resolver,
selected KEK backend, PostgreSQL client, Vault client and policy, trusted
first-party proxies, authenticated control-plane-to-worker channel, worker
supervisor, sandbox isolation, and provider TLS endpoints. Tenant bundles,
tenant commands, prompt/model output, untrusted custom tools, browser input, and
provider response bodies are untrusted.

### Adversaries and honest residual risk

| Threat | Protection and required evidence | Residual risk stated honestly |
| --- | --- | --- |
| Offline Postgres theft or leaked backup | Database contains AEAD ciphertext, nonce, verified tag, AAD, metadata, and wrapped DEK only. Transit KEKs stay in Vault; local KEKs stay separately sealed. Cross-workspace row swaps fail AAD/tag verification. Query logging is disabled for credential tables. | Provider IDs, timestamps, state, field names, and last-four metadata remain visible. Local fallback is recoverable if the attacker also steals the KEK/its backup. Backup copies delay deletion guarantees unless the workspace Transit key/version is destroyed. |
| Live database compromise | Dedicated parameterized queries use workspace/provider/version identifiers only; no secret appears in a `WHERE` literal. The database never receives the Transit KEK or plaintext secret for application-side AEAD. | An attacker able to alter active rows can deny service; an attacker who also controls the app or Vault credentials may decrypt. Database integrity still depends on application checks, AEAD, and operational recovery. |
| Control-plane application compromise/RCE | Short-lived AppRole token, least-privilege Transit paths, no key-admin permission, JIT decrypt, no cross-request plaintext cache, restricted diagnostics/core dumps, and value-free audit reduce duration and blast radius. | A fully compromised app authorized to unwrap workspace DEKs can request and exfiltrate credentials while compromise persists. Vault Transit protects the KEK; it cannot make an authorized malicious caller harmless. |
| Vault compromise or root operator | Vault audit devices, split runtime/admin roles, workspace-scoped keys/references, non-exportable keys, rotation, and destructive operations behind an out-of-band admin path. | Vault root/control-plane compromise can defeat custody. Backups of Vault or local KEKs must follow an equally strong access and destruction policy. |
| Insider/support/operator | Workspace owners perform tenant lifecycle; support surfaces expose metadata only. Runtime role cannot rotate/delete Transit keys; security-admin role cannot use product APIs. Audit actor and outcome without values. | A privileged production operator who can both impersonate the app and access its Vault auth path can recover secrets. Split duties, access review, and audit detection reduce but do not eliminate this risk. |
| Log/APM/error leak | Credential routes and tables use no body/query logging; error objects carry stable codes only; redaction/canary tests cover logs, traces, analytics, sessions, events, and proxy errors; secrets never enter URLs. | A compromised logger or heap/core-dump collector inside the process can still observe live memory. Tenant code may print its own deliberately injected credential; such output must not enter central logs or replay storage. |
| Cross-tenant confused deputy | Resolver receives an authorized workspace object separately from a provider reference; storage queries include workspace and provider; AAD repeats that binding; consumer bindings are host-owned; external errors avoid existence oracles. Two-workspace × two-provider × two-execution negative tests are mandatory. | Same-workspace owners and approved consumers share that workspace credential by design. Agent/tool labels inside one workspace are not isolation. |
| Browser/XSS/CSRF | TLS only; owner reauthentication for mutation; CSRF protection; no GET mutation; no value echo; secret fields disable analytics/session replay and password-manager/autocomplete where appropriate; OAuth uses one-use state, PKCE, exact redirect allowlists, and short expiry. | The pasted key exists in browser memory and can be stolen by an active same-origin XSS before submission. CSP, dependency hygiene, and minimizing time in component state remain necessary. |
| Untrusted tenant sandbox | Only that authorized workspace's requested fields are delivered for one execution via pipe/FD or tmpfs; no environment/argv; clean-process baseline; no reuse; destroy/recreate after secret-bearing invocation when cleanup is uncertain; provider-specific egress allowlist. | Tenant code can read, print, or transmit its own delivered key. No sandbox API can prevent that while also allowing the code to use the key. Cross-tenant isolation is the promised boundary. |
| Upstream provider/token theft | Prefer OAuth and short-lived access tokens; refresh server-side; rotate refresh tokens transactionally; revoke upstream; never persist access tokens in v1. A provider that cannot operate under that rule requires a new reviewed contract. | The provider necessarily receives its credential. A request already sent upstream, or an in-flight execution holding the old value, cannot be erased by a local tombstone. |
| Availability attack/Vault outage | Timeouts, bounded retry with jitter before plaintext exists, readiness signal, explicit backend selection, and fail-closed errors. No plaintext/DEK cache is used as an outage workaround. | Vault/KMS unavailability blocks credential-backed executions. This is an intentional security-over-availability choice. |

### Process-memory honesty

Node/V8 cannot guarantee secret zeroization. The server implementation keeps
plaintext fields and DEKs in `Buffer` instances, overwrites them with
`buffer.fill(0)` in `finally`, and drops references. The shared contract uses
`Uint8Array` to preserve the repository rule against `Buffer` in shared code.
This is best effort only: immutable JS strings, GC copies, native-library copies,
HTTP-library normalization, heap snapshots, core dumps, and a compromised
process may retain data. Implementations must keep bytes until the last provider
API boundary; if an SDK requires a string header, create it at that final call,
never interpolate it into a URL or error, and drop the reference immediately.
Do not claim certified zeroization in product copy or compliance evidence.

## Generic provider abstraction

### Registry contract

The registry is immutable trusted startup composition, analogous to the static
workspace-type and tool-trust declarations. Tenants select from it; they cannot
register OAuth/token endpoints, egress hosts, trust, field bindings, or provider
code. A new conforming provider is one registration/config entry. Its credential
storage, API, UI, status, rotation, OAuth callback, and resolver behavior require
no provider-specific persistence or route code.

```ts
export type ProviderId = string & { readonly __providerId: unique symbol }
export type CredentialFieldId = string & { readonly __credentialFieldId: unique symbol }
export type CredentialConsumerBindingId = string & {
  readonly __credentialConsumerBindingId: unique symbol
}

export type ProviderCategoryV1 =
  | "llm"
  | "search"
  | "transcription"
  | "mcp"
  | "other"

export interface CredentialFieldDefinitionV1 {
  readonly id: CredentialFieldId
  readonly label: string
  readonly required: boolean
  readonly sensitivity: "secret" | "public"
  readonly minBytes?: number
  readonly maxBytes: number
}

export interface ExternalManagedAccountReferenceDefinitionV1 {
  readonly label: string
  readonly maxBytes: number
  readonly persistence: "server-only-metadata"
}

export type ProviderCredentialDefinitionV1 =
  | Readonly<{
      type: "api-key"
      fields: readonly CredentialFieldDefinitionV1[]
    }>
  | Readonly<{
      type: "oauth2-authorization-code"
      tokenCustody: "local-vault"
      clientRegistrationRef: string
      authorizationEndpoint: `https://${string}`
      tokenEndpoint: `https://${string}`
      revocationEndpoint?: `https://${string}`
      scopes: readonly string[]
      usePkce: true
      refreshTokenField: CredentialFieldDefinitionV1
      resolvedAccessTokenField: CredentialFieldDefinitionV1
      accessTokenPersistence: "memory-only"
    }>
  | Readonly<{
      type: "oauth2-authorization-code"
      tokenCustody: "external-managed"
      custodianAdapterId: string
      connectUrlOrigins: readonly `https://${string}`[]
      scopes: readonly string[]
      accountReference: ExternalManagedAccountReferenceDefinitionV1
      delivery: "host-session-adapter-only"
    }>
  | Readonly<{ type: "none" }>

export interface ProviderDefinitionV1 {
  readonly contractVersion: "boring.provider.v1"
  readonly id: ProviderId
  readonly displayName: string
  readonly category: ProviderCategoryV1
  readonly credential: ProviderCredentialDefinitionV1
  readonly consumerBindingIds: readonly CredentialConsumerBindingId[]
  readonly sandboxEgressOrigins: readonly `https://${string}`[]
  readonly mcp?: Readonly<{
    transport: "streamable-http"
    endpoint?: `https://${string}`
    toolkitId?: string
    allowedTools: readonly string[]
    deniedTools: readonly string[]
  }>
}

export interface ProviderRegistryV1 {
  readonly contractVersion: "boring.provider-registry.v1"
  list(): readonly ProviderDefinitionV1[]
  require(providerId: ProviderId): ProviderDefinitionV1
}
```

Rules:

- Provider IDs and field IDs use a conservative, length-bounded ASCII grammar.
  No identifier becomes a filesystem path, env name, SQL identifier, log value,
  or unvalidated URL.
- API-key credentials can contain one or many secret/public fields (for example,
  key plus account/region). Secret fields are encrypted separately; public
  fields are metadata only if the registry explicitly marks them public.
- `none` providers use the same onboarding/status surface but persist no secret.
- Local-vault OAuth providers are configuration-only: exact HTTPS endpoints,
  client-registration reference, scopes, PKCE, and token fields are registered.
  The stored refresh field is resolver-internal and cannot be requested by a
  consumer; a consumer receives only the derived short-lived
  `resolvedAccessTokenField`. Both are complete, distinct
  `CredentialFieldDefinitionV1` records with `required: true`,
  `sensitivity: "secret"`, and deployment-bounded `maxBytes`; only the refresh
  field is persisted and only the derived access field may appear in a consumer
  binding. Registry validation rejects missing, duplicate, public, unbounded, or
  oversized token fields.
- External-managed OAuth providers register a reviewed generic custodian
  adapter, allowed connect origins/scopes, and a bounded opaque account-reference
  definition. They define no refresh/access-token fields because Boring receives
  neither token. The account reference is server-only metadata, never a consumer
  field, browser DTO, or sandbox value; v1 permits only a trusted host session
  adapter. A future custodian that returns access-token bytes requires a new
  versioned bounded short-lived-token contract and security review before any
  sandbox binding.
- A non-standard provider cannot add ad hoc route code; first extend and review
  the generic local-OAuth or custodian-adapter contract, then register it.
- OAuth client secrets belong to the deployment/operator, not a tenant
  workspace credential. Store them in Vault/operator configuration with the same
  file/secret discipline; never expose them through the tenant credential API.
- `sandboxEgressOrigins` is declarative policy input, not authorization by
  itself. SBX1 must enforce it with DNS/IP and network-isolation evidence before
  an untrusted consumer is enabled. V1's current `--network none` remains until
  that separate acceptance gate passes.

### Credential identity and reuse

The v1 identity is `(workspaceId, providerId)` with one active profile. The UI
also stores a tenant-chosen display label such as `Production Tavily`; that label
is not part of lookup authority. Every field version belongs to the same
workspace/provider pair. Consumers reference the provider—not a raw secret row,
field name, or user-owned MCP source.

Plugins, MCP servers, first-party tools, the Pi model adapter, and approved
tenant custom tools all consume the same reference. They receive only fields
declared for their host-owned consumer binding. A plugin cannot enumerate or
resolve credentials merely because it runs in the workspace; its server
registration must declare the provider and trust/delivery mode. Frontend plugin
code never receives a reference that can resolve plaintext.

## CREDENTIAL-INJECTION CONTRACT

This is the shared seam that `wt-391-forward-6gd.1` / SBX1.1 may implement
against before vault storage lands. It is self-contained and intentionally
separates credential identity, workspace authority, execution scope, resolution,
and delivery. It replaces plaintext `withRuntimeEnvContributions()` merging for
secrets; ordinary non-secret env contributions remain a separate type.

### Credential-injection tiers (amendment D — ratified 2026-07-20)

The injection contract is split into two tiers. The contract below defines the
seam for both; **v1 implements only Tier 1**.

- **Tier 1 — HOST-SIDE RESOLUTION (v1, ship now).** For trusted / first-party
  tools the key is resolved host-side and the outbound provider API call is made
  from the host; the **secret NEVER enters the sandbox**. This covers the owner's
  actual v1 needs — web-search (Tavily), transcription, and model keys — all
  first-party. In contract terms these are bindings with `trust: "trusted"` and
  `delivery: "host-only"`. **This is the only injection tier built in v1.**

- **Tier 2 — IN-SANDBOX INJECTION (DEFERRED).** For untrusted tenant custom tools
  (the tenant's own "user repo" code that needs a credential), a secret is
  delivered into the sandbox via stdin/pipe (FD 3) or per-execution tmpfs —
  **never env/argv/image**. This is the only path that puts a secret inside the
  sandbox. It is **DEFERRED** until a tenant actually authors a credential-using
  custom tool, and is gated behind (a) a **hostile-test harness** — plant a canary
  secret and assert it never appears in sandbox env, `/proc/*/environ`, argv,
  image, common create-context, or logs; assert a cross-workspace probe cannot
  read another workspace's injected secret; mirror the runsc qualification-harness
  approach — plus (b) a **red-team pass on the contract** before implementation.

**v1 does NOT implement in-sandbox injection.** The contract defines the seam,
Tier 1 implements it, and Tier 2 is a named deferred bead (`16f.6`). The
`sandbox-pipe` / `sandbox-tmpfs` delivery modes, the
`SandboxCredentialSecretPayloadV1` frame, and the untrusted-consumer sections
below all specify Tier 2; they are documented now so the seam is stable, but they
do not ship in v1.

### TypeScript-level v1 contract

```ts
export const PROVIDER_CREDENTIAL_REF_VERSION =
  "boring.provider-credential-ref.v1" as const

export type CredentialConsumerKindV1 =
  | "model-provider"
  | "first-party-tool"
  | "plugin-server"
  | "mcp-server"
  | "tenant-custom-tool"

export type CredentialDeliveryV1 =
  | "host-only"
  | "sandbox-pipe"
  | "sandbox-tmpfs"

/** Immutable authority registered by the host beside the tool/provider catalog. */
export interface CredentialConsumerBindingV1 {
  readonly contractVersion: "boring.credential-consumer-binding.v1"
  readonly id: CredentialConsumerBindingId
  readonly providerId: ProviderId
  readonly consumer: Readonly<{
    id: string
    kind: CredentialConsumerKindV1
    trust: "trusted" | "untrusted"
  }>
  readonly purpose: string
  readonly allowedFieldIds: readonly CredentialFieldId[]
  readonly delivery: CredentialDeliveryV1
  readonly sandbox?: Readonly<{
    credentialChannel: "fd-3" | "tmpfs-v1"
    egressOrigins: readonly `https://${string}`[]
  }>
}

export interface CredentialConsumerBindingRegistryV1 {
  readonly contractVersion: "boring.credential-consumer-bindings.v1"
  require(bindingId: CredentialConsumerBindingId):
    CredentialConsumerBindingV1
}

/** Constructed by a trusted factory from a registered binding. */
export interface ProviderCredentialRefV1 {
  readonly contractVersion: typeof PROVIDER_CREDENTIAL_REF_VERSION
  readonly providerId: ProviderId
  readonly executionId: string
  readonly bindingId: CredentialConsumerBindingId
}

export interface ProviderCredentialRefFactoryV1 {
  readonly contractVersion: "boring.provider-credential-ref-factory.v1"
  create(input: Readonly<{
    providerId: ProviderId
    executionId: string
    bindingId: CredentialConsumerBindingId
  }>): ProviderCredentialRefV1
}

/**
 * Opaque, in-process Core capability. The brand symbol and constructor are not
 * exported; Core records issued object identity in a private WeakMap.
 */
declare const authorizedWorkspaceCredentialScopeBrand: unique symbol
export interface AuthorizedWorkspaceCredentialScopeV1 {
  readonly contractVersion: "boring.authorized-workspace-credential-scope.v1"
  readonly [authorizedWorkspaceCredentialScopeBrand]: true
}

export type VerifiedWorkspaceCredentialPrincipalV1 =
  | Readonly<{
      kind: "user"
      userId: string
      membershipRole: "owner" | "editor" | "viewer"
    }>
  | Readonly<{
      kind: "system"
      principalId: string
      workspaceGrantId: string
    }>

export interface VerifiedWorkspaceCredentialAuthorityV1 {
  readonly workspaceId: string
  readonly appId: string
  readonly principal: VerifiedWorkspaceCredentialPrincipalV1
  readonly authorizationReceiptId: string
  readonly expiresAt: string
}

/** Core-owned verifier; a TypeScript cast or copied object is never authority. */
export interface WorkspaceCredentialAuthorityVerifierV1 {
  readonly contractVersion: "boring.workspace-credential-authority-verifier.v1"
  verifyCurrent(
    scope: AuthorizedWorkspaceCredentialScopeV1,
  ): Promise<VerifiedWorkspaceCredentialAuthorityV1>
}

export type ResolvedCredentialMaterialV1 =
  | Readonly<{
      kind: "field-set"
      fields: ReadonlyMap<CredentialFieldId, Uint8Array>
    }>
  | Readonly<{
      kind: "external-managed-account"
      custodianAdapterId: string
      opaqueAccountReference: Uint8Array
    }>
  | Readonly<{ kind: "none" }>

export interface ResolvedCredentialLeaseV1 {
  readonly contractVersion: "boring.resolved-credential.v1"
  readonly workspaceId: string
  readonly providerId: ProviderId
  readonly credentialVersion: number
  readonly executionId: string
  /** Server implementation uses Buffer; shared contract remains Uint8Array. */
  readonly material: ResolvedCredentialMaterialV1
  readonly expiresAt: string
  /** Idempotent best-effort overwrite and reference release. */
  dispose(): void
}

export interface WorkspaceCredentialResolverV1 {
  readonly contractVersion: "boring.workspace-credential-resolver.v1"
  resolve(
    workspace: AuthorizedWorkspaceCredentialScopeV1,
    ref: ProviderCredentialRefV1,
  ): Promise<ResolvedCredentialLeaseV1>
}

export const CREDENTIAL_ERROR_CODES = {
  PROVIDER_UNKNOWN: "CREDENTIAL_PROVIDER_UNKNOWN",
  NOT_CONFIGURED: "CREDENTIAL_NOT_CONFIGURED",
  DISABLED: "CREDENTIAL_DISABLED",
  REVOKED: "CREDENTIAL_REVOKED",
  FORBIDDEN: "CREDENTIAL_FORBIDDEN",
  WORKSPACE_MISMATCH: "CREDENTIAL_WORKSPACE_MISMATCH",
  CONSUMER_MISMATCH: "CREDENTIAL_CONSUMER_MISMATCH",
  DELIVERY_FORBIDDEN: "CREDENTIAL_DELIVERY_FORBIDDEN",
  AUTHORITY_INVALID: "CREDENTIAL_AUTHORITY_INVALID",
  SCHEMA_MISMATCH: "CREDENTIAL_SCHEMA_MISMATCH",
  UNREADABLE: "CREDENTIAL_UNREADABLE",
  BACKEND_UNAVAILABLE: "CREDENTIAL_BACKEND_UNAVAILABLE",
  LEASE_EXPIRED: "CREDENTIAL_LEASE_EXPIRED",
  OAUTH_STATE_INVALID: "CREDENTIAL_OAUTH_STATE_INVALID",
  OAUTH_REFRESH_FAILED: "CREDENTIAL_OAUTH_REFRESH_FAILED",
} as const

export type CredentialErrorCode =
  (typeof CREDENTIAL_ERROR_CODES)[keyof typeof CREDENTIAL_ERROR_CODES]

export class CredentialResolutionError extends Error {
  readonly code: CredentialErrorCode
  readonly retryable: boolean

  constructor(
    code: CredentialErrorCode,
    message: string,
    options: Readonly<{ retryable?: boolean }> = {},
  ) {
    super(message)
    this.name = "CredentialResolutionError"
    this.code = code
    this.retryable = options.retryable ?? false
  }
}

/** Reference-only request owned by the SandboxProvider/SBX1 protocol seam. */
export interface SandboxCredentialDeliveryRequestV1 {
  readonly contractVersion: "boring.sandbox-credential-delivery.v1"
  readonly workspaceId: string
  readonly sandboxId: string
  readonly executionId: string
  readonly deliveryAttemptId: string
  readonly ref: ProviderCredentialRefV1
}

export const SANDBOX_CREDENTIAL_MAX_FIELDS_V1 = 16
export const SANDBOX_CREDENTIAL_MAX_METADATA_BYTES_V1 = 16_384
export const SANDBOX_CREDENTIAL_MAX_TOTAL_BYTES_V1 = 65_536

/** Secret-bearing, one-shot payload. Never JSON/string/base64 serialized. */
export interface SandboxCredentialSecretPayloadV1 {
  readonly contractVersion: "boring.sandbox-credential-secret-payload.v1"
  readonly workspaceId: string
  readonly sandboxId: string
  readonly executionId: string
  readonly deliveryAttemptId: string
  readonly bindingId: CredentialConsumerBindingId
  readonly credentialVersion: number
  readonly expiresAt: string
  readonly fields: readonly Readonly<{
    fieldId: CredentialFieldId
    value: Uint8Array
  }>[]
}

export interface SandboxCredentialSecretPayloadLeaseV1 {
  readonly payload: SandboxCredentialSecretPayloadV1
  dispose(): void
}

/**
 * Host callback supplied to SandboxProvider composition; it verifies current
 * workspace authority and exact sandbox binding before decrypting.
 */
export interface SandboxCredentialPayloadResolverV1 {
  readonly contractVersion: "boring.sandbox-credential-payload-resolver.v1"
  resolveForDelivery(
    workspace: AuthorizedWorkspaceCredentialScopeV1,
    request: SandboxCredentialDeliveryRequestV1,
  ): Promise<SandboxCredentialSecretPayloadLeaseV1>
}

/** Value-free receipt checked before and after one sandbox execution. */
export interface SandboxCredentialDeliveryReceiptV1 {
  readonly contractVersion: "boring.sandbox-credential-delivery-receipt.v1"
  readonly workspaceId: string
  readonly sandboxId: string
  readonly executionId: string
  readonly deliveryAttemptId: string
  readonly bindingId: CredentialConsumerBindingId
  readonly channel: "fd-3" | "tmpfs-v1"
  readonly deliveredFieldIds: readonly CredentialFieldId[]
}
```

`resolve(workspace, ref)` means exactly: first call the Core-owned authority
verifier, reject a scope whose object identity was not issued by Core or whose
receipt expired, and re-read the current user membership plus app ownership (or
the current explicit system-principal workspace grant). Only the verified
authority's `workspaceId` may select storage. Then resolve the single active
credential for `ref.providerId`, load `ref.bindingId` from the immutable host
registry, require that the binding's provider matches the ref, authorize its
host-assigned consumer/trust/purpose/field subset/delivery/egress, refresh OAuth
server-side if needed, and return a single-execution in-memory lease. The raw
resolver is composed with `WorkspaceCredentialAuthorityVerifierV1`; no caller
may substitute a verifier or pass workspace/app/role strings directly.

User capabilities are short-lived and become invalid as soon as current
membership or app ownership no longer matches. Queued work persists only the
non-secret initiating actor/workspace identifiers; at dispatch, Core re-runs
current authorization and issues a fresh in-process capability, so membership
removal before resolve denies the job. A true service principal uses a
separately provisioned,
revocable, workspace-specific grant with narrower registered consumer bindings;
there is no implicit global system principal. Authorization receipts and opaque
scope identities are server-memory authority, not browser tokens, durable job
arguments, or loggable identifiers. The resolver never trusts authority fields
copied into a ref; the trusted factory copies only provider/execution/binding
identity after validating the binding. The reference deliberately contains no
workspace ID: callers cannot smuggle a second tenant selector alongside the
Core-authorized workspace. The returned workspace/provider/execution values are
checked again by the dispatcher before use.

The resolver performs one authoritative read per execution and never returns a
stored secret to HTTP or shared/frontend code. A lease is not serializable,
cacheable, cloneable, loggable, or renewable. `dispose()` is called in `finally`;
expiry is a second fence, not a cleanup substitute. An outer helper should make
correct use easy (`withResolvedCredential(workspace, ref, callback)`), but it
must be a wrapper around this exact interface rather than another resolver.

External APIs should collapse workspace mismatch/forbidden/not-found details to
a non-enumerating response. Internal logs keep only the stable code. The
`WORKSPACE_MISMATCH` code exists for invariant tests and trusted diagnostics,
not to reveal another tenant's credential existence.

The binding registry is the sole authority for requested fields. For OAuth it
may expose the derived short-lived access-token field but never the stored
refresh-token field. An external-managed binding has no allowed fields, is
trusted/host-only, and receives only the server-side custodian/account material
needed by the registered session adapter; it can never produce a sandbox secret
payload. For sandbox consumers the binding must include an exact channel and an
egress-origin subset of the provider definition. A trusted first-party binding
cannot select sandbox delivery; an untrusted binding cannot select `host-only`
to escape the sandbox trust boundary. `wt-391-forward-6gd.1` owns
the request, secret-payload, callback, binary framing, and receipt schemas plus
their validation/rejection tests. `wt-391-forward-6gd.3` implements those schemas
in the remote worker and owns only the concrete worker-to-child FD/tmpfs channel
and cleanup.

### Trusted host-side consumption

For a binding with `trust: "trusted"`, delivery MUST be `host-only`. The Pi model
adapter, Tavily/Firecrawl search proxy, Deepgram/transcription proxy, MCP
transport, and trusted plugin server adapters resolve immediately before their
outbound call, construct the provider authorization header/body at the final
library boundary, return only sanitized provider results, and dispose the lease
in `finally`.

No trusted first-party proxy injects the credential into a sandbox merely
because its caller is an agent. The agent/sandbox receives search results,
transcript output, or normalized MCP results, never the key. Provider error
bodies and response headers are untrusted and pass allowlist/redaction before
logs, events, or sandbox results.

### Untrusted per-execution sandbox delivery

For a binding with `trust: "untrusted"`, host composition may select
`sandbox-pipe` or `sandbox-tmpfs` only when the provider definition, consumer
binding, sandbox capability, and egress policy all allow it. The reference—not
plaintext—crosses ordinary app composition. Resolution happens after the
sandbox execution is authorized and immediately before process start.

Preferred pipe contract:

- JSON tool arguments remain on stdin and JSON result remains on stdout.
- A trusted wrapper exposes a separate inherited descriptor (FD 3 by convention)
  containing one bounded, versioned, length-prefixed credential envelope.
- The wrapper closes the host/worker copy immediately after write. The child
  reads once; the descriptor is close-on-exec for descendants unless the
  intended process explicitly owns it. No secret path/value enters env or argv.
- Secret-bearing stdout/stderr is tenant-visible only under the product's
  existing execution result policy and is never centrally logged, replayed, or
  cached. Canary scanning fails qualification if platform-controlled output
  sinks retain it.

Tmpfs fallback contract:

- Mount a fresh execution-scoped tmpfs directory at a fixed documented path;
  create one mode-`0400` file per registered field with host-assigned fixed
  filenames. The path does not encode the value or tenant input.
- Mount only into the intended process namespace, never the durable workspace.
  Unmount and overwrite/delete the tmpfs contents after success, error, abort,
  or timeout; uncertain cleanup destroys the disposable container before any
  later invocation.
- No Docker bind from a durable host path, image `COPY`, container label,
  `docker exec --env`, CLI argument, or environment pointer to the file is
  permitted.

The value-free `SandboxCredentialDeliveryRequestV1` may cross ordinary control
composition, but the secret payload may not. After Core authority verification
and exact `sandboxId <-> workspaceId <-> executionId <-> deliveryAttemptId`
binding, the host invokes `SandboxCredentialPayloadResolverV1` once and sends the
result over an authenticated, encrypted, per-execution host-to-worker channel.
The worker cannot ask for a provider or field not already bound by the trusted
host reference. Reuse of an attempt ID, expiry, field-count/length mismatch, or
identity mismatch fails closed before child start and disposes the lease.

The v1 host-to-worker media type is
`application/vnd.boring.sandbox-credential.v1+octet-stream`; secret values are
never JSON/base64 encoded, form data, or part of a common exec/create body. Its
normative framing is a 4-byte unsigned big-endian metadata length, UTF-8 JSON
metadata capped by `SANDBOX_CREDENTIAL_MAX_METADATA_BYTES_V1` that
contains every payload property except `fields[].value` plus each field's
declared byte length, followed in that declared field order by raw bytes for
each value. The frame permits at most
`SANDBOX_CREDENTIAL_MAX_FIELDS_V1` fields and
`SANDBOX_CREDENTIAL_MAX_TOTAL_BYTES_V1` aggregate value bytes; every individual
value must also satisfy its registered field `maxBytes`. The authenticated
channel binds the entire frame against truncation/tampering and accepts no
automatic retry or replay. Metadata parsing rejects duplicate/unknown fields,
non-canonical ordering, trailing bytes, length overflow, or a version other than
v1.

The secret-bearing frame and in-memory `SandboxCredentialSecretPayloadV1` are
marked non-loggable in protocol middleware and are excluded from access/body
logging, retry/replay queues, idempotency stores, telemetry, traces, heap/core
dump collection where configurable, and crash reports. Transport errors retain
only value-free request identity plus stable error code. The host calls
`dispose()` in `finally` after the worker acknowledges copy or any error; the
worker separately clears its frame buffers after copying into FD/tmpfs. This is
best-effort process-memory hygiene, not a claim of guaranteed erasure.

### SBX1 reconciliation matrix

| SBX1 H3 concept | Contract here | Lane B action |
| --- | --- | --- |
| Ordinary env and secrets are distinct | Retained | Keep ordinary `env`; add typed credential references, never a heuristic suffix classifier. |
| Model credentials stay host-side | Generalized to all trusted first-party providers | Reject `host-only` references in remote-worker/Sandbox exec. |
| `sandbox-invocation-secret` | Becomes provider credential ref with untrusted consumer, exact fields, execution ID, and delivery | Stub the ref/resolver callback now; vault implementation lands behind it later. |
| Worker stdin envelope populates child env | Rejected by the mandatory brief | Use dedicated FD/pipe or tmpfs; do not call it `secretEnv`. |
| Tombstone suppresses fallback | Retained | Resolve authoritatively per execution; disabled/revoked fails before delivery. |
| Best-effort buffer clearing and clean process set | Retained and strengthened | Destroy/recreate after uncertain cleanup; do not claim JS zeroization. |

## Vault storage and cryptographic backend

### Envelope model

Use one 256-bit DEK per workspace generation, not one app-wide key and not a new
DEK per field. All credential fields in that workspace generation use the DEK
with unique nonces and distinct AAD. The DEK is wrapped by the selected KEK
provider and stored only as an EDK. The plaintext DEK exists only during an
encrypt/decrypt operation and is overwritten/dropped in `finally`.

Logical encrypted field envelope:

```ts
export interface CredentialEnvelopeV1 {
  readonly envelopeVersion: "boring.credential-envelope.v1"
  readonly wrappedDek: WrappedWorkspaceDekV1
  readonly ciphertext: Uint8Array
  readonly nonce: Uint8Array       // exactly 12 random bytes for AES-GCM
  readonly authTag: Uint8Array     // exactly 16 bytes, always verified
  readonly aadContext: Uint8Array  // canonical, persisted, recomputed and matched
}
```

The database may normalize the shared `wrappedDek` into a
`workspace_credential_keys` row, but the joined logical envelope must contain
all fields above. Never infer a backend or key version from a global default;
persist them so migration and fail-closed routing are deterministic.

AAD uses a canonical, versioned, unambiguous byte encoding of at least
`workspaceId:credentialId:providerId:fieldId:credentialVersion:dekGeneration`.
The implementation calls `cipher.setAAD()` before encryption and the matching
`decipher.setAAD()` plus `decipher.setAuthTag()` before finalization. A row moved
between workspaces, providers, fields, or versions must fail. Tests mutate every
component independently.

For AES-256-GCM:

- Generate the 32-byte DEK and every 12-byte nonce with cryptographic randomness
  (`Vault datakey` for the DEK, `crypto.randomBytes(12)` for field nonces).
- Never reuse a nonce under the same DEK, including retries. Generate before the
  transaction and discard the whole attempted envelope on conflict; do not retry
  by reusing bytes.
- Persist and verify the 16-byte authentication tag. Authentication failure is
  `CREDENTIAL_UNREADABLE`; it is never treated as absent.
- Forbid ECB, unauthenticated CBC, static/zero IV, reused nonce,
  `crypto.createCipher`, `Math.random`, custom crypto, or equality with
  `==`/`===`. Use a length guard plus `crypto.timingSafeEqual` for OAuth state,
  receipts, or any secret comparison.
- Keep `node:crypto` under server-only code. No `node:*` or `Buffer` value enters
  `src/shared/**`.

libsodium XChaCha20-Poly1305 with 24-byte random nonces is an acceptable future
backend only as a versioned envelope format with migration and conformance proof;
v1 should choose Node AES-256-GCM to minimize new native dependencies.

### KmsBackend interface (pluggable KEK provider)

This `WorkspaceKekProviderV1` interface **is** the ratified `KmsBackend`
abstraction (amendment A). Its surface is intentionally minimal and
backend-agnostic — `generateDataKey` (wrap a fresh per-workspace DEK),
`unwrapDataKey` (unwrap a stored EDK), optional `rewrapDataKey` (rotation), and
`readiness` (fail-closed-on-unavailable) — so OVH KMS, Scaleway Key Manager,
Exoscale KMS, the local-KEK envelope, and self-run Vault/OpenBao Transit are all
just implementations of this one interface. Only the KEK-holder call differs;
the per-workspace DEK and AAD-bound AES-256-GCM field crypto (decision #10) are
identical across every backend. `readiness()` returning `ready: false`, or any
backend/KEK error, denies the credential operation (fail closed) and never falls
back to another backend or to plaintext. No Vault-Transit-specific client type
appears in the shared contract; Transit-specific detail lives only inside the
optional Vault implementation below.

```ts
export const WORKSPACE_KEK_PROVIDER_VERSION =
  "boring.workspace-kek-provider.v1" as const

export interface WorkspaceKekContextV1 {
  readonly workspaceId: string
  readonly dekGeneration: number
  readonly requestId: string
}

export type WrappedWorkspaceDekPayloadV1 =
  | Readonly<{
      format: "vault-transit-ciphertext.v1"
      ciphertext: Uint8Array
    }>
  | Readonly<{
      format: "local-aes-256-gcm.v1"
      ciphertext: Uint8Array
      nonce: Uint8Array
      authTag: Uint8Array
      aadContext: Uint8Array
    }>
  | Readonly<{
      /** A future backend must define and conformance-test this format. */
      format: "external-kms-opaque.v1"
      payloadFormatId: string
      opaqueAuthenticatedPayload: Uint8Array
    }>

export interface WrappedWorkspaceDekV1 {
  readonly providerId: string
  readonly keyRef: string
  readonly keyVersion: number
  readonly payload: WrappedWorkspaceDekPayloadV1
}

export interface GeneratedWorkspaceDekV1 {
  readonly plaintextDek: Uint8Array
  readonly wrappedDek: WrappedWorkspaceDekV1
}

export interface WorkspaceKekProviderV1 {
  readonly contractVersion: typeof WORKSPACE_KEK_PROVIDER_VERSION
  readonly providerId: string
  generateDataKey(context: WorkspaceKekContextV1):
    Promise<GeneratedWorkspaceDekV1>
  unwrapDataKey(
    context: WorkspaceKekContextV1,
    wrapped: WrappedWorkspaceDekV1,
  ): Promise<Uint8Array>
  rewrapDataKey?(
    context: WorkspaceKekContextV1,
    wrapped: WrappedWorkspaceDekV1,
  ): Promise<WrappedWorkspaceDekV1>
  readiness(): Promise<Readonly<{ ready: boolean; reasonCode?: string }>>
  close?(): Promise<void>
}
```

The runtime provider has no destructive method. Transit key creation, rotation,
minimum-version advancement, trim/delete, and local key destruction belong to a
separately authenticated security-admin workflow with explicit workspace target,
dry-run/inventory, two-person approval where available, immutable audit receipt,
and recovery/retention warning. Product traffic never possesses that role.

Selection is immutable startup configuration, like `SandboxProviderV1`. Each
envelope records its provider ID. An instance configured for Transit cannot
unwrap a `local-kek` envelope unless a deliberate migration command enables both
readers; a backend outage never changes selection. Unknown provider/version is a
stable fail-closed error.

`WrappedWorkspaceDekV1.payload` is persisted losslessly with its format. The
local v1 format's nonce is exactly 12 bytes, tag exactly 16 bytes, and AAD is
recomputed from workspace/generation/backend and compared before tag
verification. A future opaque KMS payload is accepted only after its format has
a normative authenticated serialization and the same corruption/rewrap/
migration conformance; “opaque” is not permission to omit integrity metadata.

### OVH KMS integration (default managed backend)

OVHcloud KMS is the ratified default `KmsBackend` implementation (amendment A):
the owner already runs on OVH; OVH KMS provides encrypt/decrypt plus
generate-data-key, exposes both a REST API and KMIP, is FIPS 140-3 / ISO 27001
attested, offers EU regions (Gravelines, Strasbourg, Frankfurt), and costs
roughly $0.06/key/month. Integration notes:

1. Provision one non-exportable KMS key per workspace under a bounded opaque
   key-reference namespace; the runtime app cannot create/delete it (a separate
   security-provisioning path owns key lifecycle, mirroring the Vault split
   below).
2. On the first credential write for a workspace generation, call OVH KMS
   generate-data-key for a 256-bit DEK and store the returned wrapped DEK as the
   EDK using the `external-kms-opaque.v1` `WrappedWorkspaceDekPayloadV1` format
   (`payloadFormatId` identifies OVH KMS); decode the plaintext DEK directly into
   a `Buffer` and overwrite it in `finally`.
3. Field encryption (fresh 12-byte nonce, AAD, 16-byte tag) is identical to every
   other backend.
4. On resolution, send the EDK to OVH KMS decrypt, use the returned DEK for only
   the requested fields/execution, verify GCM AAD/tag, and dispose.
5. Authenticate with **client-certificate auth** — REST over mTLS, or the KMIP
   endpoint with a client cert — using operator-provisioned credentials delivered
   through the same sealed-file discipline as every other operator secret; never
   log the cert/key. **Pin the region** so a workspace's keys stay in one EU
   region, and record the region alongside the key reference for deterministic
   fail-closed routing.

Scaleway Key Manager (first-party Node SDK) and Exoscale KMS are alternate
managed-EU-KMS implementations of the same `KmsBackend` interface; each records
its own `payloadFormatId` under `external-kms-opaque.v1` and must ship the same
corruption/rewrap/migration conformance proofs.

### Optional self-run Vault Transit provider

Self-run HashiCorp Vault/OpenBao Transit is an **optional heavy alternative**
`KmsBackend`, not a default or requirement. When an operator chooses it, provision
one non-exportable, non-plaintext-backup Transit key/reference per workspace under
a bounded opaque namespace. On the first credential write for a workspace
generation:

1. The security-provisioning path ensures the workspace Transit key exists; the
   runtime app cannot create/delete it.
2. Runtime calls `POST /transit/datakey/plaintext/:name` for 256 bits and receives
   `{plaintext, ciphertext}`. Decode plaintext directly into a `Buffer`; retain
   the returned Vault ciphertext as the EDK.
3. Encrypt each required secret field locally with the plaintext DEK and a fresh
   12-byte nonce/AAD/tag, within the credential transaction.
4. Overwrite the plaintext DEK in `finally`. Persist the field envelope and EDK,
   never the base64 plaintext returned by Vault.
5. On resolution, send the EDK to `POST /transit/decrypt/:name`, use the returned
   DEK for only the requested fields/execution, verify GCM AAD/tag, and dispose.

Vault runtime authentication uses AppRole RoleID plus a response-wrapped/short-
lived SecretID delivered through separate mounted files. The Node service
exchanges them for a short-lived renewable token, renews near 50% of TTL, and
never logs credentials/tokens. Configure `token_num_uses=0` with a short TTL as
the brief requires. Bound CIDRs and namespaces where deployed.

Runtime policy allows only the exact workspace key namespace and required
`transit/datakey/plaintext/*` and `transit/decrypt/*` operations (plus
`transit/encrypt/*` only if a proved flow uses it). It denies list/export/backup,
`transit/keys/*` administration, policy/auth/audit configuration, and unrelated
secret engines. A separate rotation role permits the minimum exact
`rotate`/`rewrap`/configuration operations and does not become the app role.

Enable a Vault audit device. Vault's HMAC treatment of sensitive values
complements—but does not replace—application audit events. Verify that ingress,
proxy, and client libraries do not record Vault request/response bodies.

### Explicit local-KEK/self-host provider

Self-host deployments without Vault select `local-kek` (or a separately
implemented cloud KMS provider) in config. Generate a 32-byte KEK outside the
app; store it in a root/operator-owned sealed file or age/sealed-box workflow,
mounted read-only with strict ownership/mode. Do not introduce a new plaintext
environment-key default. The service necessarily holds this KEK transiently in
memory, so its app-compromise blast radius is greater than Transit and must be
shown as a degraded-security status in readiness/admin UI.

The local provider wraps each workspace DEK with AES-256-GCM using its own fresh
12-byte nonce, 16-byte verified tag, and AAD binding workspace/generation/backend.
Field encryption remains identical. Store local KEK material separately from
Postgres and its backups. Rotation creates a new KEK version and rewraps EDKs;
old KEK retirement waits for complete verified rewrap and backup policy.

Never fall back from Transit to local automatically. If the local KEK is missing,
wrong, or unreadable, readiness and credential operations fail closed; they do
not try `WORKSPACE_SETTINGS_ENCRYPTION_KEY`. Self-host documentation must state
that deleting only a live EDK does not instantly crypto-shred copies in backups
that still contain the EDK and surviving KEK.

### Proposed persistence model

Use dedicated credential tables instead of opaque keys in generic
`workspace_settings`:

- `workspace_provider_credentials`: `(workspace_id, provider_id)` primary key,
  display label, registered credential type/schema version, state
  (`active|disabled|revoked|needs_reauth|intentionally_absent|instance_fallback_enabled`),
  active credential version,
  DEK generation, masked suffix metadata, OAuth custody/account/scopes metadata,
  created/updated actor IDs and timestamps, upstream revocation state/receipt
  metadata. `intentionally_absent` is retained after field deletion and is an
  authoritative fallback-suppression fence; only the dedicated confirmed action
  may change it to `instance_fallback_enabled`. No secret/ciphertext in list DTO
  selection.
- `workspace_provider_credential_fields`: workspace, provider, credential
  version, field ID, envelope version, ciphertext, nonce, auth tag, persisted AAD,
  and DEK-generation foreign key. Every query includes workspace and provider;
  the secret value never appears in a predicate.
- `workspace_credential_keys`: workspace, DEK generation, KEK provider/key ref/
  key version, wrapper format, wrapped ciphertext/payload, and format-required
  nonce/tag/AAD, state, timestamps. One active generation; historical generations
  are retained only while referenced or rollback policy requires.
- `provider_oauth_transactions`: one-use, short-TTL state transaction bound to
  workspace/provider/initiating owner/redirect/PKCE. Store the verifier through
  the envelope backend because token exchange needs recovery; store only a
  timing-safe-comparable state digest/opaque handle. Consume atomically before
  exchange and delete/expire promptly.
- Security audit records/events contain metadata only and use the existing #807
  durable event contract if durable product events are required. Do not add a
  competing event bus.

Disable Drizzle/Postgres query logging for these tables and routes regardless of
global debug settings. Use explicit select lists so metadata endpoints cannot
accidentally select envelope columns. Secret-bearing parameters and rows must
never be stringified by ORM, Pino, Fastify validation errors, OpenTelemetry,
PostHog, test snapshots, or exception causes.

## Product surface and unified onboarding

### Workspace settings experience

Reuse and generalize the MCP provider overlay into a `Providers & credentials`
workspace-settings surface:

1. Owner opens workspace settings and chooses a category/provider from the
   trusted registry (Anthropic/OpenAI, Tavily/Firecrawl, Deepgram/Whisper, Notion/
   Airtable MCP, or future registered provider).
2. The same provider card shows `Not configured`, `Connecting`, `Active`,
   `Needs attention`, `Disabled`, or `Revoked`; credential type controls only the
   inner step, not a separate product flow.
3. API-key provider: owner names the profile, enters its registered fields in a
   write-only form, and submits once. The response returns state/version,
   timestamps, provider/account label, and masked last four only. The form clears
   local state after submission and never redisplays a stored value.
4. OAuth provider: owner names the profile and starts consent. The server creates
   a one-use transaction and returns only an approved authorization URL; the
   existing safe popup/redirect mechanism opens it. For `local-vault`, callback
   and token exchange occur server-side; for `external-managed`, the registered
   custodian adapter owns the hosted consent/session and returns only a bounded
   server-side account reference. UI polls/refreshes the same metadata status.
5. Public provider: activation records metadata only or requires no row; the card
   reports available without presenting a fake secret field.
6. Active card offers `Replace/rotate`, `Reconnect`, `Disable`, `Revoke`, and
   `Delete credential` according to type and role. Provider deletion removes
   its field envelopes after revocation/retention handling but retains a minimal
   non-secret `intentionally-absent` tombstone. It is not called crypto-shredding
   because the DEK is shared by all providers in the workspace. For a registered
   fallback-capable model provider, `Return to instance fallback` is a separate,
   confirmed owner action; deletion never performs it implicitly.
7. A separate workspace-wide security action, outside every provider card, may
   request `Crypto-shred all workspace credentials`. It names the complete blast
   radius, counts affected providers, requires separate confirmation and the
   out-of-band security-admin workflow, and cannot be mistaken for one-provider
   deletion.

No reveal/copy endpoint exists. `last-4` is separate metadata captured at write;
list operations do not decrypt just to render status. Avoid returning secret
length, prefix, validation echo, provider error body, refresh token expiry, or
ciphertext. Provider account labels are sanitized and length-bounded.

### Generic state machine

```text
not-configured
  ├─ API-key submit ──> validating ──> active
  ├─ OAuth start ─────> authorizing ─> exchanging ─> active
  └─ public enable ────────────────────────────────> active

active ──> replacing/refreshing ──> active
active ──> needs-reauth ──> authorizing ──> active
active ──> disabled ──> active (explicit owner enable only)
active|disabled|needs-reauth ──> revoked (tombstone)
revoked ──> authorizing/API-key submit ──> active new version
revoked ──> deleted/intentionally-absent (tombstone retained)
deleted/intentionally-absent ──> authorizing/API-key submit ──> active new version
deleted/intentionally-absent ──> instance-fallback-enabled
                                 (separate confirmed owner action, registered providers only)
```

Validation failure leaves the previous active version untouched. A new write is
encrypted and optionally checked by a bounded host-side provider probe before an
atomic active-version swap. Never send a test request from the browser or
sandbox. A provider without a safe validation endpoint may mark `active` after
local schema validation and report the first real upstream auth failure as
`needs attention` without logging its response body.

### OAuth authorization-code and refresh sequence

Steps 1–4 and 6–7 are the direct `local-vault` sequence. Step 5 defines the
external-managed branch through the same onboarding states without pretending
that Boring owns its tokens.

1. Owner POSTs `oauth/start` for an authorized workspace/provider. Server loads
   the registered HTTPS endpoints/scopes/callback, creates high-entropy state,
   PKCE verifier/challenge, one-use transaction, short expiry, and exact
   workspace/provider/actor binding. It returns only the authorization URL.
2. Browser visits the provider. Callback receives authorization code/state over
   TLS. Server authenticates the user again, verifies current workspace-owner
   authority, exact redirect, unexpired unused state with length guard plus
   `timingSafeEqual`, consumes the transaction atomically, and rejects replay.
3. Server exchanges code plus PKCE verifier and operator-owned OAuth client auth
   directly with the registered token endpoint. Codes/tokens and raw provider
   errors are never logged or sent to browser analytics.
4. For `local-vault` custody, encrypt the refresh token as the registered secret
   field through the same per-workspace envelope pipeline. Keep the access token
   in an execution-bounded memory lease only. Persist sanitized provider account,
   granted scopes, token endpoint metadata version, and masked refresh suffix if
   useful—never the access token, ID token, code, or token response.
5. For `external-managed` custody such as current Composio, persist only the
   provider/connected-account reference and explicit custody label. Boring did
   not receive a refresh or access token, so no fictitious token field is
   registered or persisted; the bounded reference stays out of browser DTOs and
   consumer field bindings. The external custodian's connect/status/revoke and
   host-session operations remain behind the registered generic adapter and
   audit model. V1 forbids sandbox delivery for this custody mode.
6. Before a trusted provider call, resolver decrypts the refresh token, requests
   a short-lived access token server-side, transactionally stores a rotated
   refresh token as a new encrypted version when returned, and disposes old/new
   plaintext buffers. Concurrent refresh uses a per-credential lock/version
   compare so a stale response cannot overwrite a rotated token.
7. `invalid_grant` or revoked consent transitions to `needs-reauth` without
   fallback. Revoke first writes the local tombstone/fence, then attempts the
   registered upstream revocation and records receipt/state; failure remains
   visibly `revoked-upstream-pending` and retries out of band without reopening
   local resolution.

### API shape

Dedicated, owner-authorized endpoints (names are plan-level and may follow Core
route conventions during implementation):

- `GET /api/v1/workspaces/:id/providers` — registered definitions plus metadata-
  only workspace status.
- `PUT /api/v1/workspaces/:id/provider-credentials/:providerId` — write/replace
  the named API-key profile; accepts registered fields, returns metadata only.
- `POST .../:providerId/oauth/start` and one fixed callback — one-use auth-code
  flow; callback returns a safe UI redirect, never tokens.
- `POST .../:providerId/validate|disable|enable|revoke` — explicit lifecycle
  transitions; revoke creates the tombstone before upstream work.
- `DELETE .../:providerId` — separately confirmed logical deletion of that
  provider credential after local fence/upstream revocation; erase field
  envelopes but retain a durable non-secret `intentionally-absent` tombstone, so
  delete cannot reactivate instance fallback. Response and audit explicitly say
  this is not cryptographic erasure of backups.
- `POST .../:providerId/allow-instance-fallback` — only for a provider whose
  trusted registration permits fallback; separately confirmed owner action that
  clears the suppression tombstone and records payer/authority impact.
- `POST /api/v1/workspaces/:id/credential-vault/crypto-shred` — initiate the
  separately authorized workspace-wide destruction workflow; it lists every
  affected provider and never runs under the product runtime Vault role.

All mutation routes require current owner membership, CSRF protection,
rate/body limits, idempotency semantics that store no plaintext request, and an
audit event. Generic `/workspaces/:id/settings` rejects reserved credential
names/prefixes. Resolver functions are server-only dependency injection, never an
HTTP endpoint.

### How consumers reference a credential

Trusted configuration or a validated tenant tool declaration says only:

```ts
providerCredential: {
  contractVersion: "boring.provider-credential-ref.v1",
  providerId: "tavily",
}
```

At execution, trusted host composition expands this into the full
`ProviderCredentialRefV1` with execution ID, registered consumer/trust, purpose,
allowed fields, and delivery. Tool/model arguments cannot provide or override
those fields. A provider reference is reusable across approved consumers in the
same workspace but resolves against the caller's authorized workspace every
time; copying the declaration to another workspace resolves that other
workspace's credential or `CREDENTIAL_NOT_CONFIGURED`, never the original.

## Lifecycle, rotation, revocation, and deletion

### Credential replacement

- Encrypt a complete new field set as version `n+1`; partial secret updates are
  forbidden because retained hidden fields are ambiguous.
- Validate without exposing plaintext, atomically swap active version, and
  resolve only the new version for future executions. No plaintext cache means
  the next call observes it.
- A bounded in-flight execution may finish with version `n`. Record that fact,
  best-effort abort on emergency, and revoke the old key/token upstream after the
  swap. Do not claim the old bytes were erased from a provider request already
  sent.

### KEK and DEK rotation

- Transit KEK rotation: security admin calls the deployed-version-confirmed key
  rotation operation; new datakey/rewrap operations use the new version. A
  background admin job calls `transit/rewrap` on workspace EDKs without exposing
  DEK plaintext, verifies each returned EDK/version, and advances
  `min_decryption_version` only after complete inventory and rollback approval.
- Local KEK rotation: load old/new sealed key versions only in the migration job,
  unwrap/rewrap each workspace DEK, verify, then retire old material after backup
  policy. Normal app startup selects the active version and retains explicitly
  allowed old readers only during migration.
- DEK rotation after suspected plaintext-DEK compromise: generate a new
  workspace DEK generation, decrypt/re-encrypt every active credential field
  with fresh nonces/AAD, verify, atomically switch references, then cryptoshred
  the old generation under the approved admin/retention process.

### Logical provider deletion, instant revocation, and workspace crypto-shred

1. **Fence now:** atomically write `disabled`/`revoked` tombstone before external
   calls. Every resolver read sees it; future host and sandbox use stops. The
   tombstone suppresses instance fallback.
2. **Abort best effort:** cancel active host requests and secret-bearing sandbox
   executions; destroy uncertain containers. An already copied/sent secret may
   survive.
3. **Kill upstream:** tenant/operator revokes the exact key or OAuth grant at the
   provider and records non-secret receipt/state. Local state is not called fully
   revoked while upstream is pending.
4. **Delete one provider logically:** after the fence and required upstream
   receipt/retention window, remove that provider's field envelopes but retain a
   durable non-secret `intentionally-absent` tombstone. Other provider
   credentials under the workspace DEK remain usable. A fallback-capable model
   still resolves `CREDENTIAL_REVOKED`; only the separate confirmed
   `allow-instance-fallback` transition may clear that suppression state.
   Database backups may still contain recoverable copies, so this is never
   labeled crypto-shredding.
5. **Crypto-shred the whole workspace credential vault:** out-of-band security
   admin destroys the workspace-scoped Transit key/version or local wrapped-DEK/
   key material according to the deployed-version-confirmed runbook, then proves
   every provider in that workspace is unreadable while another workspace stays
   readable. Ciphertext remains as nonrecoverable audit/deletion evidence only as
   policy allows.
6. **Backups:** document when database/Vault/local-key backups expire and whether
   they preserve recovery. Never promise instant irreversible deletion beyond
   the tested key-destruction and backup boundary.

## MCP and per-consumer integration

### One onboarding system

Generalize the existing MCP structures instead of placing a new credential form
beside the MCP overlay:

- `McpProviderTemplate` becomes an MCP-specific extension of
  `ProviderDefinitionV1`; existing tool allow/deny and transport metadata remain.
- `BoringMcpSourcesOverlay` becomes or consumes the shared provider-card/state
  components. MCP may keep its tool catalog view, but connect/status/lifecycle
  comes from the common credential APIs.
- New workspace MCP credentials use `createdByUserId` as audit metadata and
  workspace authorization plus registered consumer policy as authority. Existing
  `McpSource.userId`/`ownerKind: "user"` records retain their current personal
  access semantics until an explicit promotion/reconnection completes.
- Inventory `__serverBoringMcpSourcesV1` by `(workspace, provider, user)` before
  migration. Zero connections is empty; one connection is still quarantined as
  personal; more than one is a collision requiring an owner choice. Never pick
  first/newest/connected automatically.
- Promoting one personal source requires explicit consent from the connected
  user while they are still a member and explicit approval by a current
  workspace owner. If the provider/custodian cannot transfer account authority,
  reconnect through a new workspace-scoped consent instead and revoke/leave the
  personal connection under its prior semantics. A departed user's account is
  never promoted by an owner alone.
- Only after consent/reconnection and provider-account confirmation does the new
  workspace record make `userId` audit-only. Do not move any value matching a
  secret/token shape into metadata; external-managed connector refs are reviewed
  field by field and sensitive session headers stay server-side/transient.
- Adapt `ManagedConnectorSecretResolver` to consume the generic host-side
  credential resolver for tenant provider credentials. The operator-owned
  Composio API key remains an operator secret, not copied per workspace.
- Preserve current origin allowlisting, source status, revoke verification,
  readonly tool policy, response redaction, and secret-canary gates.

### Consumer matrix

| Consumer | Trust/delivery | Credential use |
| --- | --- | --- |
| Pi LLM/chat provider | trusted, host-only | Resolve at the pinned per-provider-request auth seam, including cached/follow-up/continuation/compaction paths; retain Decision 27 no-ambient-auth and explicit fallback tests. |
| Tavily/Firecrawl search | trusted, host-only proxy | Resolve on host, call provider from bounded proxy, sanitize/return results only. Never inject search key into agent sandbox. |
| Deepgram/hosted transcription | trusted, host-only proxy | Stream/upload through bounded host proxy, keep key out of media metadata and sandbox, return transcript/artifact only. Local/public Whisper uses `none`. |
| Trusted plugin server | trusted, host-only | Plugin receives a scoped resolver callback/binding, not store access or an HTTP plaintext endpoint. Frontend half receives metadata only. |
| MCP transport | trusted, host-only | Direct OAuth refresh or external-managed account/session is resolved server-side; MCP result passes existing readonly/redaction policy. |
| Tenant custom tool | untrusted, sandbox pipe/tmpfs | Only host-approved provider fields for that execution; exact workspace; required egress policy; tenant can read its own delivered key. |

## pi reuse on the connection/consumption edge (amendment E — ratified 2026-07-20)

BYOK must **maximize reuse of pi** (`@mariozechner/pi-coding-agent`, the Boring
fork) on the CONNECTION / CONSUMPTION edge. pi already owns, per session:

- MCP client connection + auth,
- model-provider credential resolution at call time, and
- any OAuth token-refresh at the provider boundary.

BYOK's job is to hand pi the **already-resolved credential** for one execution and
let pi perform the provider/MCP authentication it already knows how to do. BYOK
does **not** reimplement provider connection, model-key call-time wiring, or MCP
transport auth that pi already owns.

Conversely, BYOK does **not** push multi-tenant credential **storage**, the vault,
onboarding, per-workspace isolation, or authority into pi. Those are host-app /
control-plane concerns per the control/data-plane split; pi is a per-session
runtime, not a multi-tenant custody boundary. The seam is: control plane resolves
and owns custody → pi consumes a single-execution resolved credential.

**Before implementation** (a `16f.1`/`16f.5` prerequisite), inventory pi's actual
provider-auth, MCP-connection, and OAuth-token-refresh surface so BYOK reuses those
exact seams precisely instead of duplicating them. The Pi model adapter and MCP
transport rows in the consumer matrix resolve host-side (Tier 1) and pass pi the
resolved material at pi's existing call-time auth point.

## Package ownership and implementation boundaries

- `@hachej/boring-core`: provider registry contract/host composition, credential
  metadata and envelope stores, owner-only HTTP/OAuth lifecycle, workspace
  authorization, KEK provider composition, audit DTOs, migrations, and stable
  errors. Node crypto remains server-only.
- `@hachej/boring-agent`: provider-credential ref/resolver contract at a package
  layer that does not create a value-import cycle, trusted consumer binding, Pi
  request-time adapter, and no-secret session/event/log proof.
- `@hachej/boring-sandbox`: capability/type for per-execution credential delivery
  and conformance tests; it never owns credential persistence or Vault. SBX1
  remote-worker implements the authenticated pipe/tmpfs data-plane channel.
- `@hachej/boring-bash`: untrusted tool dispatcher consumes the reference and
  sandbox delivery capability; it does not resolve/store credentials or infer
  secret env names.
- `@hachej/boring-mcp`: extend the shared provider/onboarding contracts and
  migrate source persistence while preserving MCP-specific catalog/policy.
- Host apps: register providers, operator OAuth clients, selected KEK provider,
  trusted consumer bindings, and explicit model fallback policy. No app copies
  onboarding routes or vault crypto.

Exact shared-package placement is part of 16f.1 acceptance: it must preserve
the invariants that workspace base front/shared code has zero value imports from
Agent, Agent has no runtime-package value imports, and `src/shared/**` has no
`node:*`/`Buffer` values.

## Proposed Bead chain (`wt-391-forward-16f.x`)

This plan's `.beads` chain is created by the owner-ratified STEP 4 (2026-07-20);
the logical IDs below retain the parent's `16f` naming (br assigns the concrete
IDs). The chain is **contract-first** and folds in amendment D (host-side Tier 1
vs deferred in-sandbox Tier 2) and amendment E (pi reuse). The contract bead
lands first so Lane B / SBX1.1 can compile against it without waiting for custody
or UI.

| Proposed ID | Title | One-line scope | Dependency |
| --- | --- | --- | --- |
| `16f.1` | credential-injection CONTRACT + provider-registry seam | Land the typed secret-reference + `(workspace, providerId) -> credential` resolve interface, provider/field/ref/resolver/opaque-authority/lease/error and (deferred-Tier-2) sandbox payload/callback types, host-owned trust/delivery rules, **host-side resolution path (Tier 1)**, fakes, package exports, cross-package compile tests. No storage/wire/plaintext implementation. **This is the seam SBX1.1 (#855) reconciles its stub against.** | Parent `wt-391-forward-16f`; owner ratifications; #391 Step 1A gate. |
| `16f.2` | vault storage (KmsBackend + OVH-KMS default + local-KEK fallback) | Dedicated credential schema/store, per-workspace DEK, AAD-bound AES-256-GCM per the research brief; `KmsBackend` abstraction with **OVH-KMS default impl** + **local-KEK dev fallback**; write-only/masked, timing-safe, no-secrets-in-logs; backend conformance. | `16f.1`. |
| `16f.3` | onboarding flow (provider registry + API-key + OAuth) | Provider registry + API-key onboarding (write-only forms, masks/tombstones) + OAuth authorization-code + refresh; owner-only routes. | `16f.1`, `16f.2`. |
| `16f.4` | MCP generalization onto the shared mechanism | Migrate `boring-mcp` onboarding onto the shared provider-credential mechanism (consent-quarantine per decision #6); **reuse pi's MCP connection edge** (amendment E). | `16f.3`. |
| `16f.5` | first-party proxy tools (Tier 1) | Wire web-search (Tavily/Firecrawl) and transcription (Deepgram/Whisper) to resolve **host-side via the contract (Tier 1)**; key never enters the sandbox; sanitized results only. | `16f.2`. |
| `16f.6` | **(DEFERRED)** in-sandbox injection (Tier 2) | Untrusted-tool credential delivery via stdin/pipe (FD 3) or per-execution tmpfs; gated behind the **canary/leak-invariant hostile-test harness + red-team** (amendment D). Not built in v1. | Deferred. |
| `16f.7` | migration off `WORKSPACE_SETTINGS_ENCRYPTION_KEY` | Inventoried migration, verify-before-switch, tombstone; retire the legacy credential path per decision #11. | `16f.2`. |

The #820 graph is acyclic: `16f.1 -> 16f.2 -> {16f.3 -> 16f.4, 16f.5, 16f.7}`;
`16f.6` is DEFERRED (no in-chain blocker forces it). Host-only Tier-1 proxies
(`16f.5`) do not wait for onboarding UI or MCP.

The proposed cross-lane recut is also explicit and acyclic:

1. `wt-391-forward-6gd.1` consumes the `16f.1` contract (the host-side
   resolution seam) and owns serialization/validation/rejection of the value-free
   request, the versioned bounded non-loggable secret frame and resolver
   callback boundary, the value-free receipt, replay/length/version rejection,
   and `sandboxId <-> workspaceId` binding. It does not own vault reads,
   tombstone persistence, or worker-to-child secret delivery. This is Tier-2
   (deferred) wire work; it does not gate Tier-1.
2. `16f.5` consumes vault storage from `16f.2` and resolves credentials
   host-side (Tier 1) for the first-party proxies. Host-only providers do not
   wait for a worker runtime or any in-sandbox channel.
3. `wt-391-forward-6gd.3`, already the SBX1 Docker+runsc runtime/wrapper bead,
   pairs with the **DEFERRED Tier-2 bead `16f.6`**: it consumes `6gd.1` plus the
   `16f.1` contract, implements the `6gd.1` wire/callback contract, and owns
   concrete worker-to-child FD 3/tmpfs delivery, process cleanup, model-key
   rejection, and secret-bearing container teardown, all behind the amendment-D
   hostile-test harness + red-team gate. It may not invent a second message or
   place the frame in an ordinary exec body. Its existing child-env wording is
   replaced by this plan after ratification.
4. SBX1 host-conformance/cutover references to old `#820 16f.3` become the new
   `16f.4` MCP-generalization / host conformance as applicable; concrete sandbox
   proof still cannot pass before `6gd.3` plus `16f.6` and qualification/egress
   gates.

Beads conversion must preserve these replacement edges and must not happen until
the owner ratifies this plan.

## Acceptance and proof

### Contract and registry

- A standalone SBX1 fake can compile against `16f.1`, accept a typed reference/
  delivery request plus fake payload-resolver callback, reject model/host-only
  delivery, validate bounded payload identities, emit a value-free receipt, and
  return stable errors without importing a vault/store implementation.
- Registry tests prove every provider/field ID, OAuth URL/scope, consumer binding,
  host-assigned trust, purpose, allowed field, delivery mode/channel, and egress
  origin is validated at startup.
- OAuth registry/token tests reject missing, public, duplicate, or oversized
  refresh/access fields; bindings cannot request the refresh field, and an
  oversized token-endpoint response fails before lease/delivery construction.
- External-managed registry tests reject token fields and non-host delivery,
  bound account-reference length/origin checks are enforced, and browser/
  sandbox DTO scans find neither the reference nor a fictitious token.
- Tenant input/model output/command text cannot create or widen a reference.
- Package import invariants remain green.

### Cryptographic conformance

- Raw Postgres inspection finds no plaintext canary, DEK, KEK, OAuth code/token,
  or provider auth header.
- Known-answer/round-trip tests cover every backend; corrupt ciphertext, nonce,
  tag, AAD, EDK, backend ID, key ref, and key version independently and prove
  fail-closed `CREDENTIAL_UNREADABLE`/backend errors.
- Generate many encryptions under one test DEK and assert nonce uniqueness; test
  code also forbids zero/static nonce and unauthenticated modes.
- Workspace A's field/EDK copied to B, provider A copied to provider B, field A
  copied to field B, and version A copied to version B all fail authentication.
- Wrong/missing Transit/local key is unreadable, never absent, and never triggers
  another backend or instance fallback.
- Vault integration against the recorded deployed version proves datakey,
  decrypt, rotate, rewrap, minimum-version retirement, AppRole TTL renewal,
  runtime-policy denials, audit-device behavior, and workspace-only crypto-shred.
- Local-backend proof uses a separate sealed-file fixture, verified wrapper tag,
  rotation/rewrap, startup failure without key, and no environment fallback.

### Authorization and API

- Owner may create/replace/connect/disable/revoke; editor/viewer and nonmember
  cannot. Generic settings route cannot write reserved credential keys.
- GET/list/status/validation/error/OAuth callback responses contain metadata and
  last four only; property/canary scans reject secret/ciphertext/EDK/token fields.
- Every store query and audit event includes workspace; external denial does not
  reveal whether another workspace/provider credential exists.
- A plain object, copied object, expired capability, or TypeScript-cast fake
  cannot pass the Core authority verifier. Remove an initiating user's membership
  after queueing but before dispatch and prove the fresh authorization/resolve is
  denied; revoke a system grant and prove the same.
- Query logging remains secret-free even with development ORM/global log flags.
  No secret is a SQL `WHERE` literal.
- Rate, body, CSRF, idempotency, and concurrent version-swap tests cover every
  mutation. Idempotency storage never records a secret request body.

### OAuth

- Exact redirect/origin, state/PKCE, short TTL, atomic consume, replay,
  cross-workspace callback, initiator-lost-owner-role, denied scope, provider
  error, and popup cancellation cases are covered.
- Refresh token is encrypted through the same envelope path; access token stays
  memory-only; rotating refresh response atomically supersedes old version under
  concurrency; `invalid_grant` produces `needs-reauth` without fallback.
- Revoke writes tombstone before provider call and records upstream pending/
  confirmed without values. External-managed custody clearly stores no local
  refresh token and passes the same status/revoke/redaction contract.
- MCP migration tests seed two users in one workspace with the same provider,
  prove neither account is promoted or selected automatically, require connected-
  user consent plus current-owner approval/reconnection, reject a departed-user
  promotion, and preserve personal authority on rollback.

### Host and cross-tenant resolution

- Two workspaces × at least two providers × concurrent model/plugin/MCP/search/
  transcription calls observe only their matching canaries at the final fake
  provider boundary.
- Cached Pi prompt, follow-up, queued follow-up, continuation, compaction, slash
  command, abort, and drain paths retain the existing narrow-plan proof; rotation
  is visible on the next provider request.
- Host proxy results contain no secret in headers/body/errors/logs/events/
  sessions/traces. Search/transcription keys never enter Sandbox exec.
- Tombstone blocks the next resolve immediately, suppresses permitted model
  fallback, and does not depend on worker broadcasts/cache invalidation.
- `revoke -> delete -> resolve` remains `CREDENTIAL_REVOKED`/suppressed and never
  reaches the instance key. Only the separately confirmed
  `allow-instance-fallback` transition enables the registered fallback, with an
  audit event that records the authority/payer change.

### Sandbox delivery

- Two-workspace × two-sandbox cross-product rejects mismatched refs before Vault
  decrypt; authenticated `sandboxId <-> workspaceId` receipt is mandatory.
- Lane B protocol tests round-trip the exact v1 binary frame and reject duplicate
  or unknown fields, non-canonical order, forged/replayed attempt ID, expiry,
  version mismatch, truncation, trailing bytes, individual/aggregate overflow,
  and any attempt to serialize the secret payload as JSON/base64 or an ordinary
  exec/create body. Logs/retry/APM fakes receive only value-free identities and
  stable codes.
- Canary is available only on FD 3 or fixed tmpfs files to the intended process;
  absent from env, `/proc/<pid>/environ`, `ps`, argv, Docker inspect/config,
  labels, image/history/layers, durable `/workspace`, logs, telemetry, request
  bodies retained for replay, later processes, and later executions.
- Success, provider error, handler error, timeout, abort, process fork/double
  fork, and worker disconnect all close/unmount/clear; uncertain cleanup destroys
  the container and blocks reuse.
- Sandbox delivery remains disabled under network-none until a registered
  provider egress policy and fresh SBX1 isolation/exfiltration qualification pass.
- A positive control proves the intended tenant process can read its own
  credential and call only the allowed fake endpoint; the residual-risk owner
  acceptance is documented in product/operator guidance.

### Lifecycle and operational proof

- Credential replacement is atomic; old remains active on validation failure;
  active in-flight version is reported honestly; upstream revocation receipt is
  tracked without value.
- Logical deletion of provider A leaves provider B readable and reports no
  crypto-shred claim; workspace-wide shred makes A and B unreadable while an
  independent workspace remains readable.
- Runtime Vault role cannot create, rotate, configure, export, backup, trim, or
  delete keys. Admin workflow cannot accidentally target all workspaces, supports
  dry-run inventory, and records exact workspace/key/version.
- Crypto-shred drill proves every provider in the selected workspace is
  unreadable and another workspace remains readable, then documents backup/Vault
  recovery implications.
- Redaction corpus includes API keys, bearer tokens, OAuth code/refresh/access
  tokens, auth headers/cookies, EDK/ciphertext shapes, canaries, and provider
  error echoes across Pino/Fastify/Drizzle/APM/session/event/sandbox sinks.

### Expected implementation commands

Exact test filenames land with their beads, but the public proof path is:

```bash
pnpm --filter @hachej/boring-core typecheck
pnpm --filter @hachej/boring-core test
pnpm --filter @hachej/boring-agent typecheck
pnpm --filter @hachej/boring-agent test
pnpm --filter @hachej/boring-sandbox typecheck
pnpm --filter @hachej/boring-sandbox test
pnpm --filter @hachej/boring-mcp typecheck
pnpm --filter @hachej/boring-mcp test
pnpm lint:invariants
```

Vault integration, migration rehearsal, sandbox hostile isolation, and exact
artifact/log scans are release gates in addition to unit commands; they cannot be
waived by mocks for SaaS launch.

## Migration and rollout

1. Inventory every current `workspace_settings` key and MCP
   `__serverBoringMcpSourcesV1` record. Classify metadata versus credential
   material; do not assume arbitrary settings are secrets or safe metadata.
2. Land `16f.1` types with no behavior. Lane B compiles its reference-only
   protocol/rejections against refs, bindings, opaque authority, and the
   no-environment request/secret-payload/callback/receipt types while existing
   paths remain unchanged.
3. Configure/prove one KEK backend. Production refuses credential APIs until
   readiness and policy checks pass. No selected backend means feature disabled,
   not plaintext.
4. Create dedicated schema and migrate explicit credential allowlist/prefixes.
   For a legacy encrypted credential, decrypt once using the legacy key, encrypt
   into the new envelope, verify via the new resolver/provider probe, dispose,
   then atomically switch that workspace/provider read pointer. Never dual-write
   secret values.
5. Generalize UI/API and inventory MCP metadata cardinality. Keep existing
   connections under personal authority while pending; quarantine every candidate
   and collision. Promote exactly one only after connected-user consent,
   current-owner approval, and provider reconnection/verification. Preserve
   personal authority for unselected/departed/conflicting sources. Rollback
   restores old personal metadata/authorization only, never broadens authority
   and never converts new ciphertext to plaintext.
6. Canary host-only model/MCP/search/transcription consumers first. Observe only
   value-free success/error/audit metrics.
7. Enable sandbox delivery only after SBX1 binding, cleanup, and per-provider
   egress proof. Host-only paths do not wait for broad sandbox egress.
8. Tombstone or quarantine migrated legacy credential rows. Remove their legacy
   read only after a full rollback window; retire
   `WORKSPACE_SETTINGS_ENCRYPTION_KEY` for credentials after backup-retention and
   owner approval. It may remain temporarily for unrelated legacy settings, but
   it is never a vault fallback.

Rollback disables new onboarding and consumer bindings, leaves encrypted records
intact, and restores the previous code path only where that path is still safe
and explicitly retained. A credential already migrated to Transit is never
decrypted back into generic settings. Backend outages roll back availability,
not custody. A revoked tombstone is never cleared by rollback.

## Non-goals

- Platform-funded pooled keys, billing, and payer attribution remain #809/BL1
  after #819 metering.
- Cross-workspace/org-shared credentials, personal user credentials, marketplace
  secret delegation, and multiple profiles per provider are deferred.
- Tenant-authored provider/OAuth endpoint registration and arbitrary egress are
  forbidden; future providers are trusted deployment registration.
- This plan does not claim protection from a fully compromised authorized app,
  Vault root, browser XSS during paste, upstream provider compromise, or a tenant
  exfiltrating its own deliberately injected key.
- No secret reveal/copy API, plaintext export, key in generic settings, ambient
  Pi auth fallback, new event bus, AgentHost, controller, mutable runtime
  registry, or second Workspace/Sandbox owner.
- This docs-only PR does not create/edit `.beads`, migrations, schemas, routes,
  UI, provider code, Vault policy, or deployment configuration.

## Planning proof and review record

Docs-only proof for this PR:

```bash
git diff --check
test -z "$(git diff --name-only origin/main...HEAD | grep -v '^docs/')"
rg -n '^OWNER RATIFY:' docs/issues/820/byok-secret-vault-plan.md
rg -n 'WORKSPACE_SETTINGS_ENCRYPTION_KEY|ProviderCredentialRefV1|resolve\(|Vault Transit|MCP|OAuth|sandbox-(pipe|tmpfs)' \
  docs/issues/820/byok-secret-vault-plan.md
```

Review ladder record is completed before handoff:

- Tier 1 fresh-eyes: **REVISE**, integrated—separated provider deletion from
  workspace crypto-shred, added host-owned consumer bindings, quarantined MCP
  authority migration/collisions, specified authenticated local EDK wrapping,
  and recut SBX1 ownership/dependencies.
- Tier 2 adversarial security/contract review: **REVISE**, integrated—made
  workspace authority opaque/current-state verified, defined the bounded
  non-loggable host-to-worker frame, retained deletion tombstones across
  fallback, bounded OAuth fields, and discriminated local versus external OAuth
  custody. Final convergence review: **CLEAN**.
- Tier 3 Fable: off (default); no owner approval requested.
