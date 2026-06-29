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

## Canonical V0 agent tools

This is the single canonical V0 agent tool surface. Older `mcp_tools_list`-only sketches are superseded; V0 requires search + describe so the agent can discover a tool and fetch its exact schema before calling it.

```ts
mcp_servers_list({ cursor?, limit? })
mcp_server_status({ serverId })
mcp_server_doctor({ serverId })
mcp_server_probe({ serverId })
mcp_tools_search({ query, serverId?, cursor?, limit?, enabledOnly? })
mcp_tool_describe({ serverId, toolName })
mcp_readonly_call({ serverId, toolName, input })
```

Resource tools are not part of the default V0 launch surface unless a provider declares explicit URI validators/prefixes:

```ts
mcp_resources_list({ serverId, cursor?, limit? })
mcp_resource_read({ serverId, uri })
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

Documentation acceptance:

- `docs/issues/416/mcp-integration/` contains this plan and review evidence.
- Generic MCP foundation is clearly separated from hosted OAuth/product UI.
- Notion/Airtable templates are documented.
- Read-only default and deny-by-default policy are specified.
- OpenClaw-inspired status/doctor/probe lifecycle is specified.
- pi-mcp-adapter is treated as implementation reference, not raw hosted extension dependency.

Implementation acceptance for the first foundation PR:

- canonical V0 bridge tools are wired through one facade path;
- fake/stub transport test proves one read-only call resolves through search/describe/call;
- redaction tests prove exact seeded secret values are removed even under non-sensitive keys;
- policy tests cover exact allow, deny pattern, unknown tool, MCP annotation input, and disabled write/admin cases;
- drift tests cover removed tool, new unclassified tool, schema hash mismatch, and stale classification TTL;
- CLI config trust test proves agent-writable MCP config cannot enable stdio execution;
- hosted credential test proves refresh/revoke invalidates cached clients.

## Implementation note

A Constellation-specific internal foundation prototype currently exists on branch `feat/generic-mcp-onboarding` in `hachej/boring-ui-constellation`. This issue pack is the boring-ui #416 tracking home and source of truth for the generic `boring-mcp` contract. Before extracting shared code into a boring-ui package/plugin, the implementer must reconcile that prototype against this plan; on conflict, this plan governs the generic contract and Constellation-specific code must adapt or remain app-local.

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
6. Schema/tool-list drift updates the affected tool state according to the severity rules below.

MCP-native signals such as tool annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`) are classification inputs, but never sufficient by themselves to enable a tool. Heuristics and annotations can propose a risk class; exact checked-in or admin classification is still required. `notifications/tools/list_changed` is a trigger to re-probe or mark the cached catalog stale.

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
interface McpRedactionContext {
  credential?: McpResolvedCredential;
  sensitiveValues: string[];
  sensitiveKeys: string[];
}

interface McpRedactionGuard {
  redact(value: unknown, context: McpRedactionContext): unknown;
  assertSafeForAgent(value: unknown, context: McpRedactionContext): void;
  assertSafeForLog(value: unknown, context: McpRedactionContext): void;
}
```

Rules:

- transport responses pass through `assertSafeForAgent` before returning to tools;
- logs pass through `redact` before persistence/output;
- exact resolved tokens/secrets must be seeded into `sensitiveValues`;
- exact seeded secret matches hard-fail or redact according to output target;
- regex-only fallback matches are redacted-and-flagged, not hard-failed, to avoid blocking legitimate user data;
- redaction failures return stable `MCP_SECRET_LEAK_GUARD`;
- tests use exact secret values under both sensitive and non-sensitive keys.

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
  schemaHash?: string; // computed from canonical JSON schema form
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
  };
}
```

Tests must cover:

- exact allowlist enables known read tool;
- deny pattern disables mutating tool;
- unknown tool disabled;
- schema hash/tool-list drift disables affected tools;
- manual provider template update changes classification deterministically.

### Rate-limit and breaker hooks

Foundation should keep this hook minimal and fake/noop in the first implementation. Do not build full quota/breaker infrastructure before one real or stubbed read-only MCP call works end-to-end:

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
  toolNamePattern?: { source: string; flags?: string };
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
- live tool exists with changed canonical input schema hash;
- live tool exists with changed canonical output schema hash when available;
- new live tool appears without exact checked-in classification;
- previously denied tool changes schema/description enough that reviewed classification may be stale.

Schema hashes are computed from a canonical JSON representation: stable key ordering, no whitespace sensitivity, normalized `$ref` expansion where supported, and provider/version included in the hash domain.

Default V0 response: disable affected tool capability on any hash mismatch unless a compatibility checker is fully implemented and covered by tests. Compatibility-based keep-enabled behavior is a later optimization, not required for V0.

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

