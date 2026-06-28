# Generic MCP Onboarding Plan

Issue: #416
Status: draft

## Goal

Create a generic MCP onboarding foundation so boring-ui/Constellation can add MCP servers with minimal custom code.

Target UX:

```txt
Add MCP server
  → choose template or paste URL
  → status/doctor/probe
  → authenticate if needed
  → discover tools/resources
  → classify tools
  → enable safe tools
  → expose trusted agent tools
```

## Scope split

This issue owns the generic contract/foundation. Constellation-specific product PRs can consume it.

### Foundation scope

- provider/server template model;
- central MCP registry shape;
- status/doctor/probe concepts;
- tool catalog and read-only default policy;
- stable MCP error codes;
- redaction/secret leak guard;
- fake-client facade tests.

### Later shippable hosted scope

- hosted OAuth + PKCE;
- encrypted token storage;
- refresh locking;
- production routes/UI;
- real MCP SDK network client;
- metrics/call logs;
- rate limits/circuit breakers;
- governance policy integration.

## Architecture

```txt
MCP registry
  mcp_servers
  mcp_credentials
  mcp_tool_catalog
  mcp_call_logs
        ↓
Hosted MCP facade
        ↓
MCP transport client
        ↓
Provider MCP server
        ↓
Trusted boring-ui/Pi tools
```

The agent must not receive raw provider tokens or raw `.mcp.json` config.

## Provider templates

### Notion

```txt
endpoint: https://mcp.notion.com/mcp
transport: streamable-http
fallback: https://mcp.notion.com/sse
auth: OAuth 2.0 + PKCE
mode: read-only default
```

### Airtable

```txt
endpoint: https://mcp.airtable.com/mcp
transport: streamable-http
auth: OAuth preferred; PAT local-dev only
mode: read-only default
```

Initial Airtable read allowlist candidates:

```txt
ping
list_bases
list_workspaces
list_tables_for_base
list_records_for_table
list_pages_for_base
list_records_for_page
get_record_for_page
get_table_schema
search_records
search_bases
describe_page_element
describe_page_type
```

Deny patterns:

```txt
create_*
update_*
delete_*
publish_*
admin_*
```

Unknown/new provider tools are disabled until classified.

## Generic agent tools

Expose a small generic surface instead of every MCP tool directly:

```ts
mcp_servers_list()
mcp_server_status({ serverId })
mcp_server_doctor({ serverId })
mcp_server_probe({ serverId })
mcp_tools_list({ serverId })
mcp_resources_list({ serverId, cursor? })
mcp_resource_read({ serverId, uri })
mcp_readonly_call({ serverId, toolName, input })
```

## Policy rules

- deny before allow;
- source must belong to actor;
- tool name must match `^[A-Za-z0-9_.:-]{1,128}$`;
- tool must be explicit allowlist member;
- input is schema-validated and size-limited before provider call;
- resource URI is size-limited and provider-prefix validated;
- denied/invalid calls never reach MCP transport.

## Status / doctor / probe

Inspired by OpenClaw:

- `status`: static local state, no provider call;
- `doctor`: local config/token/policy validation, no provider mutation;
- `probe`: live MCP connect and tool/resource discovery.

## Stable error codes

Required codes:

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

## Hosted auth requirements for later PR

Hosted production must not use local Pi OAuth storage as-is.

Required:

- app-owned OAuth start/callback routes;
- PKCE;
- state bound to user/workspace/provider/source/expiry;
- callback wrong-user/source rejection;
- encrypted token references;
- refresh-token locking;
- disconnect/revoke;
- no token writes to `.pi`, workspace files, Pi transcripts, browser responses, or logs.

## Acceptance criteria

- `docs/issues/416/mcp-integration/` contains this plan and review evidence.
- Generic MCP foundation is clearly separated from hosted OAuth/product UI.
- Notion/Airtable templates are documented.
- Read-only default and deny-by-default policy are specified.
- OpenClaw-inspired status/doctor/probe lifecycle is specified.
- pi-mcp-adapter is treated as implementation reference, not raw hosted extension dependency.

## Implementation note

A Constellation-specific internal foundation prototype currently exists on branch `feat/generic-mcp-onboarding` in `hachej/boring-ui-constellation`. This issue pack is the boring-ui #416 tracking home for the generic design.

## Lessons from `pi-mcp-adapter`

Use these as implementation inspiration:

- transport abstraction for stdio, Streamable HTTP, and SSE;
- lazy connection lifecycle so servers do not start/connect until needed;
- idle cleanup for process-local clients;
- one proxy-tool pattern to avoid flooding the model context with every MCP tool;
- metadata/tool discovery cache, but treat cache as advisory and invalidated by provider drift;
- OAuth helper ideas, but do not reuse local Pi filesystem token storage in hosted production.

## Tool classification workflow

V0 classification is manual + conservative:

1. `probe` discovers tools/resources.
2. Tools matching explicit provider allowlist are enabled.
3. Tools matching deny patterns are disabled with reason.
4. Unknown tools are disabled.
5. Admin/reviewer updates checked-in provider template/policy after reviewing tool name, description, schema, provider docs, and sample output.
6. Schema hash/tool-list drift disables affected tools until reclassified.

