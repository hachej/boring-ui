# Credential vault research and selected direction

Date: 2026-06-29

## Problem

Constellation needs to store and use long-lived user/workspace credentials for:

- MCP-native provider auth, e.g. Notion MCP OAuth tokens;
- regular SaaS OAuth/API credentials, e.g. Airtable, Microsoft/SharePoint;
- Bring Your Own LLM provider credentials, e.g. OpenAI, Anthropic, OpenRouter, Gemini, custom OpenAI-compatible base URLs.

These credentials must be usable by trusted server-side adapters without exposing raw values to browsers, agents, prompts, logs, session transcripts, or workspace files.

## Best-practice summary

Security guidance from OWASP, cloud providers, and SaaS OAuth-token architecture patterns converges on a token-vault boundary:

```txt
metadata and ownership in app DB
encrypted credential payloads at rest
key material separated from DB
server-only secret resolution
provider calls mediated by trusted adapters
no raw-token response API
audit every use/revoke/rotation/probe
redaction on logs/errors/traces/tool results
short-lived access tokens and refresh-token rotation where provider supports it
```

Long-lived refresh tokens and BYO API keys should be treated as privileged credentials equivalent to passwords for connected third-party systems.

## Evaluated off-the-shelf options

### Cred Ninja

Repository: <https://github.com/cred-ninja/sdk>

Relevant packages:

```txt
@credninja/oauth
@credninja/vault
@credninja/server
@credninja/guard
@credninja/mcp
```

Pros:

- Closest conceptual fit for AI-agent credential delegation.
- Explicit model: refresh tokens stay vaulted; agents receive scoped short-lived access or brokered handles.
- Node/TypeScript packages.
- OAuth adapters, PKCE, vault, MCP, and guard/policy packages.
- `@credninja/vault` uses AES-256-GCM, PBKDF2-derived key, SQLite/file backends, and auto-refresh hooks.

Cons for Constellation V0:

- Default vault storage is SQLite/file, not Constellation's Postgres multi-tenant app DB.
- Does not directly model Constellation source/workspace/tool-policy/audit requirements.
- MCP-native OAuth such as Notion MCP still needs MCP SDK/pi-mcp-adapter-derived dynamic client registration flow.

Use as:

```txt
reference implementation and possible source of reusable OAuth/guard ideas;
not the primary V0 hosted credential store unless a Postgres adapter proves clean.
```

### API Locker

Repository: <https://github.com/apilocker/apilocker>

Pros:

- Very relevant product model: LLM API keys, service API keys, OAuth credentials, proxy injection, MCP integration, audit logs, rotation.
- Explicitly avoids putting secrets in `.env`, shell history, and agent configs.

Cons:

- More full product/server than embeddable library.
- Cloudflare Worker/D1/KV architecture does not map directly to Constellation.

Use as:

```txt
reference for product/security model and agent-facing UX;
not a direct dependency.
```

### Infisical

Repository: <https://github.com/Infisical/infisical>

Pros:

- Mature open-source secrets platform.
- Node SDK.
- Self-hostable.
- Secret versioning, audit, rotation, KMS features, integrations.
- Good backend candidate for service/team secrets and future enterprise deployments.

Cons:

- External service dependency.
- Per-user OAuth credentials still need Constellation-owned metadata, refresh locks, source ownership, and provider-specific lifecycle.

Use as:

```txt
optional future SecretStore backend or KMS/secret-management backend;
not V0 dependency.
```

### Vault/OpenBao/cloud KMS

Pros:

- Strong key management, transit encryption, audit, mature security posture.

Cons:

- Additional infra/ops burden for V0.
- Still needs app-owned credential metadata and policy layer.

Use as:

```txt
future backend for envelope-key wrapping or enterprise deployments.
```

## Selected V0 direction

Build an embedded Constellation SecretStore module backed by Postgres encrypted payload rows.

This is not a generic password manager. It is an internal platform capability used only by trusted server-side adapters:

```txt
boring-mcp
BYO LLM provider configuration
future governed integrations
```

### Interface

```ts
interface SecretStore {
  put(input: PutSecretInput): Promise<SecretRef>;
  resolve(ref: SecretRef, purpose: SecretPurpose): Promise<ResolvedSecret>;
  revoke(ref: SecretRef, actor: ActorRef): Promise<void>;
  rotate?(ref: SecretRef, input: RotateSecretInput): Promise<SecretRef>;
}
```

