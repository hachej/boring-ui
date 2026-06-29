# Issue #416 — Canonical MCP / Connector Integration Plan

Status: canonical plan after review pass 6
Last updated: 2026-06-29

## Current decision

For hosted Constellation V0, ship fast with **Composio as the preferred managed connector/auth/tool backend**.

Keep the door open for self-custody by preserving provider interfaces and a future Constellation SecretStore path.

```txt
Hosted V0 default:
  ComposioConnectorProvider

Future/private fallback:
  NativeMcpConnectorProvider
  SecretStoreBackedRestConnectorProvider
  Infisical/Vault/KMS-backed SecretStore
  NangoConnectorProvider only where it wins for a specific provider
```

Rationale:

- Composio best matches the immediate product goal: easy onboarding, managed OAuth, per-user connected accounts, and agent/MCP-oriented tool access.
- Nango self-host is useful but too limited for the default V0 product shape, especially around agent tool execution and hosted connector UX.
- Building a full credential store/connector stack remains possible later if private deployments, BYO LLM keys, MCP-native gaps, or customer requirements demand self-custody.

## Source-of-truth rule

This file is the current implementation source of truth.

Historical research and evidence live in:

- [`credential-vault-research.md`](./credential-vault-research.md)
- [`better-auth-mcp-research.md`](./better-auth-mcp-research.md)
- [`nango-selfhost-poc.md`](./nango-selfhost-poc.md)
- [`nango-real-spike.md`](./nango-real-spike.md)
- [`nango-provider-support.md`](./nango-provider-support.md)
- [`nango-notion-mcp-spike.md`](./nango-notion-mcp-spike.md)
- [`pi-mcp-adapter-notion-auth-spike.md`](./pi-mcp-adapter-notion-auth-spike.md)
- [`reviews/`](./reviews/)

If older review/research files conflict with this plan, this plan wins.

## Goals

V0 should let Constellation users connect approved SaaS context providers quickly and safely:

```txt
Connect provider
  → authenticate through Composio where supported
  → discover/normalize available tools
  → classify and expose safe read-only actions
  → search/describe/call through one governed facade
  → audit/redact every result
```

First provider families:

- Notion;
- Airtable;
- Microsoft/SharePoint.

## Non-goals for hosted V0

Do not build these first unless a Composio spike blocks:

- a full custom OAuth credential vault for all SaaS connectors;
- native MCP OAuth for every provider;
- arbitrary hosted stdio MCP servers;
- V2 materialized tools before V0 search/describe/call is green;
- an admin classification UI.

## Architecture

```txt
Constellation UI / agent tools
        ↓
boring-mcp facade
        ↓
ConnectorCredentialProvider + ConnectorToolProvider
        ↓
ComposioConnectorProvider  (hosted V0)
        ↓
Composio managed auth / sessions / tools
        ↓
Notion / Airtable / Microsoft / SharePoint
```

Constellation still owns governance:

```txt
source registry
workspace/user/company-context ownership
provider enablement
read-only default policy
tool normalization/search/describe/call facade
tool/action allowlist and denylist
audit events
redaction of results/errors
model/token budget policy
filesystem boundaries
BYO LLM credential path
private/self-custody fallback path
```

Composio owns hosted V0 connector plumbing where accepted:

```txt
managed OAuth
per-user connected accounts
provider credential storage/refresh
native SaaS tool/action execution
MCP/session/tool metadata surfaces
```

## Canonical V0 agent tool surface

The hosted V0 bridge surface remains stable even though the default backend is Composio:

```ts
mcp_servers_list({ cursor?, limit? })
mcp_server_status({ serverId })
mcp_server_doctor({ serverId })
mcp_server_probe({ serverId })
mcp_tools_search({ query, serverId?, cursor?, limit?, enabledOnly? })
mcp_tool_describe({ serverId, toolName })
mcp_readonly_call({ serverId, toolName, input })
```

Optional resource tools are not part of default V0 unless a provider declares explicit URI validators/prefixes:

```ts
mcp_resources_list({ serverId, cursor?, limit? })
mcp_resource_read({ serverId, uri })
```

Older `mcp_tools_list`-only sketches are superseded. Search + describe are required so agents can discover candidate tools without flooding context and then fetch exact schemas before calling.