## Tool exposure roadmap

### V0 — generic proxy tools

V0 uses the canonical tool surface defined above. The minimum always-present call path is:

```ts
mcp_tools_search({ query, serverId?, cursor?, limit?, enabledOnly? })
mcp_tool_describe({ serverId, toolName })
mcp_readonly_call({ serverId, toolName, input })
```

Status/doctor/probe/server listing tools are also part of V0. Resource tools remain optional unless a provider opts into explicit URI validation. This minimizes context bloat and keeps all authorization/tool-policy/audit checks in one path.

### V1 — Hermes-style progressive disclosure

Add a tool-search layer inspired by Hermes:

- the model sees only search/describe/call bridge tools by default;
- `mcp_tools_search` searches enabled/classified MCP tools across connected servers;
- `mcp_tool_describe` returns the exact schema and safety notes for one tool;
- `mcp_readonly_call` executes only after policy validation;
- schema/tool catalog drift disables stale entries.

This gives broad MCP coverage without putting every MCP schema into every prompt.

### V2 — OpenClaw/Hermes-style materialized tools

For high-confidence enabled tools, optionally materialize direct agent tools:

```txt
mcp_airtable_search_records
mcp_airtable_list_bases
mcp_notion_fetch
```

Rules:

- generated/materialized tools still route internally through the same MCP facade;
- direct tools are sugar over `mcp_readonly_call`, not a bypass;
- only exact classified tools can materialize;
- direct tools inherit the same source ownership, credential, redaction, audit, and policy checks;
- if schema hash drifts, the direct tool is disabled until reclassified.

## Plugin/package shape decision

This should be split into two layers:

### 1. Reusable MCP server package/module

Owns the generic backend mechanics:

- provider template registry;
- transport client abstraction;
- tool classification;
- status/doctor/probe;
- redaction guard;
- credential provider interface;
- execution guard interface;
- facade and tests.

This should not depend on app UI. It can become a boring-ui package or app/server module first, then be extracted if reused.

### 2. App/internal trusted plugin

The product integration should be an **app/internal trusted plugin**, not a runtime `.pi/extensions` plugin, because it needs:

- trusted server routes;
- OAuth callback routes;
- encrypted token access;
- server-side MCP calls;
- audit/log persistence;
- stable agent tool registration;
- admin/user UI panels.

Plugin surfaces:

- server: trusted routes/tools for MCP registry, status/doctor/probe, search/describe/call;
- front: Integrations/MCP panel for connect/configure/probe/tool catalog;
- agent tools: V0 bridge tools, later V2 materialized tools.

Runtime/generated plugins may still consume MCP later, but hosted Constellation production should not rely on runtime `.pi/extensions` for provider credentials or MCP OAuth.

## Tool-search and materialization details

### V1 search/describe contract

```ts
interface McpToolsSearchRequest {
  query: string;
  serverId?: string;
  risk?: 'read' | 'write' | 'admin' | 'unknown';
  enabledOnly?: boolean;
  cursor?: string;
  limit?: number;
}

interface McpToolsSearchResult {
  serverId: string;
  toolName: string;
  title?: string;
  summary: string;
  risk: 'read' | 'write' | 'admin' | 'unknown';
  enabled: boolean;
  reason: string;
  schemaHash?: string;
}
```

Search uses the cached checked-in/probed tool catalog, not live provider calls. It returns summaries/classification only, not full schemas. `mcp_tool_describe` returns the full schema for one exact enabled/classified tool. Cached catalogs have a freshness TTL; stale catalogs either trigger re-probe or mark tools unavailable until probe refresh completes.

### V2 materialization trigger

V2 is a roadmap note, not a first-foundation-PR requirement. The first foundation PR should not implement materialized tools unless the V0 facade and one real/stub read-only path are already green.

A tool can become a direct/materialized tool only when all are true:

- exact checked-in classification exists;
- `enabledByDefault: true` or admin explicitly enabled it;
- schema hash matches latest probe;
- tool is read-only for V0/V1 read-only profiles;
- provider template marks it `materialize: true` or admin toggles materialization;
- generated tool name is stable and collision-free.

No automatic materialization based only on usage count. Usage metrics can suggest candidates, but a checked-in/admin decision is required.

Materialized tools are registered by the trusted app/internal plugin at server boot or controlled reload. They are additive sugar over `mcp_readonly_call` and can be removed/disabled if drift is detected.

### Minimal trusted route surface

Expected trusted routes for the app/internal plugin:

```txt
GET  /api/mcp/servers
POST /api/mcp/servers
GET  /api/mcp/servers/:serverId/status
POST /api/mcp/servers/:serverId/doctor
POST /api/mcp/servers/:serverId/probe
GET  /api/mcp/servers/:serverId/tools
POST /api/mcp/servers/:serverId/tools/:toolName/enable
POST /api/mcp/servers/:serverId/tools/:toolName/disable
POST /api/mcp/auth/:provider/start
GET  /api/mcp/auth/:provider/callback
POST /api/mcp/servers/:serverId/logout
```

Route names can be adjusted during implementation, but these operations define the intended scope.

### V0 to V1 migration

V1 is additive. Existing V0 `mcp_readonly_call` remains stable. V1 adds search/describe backed by the same catalog and policy model. V2 direct tools are optional and can be disabled without removing V0/V1 bridge tools.

## Operating modes

`boring-mcp` must support two operating modes because CLI/local projects and hosted full apps have different trust/auth boundaries.

### Mode A — user-managed MCP / CLI mode

Use when:

- local CLI / personal project;
- user owns the machine and config;
- user wants to add arbitrary MCP servers quickly;
- credentials can live in user-local secure storage or local config conventions.

Behavior:

```txt
user adds MCP server
  → user handles auth/config
  → boring-mcp probes tools
  → tools are searchable
  → safe/classified tools can materialize
```

Config sources may include user/global MCP config or explicitly approved project MCP config such as `.mcp.json`, `.pi/mcp.json`, or boring-mcp-specific config. Config discovery and writability checks must go through the Workspace/adapter contract; no tool route should directly trust raw filesystem paths.

Rules:

- user-managed mode can support arbitrary stdio/http/sse MCP servers;
- user is responsible for trusting local stdio commands, but adding/enabling stdio requires explicit user action outside autonomous agent edits;
- default policy still disables unknown/write/admin tools until enabled;
- credentials must not be committed accidentally; doctor should warn on literal sensitive headers/env values;
- materialized tools are project/session-scoped.

### Mode B — app-predefined MCP / hosted full-app mode

Use when:

- production/full app;
- app owner predefines supported providers/tools;
- OAuth and credentials are host-managed;
- multiple users/workspaces share app infrastructure.

Behavior:

```txt
app ships MCP templates/policies
  → user connects approved provider account
  → boring-mcp uses encrypted server-side credentials
  → only app-approved tools are searchable/materialized
```

Rules:

- app defines provider templates, endpoints, allowed transports, and tool policies;
- user cannot add arbitrary stdio commands unless app explicitly enables it;
- hosted OAuth callback/token storage is app-owned;
- credentials are encrypted and never stored in project files or Pi session files;
- materialized tools are generated only for app-approved, classified tools;
- app governance can further restrict user/server/tool access.

### Shared concepts across both modes

Both modes use the same core facade concepts:

- MCP server/source registry;
- status/doctor/probe;
- tool catalog;
- read-only default classification;
- tool search/describe/call;
- optional materialized tools;
- redaction guard;
- stable error codes.

The difference is **who owns config/auth**:

| Concern | User-managed / CLI | App-predefined / full app |
| --- | --- | --- |
| Server definitions | user/global or explicitly approved project config | app templates/database |
| Auth | user/local MCP auth or local secret store | hosted OAuth/encrypted app secret store |
| Arbitrary MCP servers | allowed by default with warnings | denied unless app enables |
| Stdio commands | allowed locally with trust warning | usually disabled |
| Tool policy | user/admin local policy | app policy + future governance |
| Materialization | project/session scoped under a synthetic local actor | app/workspace/user scoped |

### Implementation implication

`boring-mcp` should separate:

```txt
core MCP facade/package
  mode-neutral registry, policy, probe, search, materialization

mode adapters
  cliLocalMcpConfigAdapter
  hostedAppMcpConfigAdapter
  hostedOAuthCredentialProvider
  localCredentialProvider
```

Do not bake hosted assumptions into the generic core, and do not let CLI/local config semantics leak into hosted production. CLI mode still has an actor: a synthetic local actor derived from the local user/profile and project identity, used only for ownership checks, cache keys, and audit labels.

## Gemini review amendments

### Redaction guard must know concrete secret values

Do not rely on generic token-looking regexes alone. The redaction guard must be seeded per call with the resolved credential material and other sensitive values known to the request.

```ts
interface McpRedactionContext {
  credential?: McpResolvedCredential;
  sensitiveValues: string[];
  sensitiveKeys: string[];
}

interface McpRedactionGuard {
  redact(value: unknown, context: McpRedactionContext): unknown;
  assertSafeForAgent(value: unknown, context: McpRedactionContext): void;
  assertSafeForLog(value: unknown, context: McpRedactionContext): void;
}
```

Rules:

- resolved access/refresh tokens, auth codes, dynamic client secrets, and request authorization headers are added to `sensitiveValues`;
- regex detection is only a fallback;
- tests must prove a token under a non-sensitive key is still removed when present in `sensitiveValues`.