`resolve` is server-only and must never be exposed through browser routes, agent tools, workspace files, logs, or audit payloads.

### Backends

V0:

```txt
EncryptedPostgresSecretStore
```

Designed future backends:

```txt
InfisicalSecretStore
VaultTransitSecretStore / OpenBaoTransitSecretStore
CloudKmsEnvelopeSecretStore
LocalFileSecretStore for CLI/user-managed mode only
```

### Data model sketch

```ts
type CredentialKind =
  | "mcp-oauth"
  | "mcp-api-key"
  | "llm-api-key"
  | "oauth-account-ref"
  | "nango-connection-ref";

interface SecretCredentialRecord {
  id: string;
  workspaceId: string;
  actorId?: string;
  sourceId?: string;
  kind: CredentialKind;
  providerId: string;
  encryptedPayload: Uint8Array;
  encryptionKeyVersion: string;
  payloadSchemaVersion: number;
  status: "pending" | "active" | "revoked" | "error";
  expiresAt?: Date;
  rotatedAt?: Date;
  revokedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
```

### Encryption requirements

V0 must use authenticated encryption:

```txt
AES-256-GCM or XChaCha20-Poly1305
unique random nonce/IV per encryption
versioned payload envelope
key id/version included outside ciphertext
AAD includes workspaceId + credential id + kind + providerId where practical
```

Preferred deployment path:

```txt
envelope encryption
  app uses active master key from env/KMS for V0
  future KMS/Vault backend can wrap/unwrap data keys
```

At minimum V0 must support:

```txt
key version field
active/deprecated key config
read old key versions during rotation window
re-encrypt path for key rotation
```

### Required guardrails

- No API returns raw credential payloads.
- Raw secrets can only be resolved inside trusted server-side execution adapters.
- Redaction guard must cover logs, errors, audit payloads, agent tool results, and provider error messages.
- Audit event records must include actor/source/provider/purpose/outcome but never secret values.
- Credential lookup must be scoped by workspace and actor/source ownership.
- Revoke must invalidate cached clients/connections.
- OAuth refresh must use a per-credential lock/single-flight to avoid refresh-token races.
- Pending OAuth state and PKCE verifiers must be encrypted, short-lived, source-bound, actor-bound, and one-time-consumed.
- Tests must include seeded canary secret values and assert they never appear in public outputs/log-like payloads.
- Static API keys should support hash/fingerprint display without revealing full values.
- BYO LLM credentials must be coupled to model allowlist, budget/token policy, and provider probe status.

## Implementation acceptance gates

Before production use, the embedded SecretStore must have tests/proof for:

```txt
encrypt/decrypt round trip
random nonce produces different ciphertext
wrong key/auth tag fails closed
payload envelope version validation
ownership denial across workspace/actor/source
no raw-token browser/agent route
redaction of seeded canary secrets
revoke prevents future resolve
cache invalidation on revoke/rotation
audit event contains no secret material
OAuth refresh lock behavior
pending OAuth state TTL and one-time consumption
```

Provider-specific gates:

```txt
Notion MCP auth URL generation and hosted token exchange from actual infra
MCP tools/list probe with stored token
Airtable OAuth/PAT probe
Microsoft/SharePoint OAuth refresh/revoke probe
BYO LLM provider probe without exposing API key
```

## Relationship to Better Auth

Better Auth remains the app identity/session/org layer.

Better Auth can own regular OAuth account tokens when provider support is proven and `account.encryptOAuthTokens: true` is enabled.

Constellation SecretStore owns:

```txt
MCP-native OAuth gaps
pending OAuth state / PKCE / dynamic client metadata
BYO LLM API keys
provider credentials Better Auth cannot safely refresh/model
```

The credential resolver remains pluggable:

```txt
better-auth-account
embedded-secret-store
nango
local-file
```

## Final embeddable-library pass

A final targeted pass found one candidate that may materially reduce V0 code: `agent.pw`.

### agent.pw

Repository: <https://github.com/smithery-ai/agent.pw> (fetched mirror/fork: <https://github.com/aospi78/agent.pw>)

Package: `agent.pw`

Why it matters:

```txt
embeddable TypeScript package
Postgres-compatible database, no required daemon
AES-GCM encrypted credential storage
OAuth PKCE, token refresh, revocation
RFC 9728 protected-resource discovery
manual header/API-key credentials
path-scoped credential model
path-scoped rights/rules
refresh-aware resolveHeaders({ path })
FlowStore abstraction for pending OAuth state
```

This is the closest match found for Constellation's desired embedded credential store.

Example API shape:

```ts
const db = unwrap(createDb(process.env.DATABASE_URL!));
const agentPw = await unwrap(
  createAgentPw({
    db,
    encryptionKey: process.env.AGENTPW_ENCRYPTION_KEY!,
    flowStore: createInMemoryFlowStore(),
  }),
);

const prepared = await unwrap(
  agentPw.connect.prepare({
    path: "workspace.connections.notion",
    resource: "https://mcp.notion.com/mcp",
  }),
);

const headers = await unwrap(
  agentPw.connect.resolveHeaders({ path: "workspace.connections.notion" }),
);
```

Potential fit:

```txt
Use as first spike for embedded SecretStore/OAuth lifecycle.
Map Constellation source/workspace/actor IDs to agent.pw paths or wrapping metadata.
Use resolveHeaders only inside trusted server-side adapters.
Keep boring-mcp policy/audit/redaction boundary outside agent.pw.
```

Concerns / gaps to verify:

```txt
License is FSL-1.1-MIT, not plain MIT until future conversion; confirm acceptable for private/commercial Constellation use.
Current crypto uses AES-GCM with 32-byte key and random 12-byte IV, but does not obviously expose our desired key-version/AAD/envelope metadata as first-class fields.
Need verify schema/migrations can coexist with boring-ui Drizzle/Postgres conventions.
Need verify production FlowStore can be SQL/Redis rather than in-memory.
Need verify OAuth discovery handles MCP-native Notion/Airtable flows and dynamic client registration requirements.
Need verify refresh locking/single-flight behavior under concurrent calls.
Need add Constellation-level redaction/audit/no-raw-token tests around it.
```

Decision update:

Before writing a fully custom `EncryptedPostgresSecretStore`, run an `agent.pw` spike. If it satisfies licensing, schema, OAuth, and concurrency requirements, wrap it as the first implementation of Constellation's credential resolver.

If it fails any hard gate, fall back to the embedded custom Postgres SecretStore described above, borrowing `agent.pw`'s path/resource/resolveHeaders model.

### Other final-pass candidates

| Candidate | Finding |
| --- | --- |
| OpenCloak | Interesting open-source OAuth vault for agents; appears more token-exchange/proxy/product oriented and Tailscale/Daytona-shaped than embeddable app library. |
| Auth0 Token Vault samples | Strong managed pattern, but adds Auth0 dependency; useful reference, not private self-owned V0. |
| Supabase Vault | Useful Postgres-extension model for encrypted secrets; best if already on Supabase. Decrypted SQL view is dangerous for our no-raw-secret API requirement unless tightly locked down. |
| oauth-connector | Small MIT OAuth token manager with AES-256-GCM and storage strategies. Simpler than needed; useful for provider refresh reference, not full multi-tenant credential vault. |
| drizzle-encryption / EncoraDB / field encryption libs | Help encrypt columns, but do not solve OAuth lifecycle, agent-safe resolution, refresh locks, revoke/audit policy. |

## Popular-framework preference update

`agent.pw` is technically close to the desired API, but it is too niche to be the default dependency for Constellation.

Updated preference:

```txt
Use popular, durable secret-management backends where possible.
Keep niche agent-vault projects as references only.
```

### Preferred backend candidate: Infisical

Infisical is the best fit among popular/self-hostable options:

```txt
open-source secret-management platform
large community and active development
self-hostable
Node SDK
secret versioning / audit / rotation features
future KMS and secret-management integrations
```

Recommended Constellation shape:

```txt
Constellation DB
  credential metadata
  workspace/actor/source ownership
  provider kind/status
  audit correlation ids
  secretRef

Infisical
  encrypted secret payload
  provider tokens/API keys/client secrets
```

Constellation still owns policy and execution:

```txt
agent/browser -> Constellation operation -> credential resolver -> Infisical SDK -> trusted provider adapter
```

Raw secrets still never go to browser/agent/workspace/logs.

### Enterprise backend: Vault/OpenBao or cloud KMS

For larger/private enterprise deployments:

```txt
Vault/OpenBao Transit or KV
AWS Secrets Manager / KMS
GCP Secret Manager / KMS
Azure Key Vault
```

