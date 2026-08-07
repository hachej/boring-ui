---
github: https://github.com/hachej/boring-ui/issues/1011
issue: 1011
state: needs-info
updated: 2026-08-07
flag: flag:BORING_MCP_ENABLED
track: owner
---

# gh-1011 external MCP — user-registered servers (lane plan draft)

## Problem

`@hachej/boring-mcp` (`plugins/boring-mcp/`) is a real, tested MCP client
(official SDK, `StreamableHTTPClientTransport`, 7 read-only agent tools,
deny-before-allow tool classification) but only ever talks to two
hardcoded providers (`DEFAULT_MCP_PROVIDER_TEMPLATES` =
`[NOTION_MCP_TEMPLATE, AIRTABLE_MCP_TEMPLATE]`, `plugins/boring-mcp/src/shared/index.ts:22,259`).
There is no path for a user to register their own MCP server URL, no
per-server credential storage outside the single server-wide
`COMPOSIO_API_KEY`, and no per-Agent grant model — `mcpServerRefs` on
agent definitions (`packages/agent/src/shared/agent-definition.ts:28,143`)
is validated and frozen by `compileAgentDirectory.ts:279` but nothing
resolves a ref into a live connection. This lane (#1011) is the umbrella
for closing that gap; #900 is the curated full-catalog Composio slice
(different problem: no user-supplied URLs), #806 is the opposite-direction
ingress issue (closed, doc-move only).

**This lane has no named consumer today.** Per the lane's own gate, no
implementation may start until an owner-approved consumer exists. This
plan exists so that when a consumer shows up, the decisions and slices
are already scoped — not so slices can be picked up immediately.

## Solution

Do not restate #937/#946: no full-catalog Composio backend, no parallel
grant/policy system. Two adjacent efforts changed the ground since #1011
was filed:

- **#1114 (merged)**: `loadConfiguredAgentFleet()` + `fleet.yaml` +
  `policy.yaml` give agents a config-driven identity/model/skill seat, but
  no MCP capability resolution — it is the seat-composition seam, not a
  grant seam.
- **#1087 (open, sibling lane)**: explicitly owns "Workspace MCP grants
  per Agent" — `{ workspaceId, agentTypeId, connectorId, allowedTools }`
  scoping, a Workspace MCP pane, and resolving `mcpServerRefs` into the
  Agent Host's capability projection. This is the grant seam #1011 must
  plug into.

External-MCP (user-registered servers) is therefore **not** a standalone
backend. It is:

1. A new `McpProviderTemplate`-equivalent path for a *user-supplied*
   Streamable-HTTP endpoint + auth (bypassing the static
   `DEFAULT_MCP_PROVIDER_TEMPLATES` list), reusing the existing
   `mcpSdkTransport.ts` client unchanged.
2. Per-workspace secret custody for that endpoint's credentials (blocked
   on the BYOK/credential lane #1010 — `resolveSecret` today rejects any
   provider outside the static `connectorConfigs`).
