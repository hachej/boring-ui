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