## Composio adapter mapping

### Provider/source mapping

Constellation source records should store Composio references, not raw provider tokens:

```txt
workspaceId
actorId / userId
sourceId
providerId
credentialProvider = "composio-managed"
composio userId / connectionId / authConfigId / sessionRef
status
createdAt / updatedAt / revokedAt
```

### Tool mapping

Do not expose Composio raw action names as the stable Constellation API.

Normalize Composio toolkit/action metadata into `boring-mcp` descriptors:

```ts
interface NormalizedConnectorTool {
  serverId: string;
  toolName: string;
  displayName: string;
  summary: string;
  description?: string;
  inputSchema: unknown;
  outputSchema?: unknown;
  risk: 'read' | 'write' | 'admin' | 'unknown';
  enabled: boolean;
  reason: string;
  schemaHash?: string;
  nativeRef: {
    provider: 'composio';
    toolkit: string;
    action: string;
    authConfigId?: string;
  };
}
```

Example:

```ts
{
  serverId: 'airtable-company',
  toolName: 'airtable_search_records',
  displayName: 'Search Airtable records',
  summary: 'Search records in an approved Airtable source.',
  risk: 'read',
  enabled: true,
  nativeRef: {
    provider: 'composio',
    toolkit: 'airtable',
    action: 'AIRTABLE_SEARCH_RECORDS'
  }
}
```

## Search / describe / call semantics

### `mcp_tools_search`

Searches Constellation's normalized catalog, not live Composio on every call.

Rules:

- return summaries/classification, not full schemas;
- support pagination;
- hide disabled tools by default when `enabledOnly` is true;
- include only tools visible to the actor/workspace/source;
- mark stale catalogs unavailable or trigger controlled probe refresh.

### `mcp_tool_describe`

Returns the exact normalized descriptor for one tool:

```txt
description
input schema
output schema if known
risk classification
enabled state + reason
required source/connection status
policy notes
nativeRef for server-side use only
```

The `nativeRef` must not expose provider secrets. It can expose non-secret toolkit/action identifiers in trusted server logs/config, but agent-facing output should prefer stable `serverId/toolName`.

### `mcp_readonly_call`

Single governed execution path:

```txt
lookup normalized tool
check source belongs to actor/workspace
check provider/source enabled
check tool enabled and read-only
validate input schema and size
check budget/rate hooks
call ConnectorToolProvider.callTool
redact provider result/error
write audit event
return safe result
```

Denied or invalid calls must not reach Composio or any downstream provider.

## Materialization roadmap

V0 uses bridge tools only.

V2 may materialize high-confidence direct tools such as:

```txt
mcp_airtable_search_records
mcp_airtable_list_bases
mcp_notion_fetch
```

Rules:

- materialized tools are sugar over `mcp_readonly_call`, never a bypass;
- only exact classified read-only tools can materialize for V0/V1 read-only profiles;
- generated tool names must be stable and collision-free;
- schema/tool drift disables the materialized tool until reclassified;
- no automatic materialization solely from usage count.

## Provider policy defaults

V0 is deny-by-default.

Rules:

- deny before allow;
- unknown tools disabled;
- write/admin/destructive actions disabled by default;
- tool name must match conservative validation unless provider-specific override is reviewed;
- input is schema-validated and size-limited before downstream calls;
- provider outputs pass redaction before logs or agent responses.

Initial Airtable read candidates remain:

```txt
ping
list_bases
list_workspaces
list_tables_for_base
list_records_for_table
get_table_schema
search_records
search_bases
```

Deny patterns:

```txt
create_*
update_*
delete_*
publish_*
admin_*
```

MCP-native annotations such as `readOnlyHint` are helpful classification inputs but never sufficient to enable a tool by themselves.

## Connector interfaces

Hosted V0 must hide Composio behind interfaces.

```ts
interface ConnectorCredentialProvider {
  startConnect(input: StartConnectInput): Promise<ConnectStartResult>;
  getStatus(input: ConnectorStatusInput): Promise<ConnectorStatus>;
  disconnect(input: DisconnectInput): Promise<void>;
}

interface ConnectorToolProvider {
  probe(input: ConnectorProbeInput): Promise<ConnectorProbeResult>;
  searchTools(input: ToolSearchInput): Promise<ToolSearchResult>;
  describeTool(input: ToolDescribeInput): Promise<ToolDescription>;
  callTool(input: GovernedToolCallInput): Promise<GovernedToolCallResult>;
}
```