3. A grant that flows through #1087's `{ workspaceId, agentTypeId,
   connectorId, allowedTools }` model rather than a second policy
   surface, once #1087 lands.
4. Approval-boundary reuse (`@hachej/boring-ask-user`, per #900's
   pattern) at the point an agent calls a tool on a user-registered
   server, since these servers carry no Composio-side vetting.

Given (2) and (3) are blocked on sibling lanes, this plan cannot honestly
propose slices that start before those land or before a named consumer
picks a scope. See Open Questions.

## Decisions

- Reuse `mcpSdkTransport.ts` / `StreamableHTTPClientTransport` as-is for
  the wire protocol; user-registered servers are still Streamable-HTTP
  only (stdio/SSE stay out, consistent with #900's boundary).
- Do not build a second grant/authorization model — user-registered
  servers must resolve through #1087's `{ workspaceId, agentTypeId,
  connectorId, allowedTools }` shape, not a parallel one.
- Do not build a second secret store — per-server credentials for
  user-registered endpoints depend on #1010 (BYOK/credential lane); this
  plan does not invent an interim store.
- Keep the existing deny-before-allow `classifyMcpTool` and
  `mcp_readonly_call`-only execution boundary; user-registered servers do
  not get a bigger write surface than curated ones by default.
- `mcpServerRefs` gets a single resolution path (through #1087), not a
  second one added by this lane.
- No re-land of #937's full-catalog backend; this lane is scoped to
  user-supplied single-server registration only.

## Flag / Abstraction

- Needed?: yes, reuse `BORING_MCP_ENABLED` / `BORING_MCP_PROD_ENABLED`
  (`plugins/boring-mcp`); user-registered-server support gates behind the
  same flags plus a new source-type discriminator, not a new top-level
  flag.
- Path: extend `McpProviderId`'s `(string & {})` escape hatch
  (`plugins/boring-mcp/src/shared/index.ts:22`) with an explicit
  `"user-registered"` kind rather than relying on the untyped fallback.
- Rollback: disabling the flag(s) removes the registration UI/tools;
  existing curated Notion/Airtable sources are unaffected since they stay
  on the current static-template path.

## Test Seams

- Highest public seam: the 7 agent tools (`mcp_servers_list`,
  `mcp_server_status`, `mcp_server_doctor`, `mcp_server_probe`,
  `mcp_tools_search`, `mcp_tool_describe`, `mcp_readonly_call`) exposed
  via `agentBridge.ts` → `agentTools.ts` → `appServerBinding.ts`.
- Existing prior art: `plugins/boring-mcp/src/server/__tests__/` (~15
  files) already covers transport, classification, and hardening against
  the two static providers — new tests should parametrize those suites
  over a user-registered source rather than duplicating them.
- Avoid testing: the Composio-managed-connector path
  (`composioManagedConnector.ts`) — unrelated to user-supplied URLs.

## Acceptance

Not yet gateable — no consumer, no slice has been approved. Acceptance
criteria will be written per-slice once a named consumer and secret-
storage decision exist.

## Proof

- Exact command: n/a until slices are approved.
- Waiver if proof is not possible: this plan itself is the gate-1
  artifact; no runtime change accompanies it.

## Slices

All slices below are **blocked pending gate-1 owner approval and a named
consumer**. None may start.

### Slice: user-registered source type + template escape hatch

**Delivers:** A typed `"user-registered"` `McpProviderId` kind plus a
`McpProviderTemplate`-equivalent shape that a user can fill in (endpoint
URL, header names) without adding entries to
`DEFAULT_MCP_PROVIDER_TEMPLATES`, reusing `mcpSdkTransport.ts` unchanged.

**Blocked by:** Named consumer (Open Questions); #1010 for credential
storage of any auth header value beyond a placeholder.

**Proof:** `plugins/boring-mcp` unit tests parametrized over a
user-registered source; `pnpm --filter @hachej/boring-mcp test`.

**Review budget:** inside — additive type + one new source-resolution
branch, same transport.

### Slice: per-server credential custody for user-registered sources

**Delivers:** Workspace-scoped secret storage for a user-registered
server's auth header(s), replacing the placeholder from the prior slice.

**Blocked by:** #1010 (BYOK/credential lane) landing its storage
primitive; this slice consumes it, does not invent one.

**Proof:** secret round-trip test + `resolveSecret` extended to accept a
non-static provider id scoped to `{ workspaceId, sourceId }`.

**Review budget:** inside, assuming #1010's primitive exists — otherwise
exceeds (would require inventing storage, out of scope for this lane).

### Slice: resolve `mcpServerRefs` through the #1087 grant seam

**Delivers:** The frozen-but-inert `mcpServerRefs` field on agent
definitions resolves into an Agent Host MCP capability projection scoped
by `{ workspaceId, agentTypeId, connectorId, allowedTools }`, for both
curated and user-registered sources.

**Blocked by:** #1087 landing its grant model and capability projection;
this slice is the "wire user-registered sources into it" half, not the
grant model itself.

**Proof:** Alpha/Beta Agent isolation regression (per #1087's own
acceptance) extended with a user-registered-source case; no bleed across
agentType or workspace.

**Review budget:** inside, once #1087's seam exists.

### Slice: Workspace MCP pane — register a custom server URL

**Delivers:** UI affordance in the Workspace MCP pane (owned by #1087) to
add a user-supplied endpoint + credential, alongside curated
Notion/Airtable sources.

**Blocked by:** #1087's pane existing; the prior three slices.

**Proof:** manual registration flow + existing `BoringMcpSourcesOverlay`
front tests extended for a user-registered row.

**Review budget:** inside — additive UI row, same overlay component
family.

### Slice: ask-user approval boundary for user-registered tool calls

**Delivers:** Every `mcp_readonly_call` (and any future write path)
against a user-registered server routes through
`@hachej/boring-ask-user` for one-shot approval, since these servers
carry no Composio-side vetting — reusing #900's approval-boundary
pattern rather than inventing a second one.

**Blocked by:** the resolution slice above; #900's approval pattern
landing (or being copied) first.

**Proof:** approval-required regression on the `mcp_readonly_call` path
for a user-registered source, mirroring #900's acceptance #5-#7.

**Review budget:** inside.

## Out of Scope

- Full-catalog Composio mode (#900 owns this; do not re-land #937).
- MCP ingress / exposing Boring as an MCP server (#806, hard-disabled by
  `hostSecurityConfig.ts:163`; separate direction).
- stdio or SSE transports.
- A second secret store independent of #1010.
- A second grant/policy model independent of #1087.
- Removing `mcpServerRefs` (fix-vs-remove decision is explicitly an Open
  Question, not resolved here).

## Open Questions

Owner must answer these at gate 1 before any slice unblocks:

1. **Named consumer**: which product/customer need justifies building
   user-registered external MCP now? (The lane rule requires this before
   dispatch; none is on record as of 2026-08-07.)
2. **Secret storage choice**: does #1010 (BYOK/credential lane) land a
   primitive this lane can consume, or does the named consumer's scope
   justify a narrower interim storage mechanism scoped only to MCP
   endpoint credentials?
3. **Per-agent vs per-workspace grants**: does #1087's
   `{ workspaceId, agentTypeId, connectorId, allowedTools }` shape cover
   user-registered sources as-is, or does a user-supplied endpoint need
   an additional trust/verification dimension (e.g. an explicit
   workspace-owner attestation) beyond curated providers?
4. **Composio-style catalogs**: explicitly confirm they stay out of this
   lane (owned by #900) — is that still correct, or does the named
   consumer actually want catalog-style discovery of arbitrary
   user-supplied servers (which would reopen #937/#946's territory)?
5. **`mcpServerRefs` disposition**: fix it (resolve through #1087) as
   this plan assumes, or remove the field entirely if no consumer needs
   ref-based static wiring before the grant seam exists?
6. **Write access**: does the named consumer need anything beyond
   `mcp_readonly_call` for user-registered servers, given they carry no
   Composio-side vetting? If yes, the approval-boundary slice's scope
   changes materially.
7. **Transport ceiling**: is Streamable-HTTP-only sufficient for the
   named consumer's servers, or does stdio/SSE support become a hard
   requirement (currently explicitly out of scope per #900's precedent)?