### Drift handling is severity-based

`MCP_PROVIDER_TOOL_DRIFT` does not always hard-disable the whole server. Drift is classified:

- **breaking drift**: required input added, input type changed incompatibly, tool removed, tool renamed, output shape no longer parseable for materialized/direct tool assumptions → disable affected tool;
- **review drift**: description changed, optional input added, output schema added/expanded, denied tool changed description/schema → keep denied tools denied; for V0, hash mismatch disables affected allowed tools unless a tested compatibility checker says otherwise;
- **new tool drift**: new live tool without exact classification → disabled until classified.

Materialized V2 tools are stricter: any schema hash mismatch disables the direct tool until reclassified, while the bridge may remain available if compatibility check passes.

### CLI/user-managed config must be outside agent-writable paths

Mode A must not let the agent mutate MCP config and then execute arbitrary stdio commands on the user's machine.

Rules:

- user/global MCP config lives outside the agent-writable workspace by default;
- project-local MCP config is read-only to the agent unless the user explicitly grants edit rights;
- `doctor` warns if MCP config file is inside an agent-writable directory;
- adding/enabling stdio MCP servers requires an explicit user action outside autonomous agent edits;
- runtime agents cannot silently add stdio servers by writing `.mcp.json` and triggering reload;
- hosted Mode B disables arbitrary stdio by default.

### V0 tool interface includes describe and pagination

V0 bridge tools are:

```ts
mcp_servers_list({ cursor?, limit? })
mcp_server_status({ serverId })
mcp_server_doctor({ serverId })
mcp_server_probe({ serverId })
mcp_tools_search({ query, serverId?, cursor?, limit?, enabledOnly? })
mcp_tool_describe({ serverId, toolName })
mcp_readonly_call({ serverId, toolName, input })
```

Optional resource tools require a provider-declared URI validator/prefix and are not part of the default launch surface:

```ts
mcp_resources_list({ serverId, cursor?, limit? })
mcp_resource_read({ serverId, uri })
```

`mcp_tool_describe` is required in V0 so the agent can fetch the exact JSON schema before calling `mcp_readonly_call`. `mcp_tools_list` is deprecated in the plan in favor of paginated search/describe.

### Resource URI validation is provider and mode aware

Resource validation is not origin-based. It is provider-template based:

- providers must declare allowed URI schemes/prefixes or a validator;
- absent validator/prefix means resource reads denied;
- `file://` and host-local paths are denied in hosted Mode B unless an app-defined provider explicitly owns them;
- CLI Mode A may allow local filesystem MCP resources only when the MCP server config was user-approved and outside agent write control.

### Transport connection lifecycle guard

Connection lifecycle is required only when the implementation keeps reusable clients. A first stub/fake transport may implement this as no-op create/release. Real hosted transports must use the manager contract before production:

Execution guards wrap calls, but connection lifecycle needs its own manager contract:

```ts
interface McpConnectionManager {
  getOrCreateClient(actor, source): Promise<McpTransportClient>;
  releaseClient(actor, source): Promise<void>;
  closeSource(sourceId): Promise<void>;
  closeIdle(now: number): Promise<void>;
}
```

Hosted Mode B requirements:

- cache key includes app/workspace/user/source/provider/config version and credential version/expiry bucket;
- max active clients per user/workspace/source;
- max concurrent connects;
- idle TTL;
- SSE clients are process-local and disposable;
- no assumption of sticky sessions;
- credential refresh closes/rebuilds clients carrying the old access token before reuse;
- disconnect/revoke invalidates source of truth and must purge all locally known clients for that source/user before returning success. In distributed deployments this also emits an invalidation event; local close remains best-effort only for processes that miss the event.

## Nango self-host credential-provider candidate

See [`nango-selfhost-poc.md`](./nango-selfhost-poc.md) for the local smoke.

Nango self-host is a candidate for hosted/full-app provider credential lifecycle, especially for Constellation, but only behind the generic credential-provider seam.

```ts
interface NangoCredentialRef {
  provider: 'nango';
  providerConfigKey: string;
  connectionId: string;
}
```

Rules:

- `boring-mcp` core must not depend directly on Nango.
- Constellation may provide a `NangoMcpCredentialProvider` adapter.
- Store Nango `providerConfigKey` + `connectionId` as credential references; do not store raw provider tokens in Constellation source records.
- Free self-hosted Nango appears to support Auth + Proxy, but not Nango MCP server, functions, webhooks, full observability, custom branding, or RBAC.
- If selected, Constellation should use Nango for OAuth/token storage/refresh and `boring-mcp` for source ownership, policy, search/describe/call, materialization, redaction, and audit.
- If Nango free self-host feature limits are insufficient, fall back to a narrow Constellation-owned token broker for the first providers.