Heuristics can propose a risk class, but cannot enable tools by themselves.

## Production readiness dependencies

Credential storage is deliberately deferred from this foundation plan, but production readiness requires:

- encrypted credential/token references;
- hosted OAuth callback state + PKCE;
- refresh-token rotation/locking;
- disconnect/revoke;
- redaction guard before logs/tool responses;
- no raw credentials in `.pi`, workspace files, browser responses, prompts, or transcripts.

Rate limits and circuit breakers are also deferred, but the foundation should leave hooks for:

- max local MCP clients per user/workspace/source;
- max concurrent calls per source;
- max input/response sizes;
- provider timeout/retry budget;
- circuit-breaker open/close state;
- metrics keyed by provider/tool/error code.

## Policy matching note

Prefix globs such as `create_*` are only V0 defaults. The policy model should support exact names, simple globs, and provider-specific classification metadata so providers with different naming conventions can still be handled safely.

## Foundation interfaces to preserve

### Redaction guard

Foundation should define a response/log redaction boundary even before real transports ship:

```ts
interface McpRedactionGuard {
  redact(value: unknown): unknown;
  assertSafeForAgent(value: unknown): void;
  assertSafeForLog(value: unknown): void;
}
```

Rules:

- transport responses pass through `assertSafeForAgent` before returning to tools;
- logs pass through `redact` before persistence/output;
- redaction failures return stable `MCP_SECRET_LEAK_GUARD`;
- tests use token-like strings under both sensitive and non-sensitive keys.

### Credential reference provider

Foundation should depend on opaque credential references, not raw tokens:

```ts
interface McpCredentialProvider {
  resolveCredentialRef(actor, source): Promise<McpResolvedCredential>;
  refreshIfNeeded(actor, source): Promise<McpResolvedCredential>;
}
```

V0 foundation may use a fake implementation. Production implementation belongs to hosted OAuth work and must use encrypted storage.

### Policy classifier

Classification metadata lives in provider templates or checked-in provider registry artifacts:

```ts
interface McpToolClassification {
  toolName: string;
  risk: 'read' | 'write' | 'admin' | 'unknown';
  enabledByDefault: boolean;
  reason: string;
  schemaHash?: string;
}
```

Tests must cover:

- exact allowlist enables known read tool;
- deny pattern disables mutating tool;
- unknown tool disabled;
- schema hash/tool-list drift disables affected tools;
- manual provider template update changes classification deterministically.

### Rate-limit and breaker hooks

Foundation should leave a simple hook, even if fake/noop in the first implementation:

```ts
interface McpExecutionGuard {
  beforeCall(actor, source, toolName): Promise<void>;
  afterCall(actor, source, result): Promise<void>;
  afterFailure(actor, source, error): Promise<void>;
}
```

Production can implement quotas, circuit breakers, timeout budgets, and metrics behind this interface.

### Tool-name validation extensibility

The default tool-name regex is conservative for V0. Provider templates may later override validation, but unknown/special-character tool names remain disabled until explicitly reviewed.

### Admin classification UI

No admin classification UI in the foundation. Classification is a checked-in code/config workflow until a later product UI exists.

## Provider metadata storage and validation overrides

Provider-specific classification metadata lives in one place: the provider template registry.

```ts
interface McpProviderTemplate {
  id: string;
  endpoint: string;
  transport: 'streamable-http' | 'sse' | 'stdio';
  toolClassifications: Record<string, McpToolClassification>;
  denyPatterns: string[];
  allowedResourceUriPrefixes?: string[];
  toolNamePattern?: RegExp;
}
```

Rules:

- `toolClassifications` exact-name entries are the only way to enable a tool by default;
- `denyPatterns` are checked before exact allow entries;
- if `toolNamePattern` is absent, use the conservative default `^[A-Za-z0-9_.:-]{1,128}$`;
- if a provider overrides `toolNamePattern`, tests must prove special-character tools remain denied until exact classification exists;
- checked-in docs/provider artifacts should mirror this registry shape for reviewability.

## Drift, credential, and resource defaults

### Drift detection

`MCP_PROVIDER_TOOL_DRIFT` applies when any checked-in classification no longer matches live probe output:

- allowed tool is missing from live `tools/list`;
- live tool exists with changed input schema hash;
- live tool exists with changed output schema hash when available;
- new live tool appears without exact checked-in classification;
- previously denied tool changes schema/description enough that reviewed classification may be stale.

Default response: disable affected tool/server capability until classification is reviewed.

### Resolved credential shape

```ts
interface McpResolvedCredential {
  accessToken: string;
  expiresAt: number;
  refreshToken?: string;
  tokenType?: 'Bearer';
  scopes?: string[];
}
```

Fake implementations may use sentinel values. Production implementations must source this from encrypted storage only.

### Resource URI prefix defaults

If `allowedResourceUriPrefixes` is absent, resource reads are denied by default. Providers must explicitly opt in to readable URI prefixes or implement a provider-specific resource validator. No fallback to endpoint origin is allowed for V0.