These can implement the same `SecretStore` interface later.

### Embedded Postgres fallback

Keep embedded `EncryptedPostgresSecretStore` as a fallback when the app must avoid another service.

Use it only with the full security gate list:

```txt
AEAD encryption
key versioning
rotation path
server-only resolve
redaction tests
ownership tests
revoke/cache invalidation
refresh locks
```

### Niche projects demoted to references

| Project | New role |
| --- | --- |
| agent.pw | reference for path/resource/resolveHeaders API and OAuth lifecycle ideas |
| Cred Ninja | reference for agent credential delegation and guard policy |
| API Locker | reference for product UX, proxy injection, LLM/API/OAuth vault surface |
| OpenCloak | reference for token-exchange agent pattern |

They should not be default Constellation dependencies unless a later spike proves maturity, license, and adoption are acceptable.

## Composio managed connector option

Composio is a serious managed option for V0/V1 connector velocity.

Current public positioning/pricing found:

```txt
Free: 20K standard tool calls/month
Paid: $29/month for 200K standard tool calls + overage
Business: $229/month for 2M standard tool calls
```

Capabilities relevant to Constellation:

```txt
managed OAuth for many apps
per-user connected accounts
custom auth configs / bring your own OAuth app credentials
API key / bearer token / basic auth style connectors
MCP/session URLs and managed tool execution
Composio Connect meta-tools for discover/auth/execute
```

### Where Composio fits

Composio can be a managed credential/tool backend for normal SaaS connectors:

```txt
Notion regular API/tools
Airtable
Google/Microsoft/GitHub/Slack/etc.
possibly SharePoint/Microsoft if supported in required shape
```

Constellation would store only:

```txt
workspaceId
actorId
sourceId
providerId
credentialProvider = "composio"
composio userId / connectionId / authConfigId / sessionRef
```

Composio stores/refreshes provider credentials and executes or brokers tool calls.

### Where Composio may not fit

Composio should not replace every credential path:

```txt
BYO LLM provider API keys may still belong in Constellation SecretStore or provider-specific billing/runtime config.
MCP-native Notion MCP auth still needs a real spike; Composio may expose Notion tools but not necessarily raw Notion MCP protocol semantics.
Private/regulated Constellation deployments may reject third-party token/data processing.
```

### Security / procurement gates

Using Composio means accepting it as a third-party credential custodian and tool-call data processor.

Hard gates before production:

```txt
DPA / subprocessors / data residency accepted by owner/customer
security docs reviewed
incident history reviewed and risk accepted
custom OAuth app support verified where brand/control requires it
scopes/tool allowlist enforceable from Constellation
per-user credential isolation verified
revoke/disconnect verified
logs/audit export sufficient for Constellation governance
no raw provider token exposed to Pi/browser/agent
provider-specific spikes for Notion/Airtable/Microsoft
```

Research found public reporting of a 2026 Composio credential incident. Treat this as a reason for diligence, not automatic rejection. A managed connector vendor is a high-value token vault; the decision must be explicit.

### Recommended role

Add Composio as an optional `McpCredentialProvider` / connector backend:

```txt
composio-managed
```

Keep Constellation's own SecretStore path for:

```txt
private deployments
BYO LLM keys
MCP-native provider gaps
customers that reject third-party token custody
fallback if Composio pricing/security/provider coverage changes
```

## Decision update: Composio-first hosted V0

Nango self-host remains useful, but it is too limited to be the default V0 path for Constellation's immediate goal of easy agent/MCP-oriented connector onboarding.

Selected hosted V0 strategy:

```txt
Composio first for managed SaaS connector auth/tool execution.
Keep Constellation SecretStore interface for future self-custody/private deployments.
```

This means Constellation initially stores Composio references, not raw provider tokens, for supported connectors:

```txt
workspaceId
actorId
sourceId
providerId
credentialProvider = "composio-managed"
composio user/connection/session/auth config refs
```

The SecretStore work remains important for:

```txt
BYO LLM API keys
MCP-native provider gaps
private/regulated deployments
customers who reject third-party token custody
fallback if Composio coverage/pricing/security changes
```

Implementation rule:

```txt
Do not hardcode Composio into boring-mcp business logic.
Hide it behind ConnectorCredentialProvider and ConnectorToolProvider interfaces.
```