Open verification before adoption:

- create a local self-host integration;
- create an API key/session token;
- complete one OAuth or API-key connection;
- verify `getConnection(providerConfigKey, connectionId)` returns/refreshes credentials;
- verify Proxy can call a harmless endpoint;
- verify encrypted-at-rest behavior with `NANGO_ENCRYPTION_KEY` set.

## Nango real spike outcome

See [`nango-real-spike.md`](./nango-real-spike.md).

The isolated real spike proved more than the initial smoke:

- self-hosted Nango backend API works locally after recovering/using a local API key;
- `private-api-generic` integration creation works;
- API-key connections can be imported or created through Connect UI;
- connection credentials are encrypted at rest when `NANGO_ENCRYPTION_KEY` is set;
- Nango Proxy can inject stored credentials server-side into an upstream request;
- Connect UI works in self-host, but the link needed an explicit `apiURL=http://localhost:3003` query param in the local setup;
- free self-host Connect UI is Nango/default-branded enough that client-facing Constellation may need a wrapper or custom provider buttons.

This makes Nango a stronger candidate for Constellation if future integration velocity matters. However, adoption is still gated on a real OAuth provider spike:

- Notion OAuth or MCP auth;
- Airtable OAuth/PAT path;
- Microsoft/SharePoint OAuth with refresh/revoke;
- provider domain allowlist outbound policy;
- disconnect/revoke behavior;
- no raw token leakage in logs or agent responses.

Decision rule:

```txt
If Notion/Airtable/Microsoft OAuth refresh/revoke works cleanly in free self-host, use Nango as the hosted Constellation credential provider behind `McpCredentialProvider`.
If free self-host limits or provider quirks block us, build a narrow Constellation token broker for the first providers and keep Nango as a future adapter.
```

## Nango target-provider support check

See [`nango-provider-support.md`](./nango-provider-support.md).

Nango's provider registry/docs include all three Constellation target families:

- Airtable:
  - `airtable` — OAuth2, proxy base `https://api.airtable.com`;
  - `airtable-pat` — API key/PAT fallback.
- Notion:
  - `notion` — OAuth2, proxy base `https://api.notion.com`, includes `notion-version` header;
  - `notion-mcp` — `MCP_OAUTH2`, dynamic client registration, Notion MCP endpoints;
  - `notion-scim` — API-key admin/SCIM path.
- Microsoft / SharePoint:
  - `microsoft` — OAuth2 Graph, `offline_access`, refresh token support;
  - `microsoft-tenant-specific` — tenant-bound OAuth2 Graph;
  - `microsoft-oauth2-cc` — client credentials Graph;
  - `sharepoint-online` — SharePoint Online v2 / Graph family;
  - `sharepoint-online-oauth2-cc` — SharePoint app-only/client credentials;
  - `sharepoint-online-v1` — legacy SharePoint REST two-step/client assertion.

This means Nango is viable at the registry/docs level for Constellation's first provider set. Still required before adoption: real OAuth spikes for Notion/Airtable/Microsoft, with refresh/revoke, scopes, Connect UI wording, and production outbound allowlist verified.

## Nango `notion-mcp` spike result

See [`nango-notion-mcp-spike.md`](./nango-notion-mcp-spike.md).

Result: not green yet.

Free self-host Nango could create a `notion-mcp` integration record and render Connect UI, but the backend/public API path did not perform MCP dynamic client registration. Clicking Connect failed before Notion login/consent:

```txt
Provider Config "constellation-notion-mcp-test" is missing client ID, secret and/or scopes.
```

DB inspection showed the created provider config had no `oauth_client_id`, `oauth_client_secret`, or `oauth_scopes`. Nango source indicates dynamic client registration exists in the private/dashboard v1 integration creation path, not the simple public `/integrations` path used in the spike.

A direct call to `https://mcp.notion.com/register` from the sandbox returned HTTP 403 / Cloudflare code 1010, so direct registration could not be proven from this environment.

Implication:

- Do not assume Nango free self-host supports Notion MCP OAuth out of the box via backend API.
- Regular Nango `notion` OAuth remains viable for V0 Notion REST/API access.
- `notion-mcp` remains experimental until dashboard/private creation or direct dynamic registration is proven.
- Julien's Notion account is only needed after a working Notion authorization URL is produced; this spike failed earlier.

## pi-mcp-adapter Notion MCP auth spike

See [`pi-mcp-adapter-notion-auth-spike.md`](./pi-mcp-adapter-notion-auth-spike.md).

Result: promising but not fully complete in this sandbox.