First implementation:

```txt
ComposioConnectorProvider
```

Future implementations:

```txt
NativeMcpConnectorProvider
SecretStoreBackedRestConnectorProvider
NangoConnectorProvider
```

## SecretStore and self-custody path

Constellation should still define a SecretStore interface for future/private needs:

```ts
interface SecretStore {
  put(input: PutSecretInput): Promise<SecretRef>;
  resolve(ref: SecretRef, purpose: SecretPurpose): Promise<ResolvedSecret>;
  revoke(ref: SecretRef, actor: ActorRef): Promise<void>;
  rotate?(ref: SecretRef, input: RotateSecretInput): Promise<SecretRef>;
}
```

Use cases:

- BYO LLM API keys;
- customers rejecting third-party token custody;
- MCP-native provider gaps;
- private/regulated deployments;
- fallback if Composio coverage/pricing/security changes.

Potential backends:

```txt
InfisicalSecretStore
Vault/OpenBao Transit or KV
AWS/GCP/Azure Secret Manager or KMS envelope backend
EncryptedPostgresSecretStore fallback
LocalFileSecretStore for CLI/user-managed mode only
```

Security requirements for any self-custody backend:

```txt
AEAD encryption
unique nonce/IV per encryption
key versioning and rotation path
server-only resolve API
workspace/actor/source ownership checks
no raw-token browser/agent/tool API
redaction canary tests
revoke/rotation cache invalidation
OAuth refresh lock when applicable
audit events without secret values
```

## Better Auth role

Better Auth remains the app identity/session/org layer.

Better Auth can own regular OAuth account tokens only where a provider-specific spike proves refresh behavior is safe and token encryption is enabled:

```ts
account: {
  encryptOAuthTokens: true
}
```

Better Auth MCP/OAuth-provider plugins are mainly useful for inbound auth if Constellation exposes its own MCP/API to external clients. They do not replace outbound connector credentials for Notion/Airtable/Microsoft.

## Nango role

Nango is no longer default V0.

Use it only if a provider-specific spike shows it beats Composio or self-custody for that provider.

Current finding:

- self-hosted Nango Auth + Proxy can work;
- free self-host is limited;
- `notion-mcp` path was not green through the tested public backend flow;
- Nango remains useful research and optional adapter.

## MCP-native provider path

For exact MCP-native OAuth providers such as Notion MCP, keep a future native path:

```txt
MCP SDK / pi-mcp-adapter-derived OAuth core
+ hosted DB/SecretStore-backed token storage
+ boring-mcp facade/catalog/policy
```

The pi-mcp-adapter spike proved dynamic client registration and Notion auth URL generation can work, but token exchange from the sandbox hit Cloudflare 1010. Hosted production must verify egress before relying on this path.

Hosted V0 does not block on MCP-native Notion if Composio regular Notion tools satisfy the first product need.

## Composio production gates

Composio can ship V0 only after these are green or explicitly accepted:

```txt
Notion/Airtable/Microsoft provider spikes pass
read-only allowlist can be enforced around Composio actions
per-user/workspace isolation verified
custom OAuth app / branded consent path understood
revoke/disconnect behavior verified
no raw provider token reaches browser/agent/logs/workspace files
Composio tool-call/audit metadata is sufficient or wrapped by Constellation audit
redaction guard catches seeded canary values in provider results/errors
DPA/security/subprocessor/data-residency review accepted
public incident-history risk accepted
fallback/private path documented
```

## Redaction boundary

All provider results/errors pass through a redaction guard before logs, audit payloads, or agent responses.

```ts
interface RedactionContext {
  sensitiveValues: string[];
  sensitiveKeys: string[];
  provider?: string;
  sourceId?: string;
}

interface RedactionGuard {
  redact(value: unknown, context: RedactionContext): unknown;
  assertSafeForAgent(value: unknown, context: RedactionContext): void;
  assertSafeForLog(value: unknown, context: RedactionContext): void;
}
```

