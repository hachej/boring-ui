# Lane brief — external MCP — user-registered servers

Tracking issue: #1011 (authoritative). This file is the working brief; keep it in sync as the lane executes.

## Today (verified against `origin/main`, 2026-07-31) — this genuinely works
Plugin `@hachej/boring-mcp` (`plugins/boring-mcp/`) is a real, tested implementation (~15 test files):
- Real MCP client over the official SDK: `src/server/mcpSdkTransport.ts` — `@modelcontextprotocol/sdk` `Client` + `StreamableHTTPClientTransport`, per-source endpoint + headers. Generic enough for any Streamable-HTTP endpoint.
- Composio-managed connectors: `composioManagedConnector.ts` (session + hosted OAuth connect URL), `managedConnectorAdapter.ts`, `managedConnectorPreflight.ts`, `hardening.ts` (rate budgets, redaction canaries, origin pinning).
- **7 agent tools live in the model's toolset**: `mcp_servers_list`, `mcp_server_status`, `mcp_server_doctor`, `mcp_server_probe`, `mcp_tools_search`, `mcp_tool_describe`, `mcp_readonly_call` — wired via `agentBridge.ts` → `agentTools.ts` → `appServerBinding.ts` → `apps/full-app/src/server/main.ts:69` `getExtraTools`, consumed by `registerAgentRoutes.ts:808`. Note this is the app's extra-tools seam, **not** `buildAgentComposition`.
- Read-only by construction: deny-before-allow `classifyMcpTool`; only `mcp_readonly_call` executes.
- Front overlay `BoringMcpSourcesOverlay` mounted at `apps/full-app/src/front/main.tsx:136` (prod-only flag).
- Flags `BORING_MCP_ENABLED` / `BORING_MCP_PROD_ENABLED`; one server-env `COMPOSIO_API_KEY`.

Ingress (exposing Boring as an MCP server) also exists — `packages/agent/src/server/mcp/managedAgentMcpServer.ts`, app glue at `/mcp/managed-agent` — but is **hard-disabled in every released host**: `hostSecurityConfig.ts:163` freezes `managedAgentMcp: {enabled: false}`.

## The actual limit
Only **two hardcoded providers**: `DEFAULT_MCP_PROVIDER_TEMPLATES = [NOTION_MCP_TEMPLATE, AIRTABLE_MCP_TEMPLATE]` (`src/shared/index.ts:259`). Sources are keyed by a `McpProviderId` from that static list; the overlay renders only `enabledProviderIds`.

## Delta to "a user registers their own MCP server and an agent calls its tools"
1. **User-supplied server URLs** — no path exists; explicitly out of scope in #900.
2. **Transports** — only Streamable-HTTP. No stdio, no SSE.
3. **Per-server credentials** — none. One server-wide `COMPOSIO_API_KEY`; `resolveSecret` rejects any provider outside the static `connectorConfigs`. *This is the shared-substrate dependency — see the BYOK lane #1010.*
4. **Persistence** — registrations live in a user-settings JSON blob (`__serverBoringMcpSourcesV1`, keyed `[key][workspaceId][sourceId]`). No table, no migration, no workspace-level (vs per-user) registration.
5. **Write/mutating tools** — only `mcp_readonly_call`, gated by per-provider allow/deny patterns that must be authored per server.
6. **Ask-User approval boundary** at provider dispatch — slice 900.2 never landed.
7. **`mcpServerRefs` is inert** — the field on agent definitions (`shared/agent-definition.ts:28,143`) is validated, frozen (`compileAgentDirectory.ts:279`) and inventory-checked, but **nothing resolves a ref into a connection**. It reads as working support and is a naming surface only. Fix or remove.

## History — do not repeat
Full-catalog Composio mode landed as #937 (merged 2026-07-24) and was **fully reverted by #946** (merged 2026-07-25, exact inverse across the same 13 files). Per #946 the re-land must be small reviewed slices with an application-owned atomic backend. Do not re-land #937 wholesale.

Refs #806, #900, #391

## Status

Not started. This branch is the lane seed — a draft PR so the lane has a visible home before work begins.