`pi-mcp-adapter` / MCP SDK OAuth successfully generated a Notion MCP authorization URL for `https://mcp.notion.com/mcp` using dynamic client registration and PKCE. Julien opened it and Notion returned an authorization code. This proves the adapter path gets farther than Nango free self-host `notion-mcp`, which failed before Notion login.

The helper process timed out before the code was pasted, so the in-memory pending transport was gone. A direct token exchange using the stored client id, redirect URI, and PKCE verifier then failed with Cloudflare 1010 / `browser_signature_banned` from `https://mcp.notion.com/token`.

Implication:

- A `pi-mcp-adapter`-style MCP OAuth core plus DB-backed credential store is a good building block for hosted `boring-mcp`.
- Hosted Constellation must verify Notion MCP registration/token exchange from the real deployment environment.
- If Notion MCP token exchange is blocked by runtime egress, use regular Notion OAuth/API for V0 and keep MCP-native Notion experimental.

## MCP-native auth direction after Notion spikes

For MCP-native providers, especially Notion MCP, prefer a `pi-mcp-adapter` / MCP SDK derived OAuth core with Constellation-owned encrypted DB storage.

Rationale:

- `pi-mcp-adapter` successfully produced a Notion MCP authorization URL using dynamic client registration + PKCE.
- Nango free self-host `notion-mcp` did not reach Notion OAuth through the public backend API path because dynamic registration/client fields were missing.
- The MCP SDK auth shape matches MCP-native provider expectations better than treating MCP OAuth as a generic SaaS connector.
- Hosted Constellation still needs DB-backed, multi-tenant, audited credential storage instead of Pi's local `tokens.json` files.

### Layering

```txt
boring-mcp
  mcp-oauth-core
    endpoint discovery
    dynamic client registration
    PKCE
    auth URL generation
    callback/code exchange
    refresh
    credential-store interface

  credential stores
    local-file store for CLI/user-managed mode
    encrypted DB store for hosted/full-app mode

  facade/catalog
    tools/list probe
    schema hash and drift
    read/write/admin classification
    mcp_tools_search
    mcp_tool_describe
    mcp_readonly_call
    optional materialized tools
```

### Store interface

```ts
interface McpOAuthStore {
  get(actor: McpActor, source: McpSourceRef): Promise<AuthEntry | null>;
  save(actor: McpActor, source: McpSourceRef, entry: AuthEntry): Promise<void>;
  updateTokens(actor: McpActor, source: McpSourceRef, tokens: StoredTokens): Promise<void>;
  updateClientInfo(actor: McpActor, source: McpSourceRef, clientInfo: StoredClientInfo): Promise<void>;
  updatePendingState(actor: McpActor, source: McpSourceRef, pending: PendingOAuthState): Promise<void>;
  clear(actor: McpActor, source: McpSourceRef): Promise<void>;
}
```

Hosted DB rows should include:

```txt
workspaceId
userId / actorId
sourceId
serverUrl
encrypted tokens
encrypted client info
encrypted PKCE/state while pending
expiresAt
scopes
revokedAt
createdAt / updatedAt
```

### Hosted auth flow

Do not keep hosted auth completion dependent on one long-lived in-memory Pi process.

Use HTTP routes:

```txt
POST /api/mcp/sources/:sourceId/auth/start
  -> create pending auth row
  -> generate MCP OAuth authorization URL
  -> return URL to browser

GET /api/mcp/oauth/callback
  -> validate state/source/actor
  -> exchange code
  -> store encrypted tokens/client info
  -> mark source connected
```

Manual/headless auth can still exist for CLI mode, but hosted Constellation should use normal callback routes.

### Tool search/materialization compatibility

This auth direction does not change the planned tool exposure model.

Once a valid token exists, the boring-mcp facade can:

```txt
connect MCP client with stored token
call tools/list
cache tool schemas
classify read/write/admin
serve mcp_tools_search
serve mcp_tool_describe
serve mcp_readonly_call
optionally register materialized tools
```

Materialized tools remain sugar over the same guarded call path:

```txt
mcp_notion_fetch -> mcp_readonly_call({ serverId, toolName, input })
```

### Provider strategy

Use the right credential adapter by provider shape:

| Provider shape | Preferred V0 credential path |
| --- | --- |
| MCP-native OAuth provider, e.g. Notion MCP | MCP SDK / pi-mcp-adapter-derived OAuth core + encrypted DB store |
| Normal SaaS REST OAuth, e.g. regular Notion API, Airtable REST, Microsoft Graph | Better Auth if sufficient, otherwise narrow Constellation token broker; Nango remains an optional future adapter |
| API-key/PAT provider | encrypted Constellation secret ref or Nango Auth+Proxy if integration velocity justifies it |
| CLI/user-managed MCP | local file store, explicit user-owned config, no hosted token storage |