For Composio-first V0, Constellation may not hold raw provider tokens. Tests still need seeded canary values in fake provider outputs/errors to prove no secret-like values leak.

## Audit requirements

Every connect/probe/search/describe/call/disconnect event should be auditable.

Audit payloads include:

```txt
workspaceId
actorId / userId
sourceId
providerId
credentialProvider
serverId
toolName / native toolkit-action ref when needed
risk classification
allow/deny outcome
error code
latency / size metadata where useful
```

Audit payloads must never include raw provider credentials, API keys, OAuth codes, authorization headers, or Composio API keys.

## Stable error codes

Keep stable errors for tool/provider failures:

```txt
MCP_SOURCE_NOT_FOUND
MCP_SOURCE_FORBIDDEN
MCP_SOURCE_UNAVAILABLE
MCP_PROVIDER_CONFIG_INVALID
MCP_PROVIDER_TIMEOUT
MCP_PROVIDER_ERROR
MCP_TOOL_NOT_FOUND
MCP_TOOL_NOT_ALLOWED
MCP_PROVIDER_TOOL_DRIFT
MCP_RESOURCE_LIMIT_EXCEEDED
MCP_SECRET_LEAK_GUARD
MCP_INPUT_INVALID
MCP_RESOURCE_URI_INVALID
```

Add connector-specific errors only if needed, but map them to stable public codes.

## Operating modes

### Hosted full-app mode — V0 priority

```txt
app defines approved providers
Composio manages connector auth/tool execution when accepted
Constellation owns source registry, policy, audit, redaction, UX
arbitrary stdio disabled
credentials never stored in project files or Pi session files
```

### User-managed / CLI mode — later

```txt
user owns local config/auth
arbitrary MCP can be allowed with warnings
stdio requires explicit user action outside autonomous agent edits
local credentials live in user-local secure storage, not hosted DB
```

Do not let CLI/user-managed config semantics leak into hosted production.

## Implementation sequence

### Phase 0 — provider spike

- Create Composio test project/config.
- Spike Notion, Airtable, Microsoft/SharePoint.
- Verify connect, status, tool metadata, read-only call, revoke/disconnect.
- Record exact allowed tool/action candidates.
- Verify no raw token exposure.

### Phase 1 — interfaces and normalized catalog

- Add `ConnectorCredentialProvider` and `ConnectorToolProvider` contracts.
- Implement `ComposioConnectorProvider` behind the contracts.
- Add normalized source/tool catalog models.
- Add fake provider tests for search/describe/call.

### Phase 2 — governed V0 bridge tools

- Wire canonical V0 bridge tools through one facade path.
- Enforce actor/workspace/source ownership.
- Enforce read-only allowlist and deny-by-default policy.
- Add redaction and audit wrappers.

### Phase 3 — product UI/routes

- Integrations panel: connect/status/disconnect/probe.
- Tool catalog panel: show enabled/disabled and reasons.
- No admin classification UI yet unless needed for launch.

### Phase 4 — optional self-custody/BYO path

- Implement SecretStore only for BYO LLM keys or private/provider gaps.
- Prefer Infisical/Vault/KMS where deployment can support it.
- Use embedded encrypted Postgres only as fallback with full security gates.

## Implementation acceptance criteria

V0 is done only when:

```txt
Composio provider spikes documented for Notion/Airtable/Microsoft
canonical bridge tools use one facade path
search returns normalized Composio-backed catalog entries
metadata describe returns schema/safety notes for exact tools
readonly call enforces source ownership + read-only policy before Composio call
unknown/write/admin actions are denied before provider call
redaction tests prove seeded canary values do not reach agent/log/audit outputs
audit tests prove no secret values are recorded
revoke/disconnect invalidates source status and prevents future calls
stable error-code mapping exists for Composio/provider failures
fallback/private SecretStore path remains behind interfaces, not hardcoded into V0
```

## Review status

- Plan review pass 6: RED because the prior plan was append-only and contradictory.
- This rewrite addresses pass 6 by making `plan.md` canonical and moving history to linked research files.
- Next review should verify no active contradiction remains and Composio-first execution is implementable without hard-coding vendor details into business logic.