### Required proof before production

- Notion MCP token exchange must succeed from the actual hosted deployment environment; this sandbox hit Cloudflare 1010 on direct token exchange.
- DB-backed store must pass tests for token encryption, refresh, revoke, ownership, and redaction.
- `tools/list` probe must work with the stored token.
- Search/describe/call must run through the same policy/audit/redaction path.

## Better Auth credential-store research

See [`better-auth-mcp-research.md`](./better-auth-mcp-research.md).

Findings:

- Better Auth's MCP plugin is mainly for **inbound** MCP auth: making Constellation act as an OAuth provider for MCP clients. It does not directly solve outbound third-party MCP provider auth like Notion MCP.
- Better Auth account records can store OAuth access/refresh tokens for linked provider accounts.
- Better Auth token encryption exists but is opt-in via `account.encryptOAuthTokens: true`; Constellation should enable it for any Better Auth-owned provider tokens.
- Better Auth `getAccessToken` can refresh supported provider tokens, but Generic OAuth has known edge cases around provider-specific refresh/resource params and refresh metadata.

Credential-store policy:

| Flow | Store |
| --- | --- |
| Regular OAuth provider supported cleanly by Better Auth | Better Auth account table with token encryption enabled |
| Generic OAuth provider with simple refresh | Better Auth Generic OAuth only after provider-specific spike |
| MCP-native OAuth, e.g. Notion MCP | boring-mcp encrypted DB store + MCP SDK/pi-mcp-adapter-derived auth core |
| Provider needing special refresh/resource params | narrow Constellation credential store or Nango adapter |
| Constellation exposing its own MCP server | Better Auth MCP plugin may be useful for inbound client auth |

Keep `McpCredentialProvider` pluggable: `better-auth-account`, `mcp-db`, `nango`, and `local-file`.

## Constellation credential vault direction

Constellation likely needs a narrow app-owned credential vault, not only for MCP provider credentials but also for future Bring Your Own LLM provider tokens.

Examples:

```txt
MCP provider credentials
  Notion MCP OAuth tokens
  Airtable OAuth/PAT tokens
  Microsoft/SharePoint OAuth tokens

BYO model provider credentials
  OpenAI API key
  Anthropic API key
  OpenRouter API key
  Gemini API key
  provider-specific base URL / organization / project metadata
```

This should be a small, audited capability rather than a generic secrets product.

### Credential vault requirements

```txt
encrypted-at-rest secret material
workspace/user/source ownership keys
purpose-specific credential types
no raw-token read API for agents/browser
server-side resolution only at execution boundary
redaction guard on all errors/logs/results
refresh/revoke/disconnect lifecycle where applicable
connection/client cache invalidation on revoke or rotation
audit events without secret values
tests with seeded canary secrets
```

### Suggested model

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
  encryptedPayload: string;
  payloadSchemaVersion: number;
  status: "pending" | "active" | "revoked" | "error";
  expiresAt?: Date;
  rotatedAt?: Date;
  revokedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
```

For credentials Better Auth can safely own, `boring-mcp` / Constellation stores only a reference:

```txt
kind=oauth-account-ref
providerId=<provider>
credentialRef=<better auth account id>
```

For MCP-native and BYO LLM credentials, Constellation owns encrypted storage directly.

### Execution boundary

Callers should never receive raw secret material. Instead they request a server-side operation:

```txt
mcp_readonly_call -> credential resolver -> MCP client -> provider
llm_completion    -> credential resolver -> model client -> provider
```

The resolver returns secret material only to trusted server-side adapters, never to:

```txt
browser responses
agent prompts
workspace files
logs
audit event payloads
```

### BYO LLM implications

BYO provider tokens need the same controls as MCP credentials:

```txt
per-workspace/provider credential records
provider-specific validation/probe
model allowlist and budget policy
rate/token accounting
rotation/revoke
redacted errors
no credential export by default
```

The model runtime should receive a resolved provider client, not a raw API key. This mirrors the MCP facade rule: tools call a governed server adapter, not arbitrary token-bearing HTTP clients.

### Product boundary

The credential vault is an internal Constellation platform capability used by:

```txt
boring-mcp
BYO LLM provider configuration
future governed integrations
```

It should not become a user-facing generic password manager or arbitrary secret filesystem.

## Selected credential vault implementation direction

See [`credential-vault-research.md`](./credential-vault-research.md).

Decision: implement a narrow embedded Constellation SecretStore V0 backed by Postgres encrypted payload rows.

This is selected over adopting an external vault product for V0 because Constellation needs app-native ownership, source joins, refresh locks, policy/audit integration, and server-side execution boundaries for MCP and BYO LLM credentials.

Use off-the-shelf projects as references/backends, not immediate V0 dependencies:

| Option | Role |
| --- | --- |
| Cred Ninja (`@credninja/oauth`, `@credninja/vault`, `@credninja/guard`) | closest reference for agent credential delegation and OAuth vault patterns |
| API Locker | reference for LLM/API/OAuth vault UX, proxy injection, MCP surface, audit/rotation |
| Infisical | optional future backend/secret manager/KMS-style dependency |
| Vault/OpenBao/cloud KMS | optional future envelope-key backend for enterprise deployments |

V0 SecretStore requirements:

```txt
Postgres metadata + encrypted payload rows
AES-256-GCM or XChaCha20-Poly1305
unique nonce/IV per encryption
versioned payload envelope
key id/version column
future key rotation path
server-only resolve API
no raw-token browser/agent/tool API
redaction guard for logs/errors/audit/tool results
workspace/actor/source ownership checks
revoke/rotate cache invalidation
per-credential refresh lock for OAuth
short-lived encrypted pending OAuth state / PKCE rows
seeded canary-secret tests
```

Initial consumers:

```txt
boring-mcp external provider credentials
BYO LLM provider tokens
```

Better Auth remains the identity/session/org layer and can own regular OAuth account tokens only where provider-specific spikes prove it handles refresh safely with `account.encryptOAuthTokens: true`.

For MCP-native OAuth and BYO LLM credentials, Constellation owns encrypted storage directly through the embedded SecretStore.

## Final embedded vault candidate: agent.pw

Final research found `agent.pw` as the strongest candidate to reduce custom SecretStore code.

See [`credential-vault-research.md`](./credential-vault-research.md#final-embeddable-library-pass).

Decision refinement:

```txt
Run agent.pw spike before implementing custom EncryptedPostgresSecretStore.
```

Reasons:

```txt
embeddable TypeScript
Postgres-compatible
AES-GCM encrypted credentials
OAuth PKCE / refresh / revocation
RFC 9728 discovery
manual header/API-key credentials
path-scoped rights
refresh-aware resolveHeaders
FlowStore abstraction
```

Hard gates before adoption:

```txt
license acceptable for Constellation
schema/migrations compatible with boring-ui Postgres/Drizzle conventions
production FlowStore not in-memory
MCP-native Notion/Airtable OAuth discovery/dynamic registration works or can be extended
refresh locking safe under concurrency
Constellation can enforce no raw-token API, redaction, audit, ownership, revoke/cache invalidation around it
key version / rotation story is acceptable or can be wrapped
```

If `agent.pw` passes, wrap it as the first implementation behind Constellation's credential resolver. If it fails, proceed with custom embedded SecretStore and borrow its path/resource/resolveHeaders model.

## Credential vault dependency preference update

`agent.pw` is now demoted to reference/spike material only. It is technically close, but too niche to be the default Constellation dependency.

Preferred direction:

```txt
SecretStore interface first.
Popular backend first.
Niche agent-vault projects as references only.
```

V0 preferred backend candidate:

```txt
InfisicalSecretStore
```

Shape:

```txt
Constellation DB stores metadata/ref:
  workspaceId
  actorId
  sourceId
  providerId
  credential kind/status
  secretRef
  audit metadata

Infisical stores encrypted secret payload:
  OAuth tokens
  API keys
  BYO LLM provider keys
  client secrets where needed
```

Fallback:

```txt
EncryptedPostgresSecretStore
```

only if Infisical adds too much operational burden or cannot satisfy provider lifecycle requirements.

Future enterprise backends:

```txt
Vault/OpenBao
AWS/GCP/Azure Secret Manager or KMS envelope backend
```

Reference-only projects:

```txt
agent.pw
Cred Ninja
API Locker
OpenCloak
```

## Composio managed connector backend option

Composio is now an explicit optional managed connector backend.

Use it when speed and connector coverage matter more than self-custody:

```txt
credentialProvider = "composio-managed"
```

Pros:

```txt
managed OAuth
per-user connected accounts
many SaaS connectors
MCP/session tooling
free/cheap early usage tier
much less connector plumbing
```

Constraints:

```txt
Composio becomes a third-party credential custodian and tool-call data processor.
Private/regulated deployments may reject this.
BYO LLM keys and MCP-native gaps still need Constellation SecretStore.
Provider-specific spikes still required for Notion/Airtable/Microsoft.
```

Decision:

```txt
Keep SecretStore abstraction.
Add Composio adapter as fast-path managed backend.
Do not make Composio the only credential strategy.
```

Production gates:

```txt
DPA/security/subprocessor review
incident-history risk acceptance
custom OAuth app support verified
scope/tool allowlist verified
revoke/disconnect verified
no raw token exposure verified
Constellation audit/redaction wrapper verified
```
