# Plan review pass 8 — live Composio + onboarding UX amendment

Date: 2026-06-29
Reviewer: built-in reviewer, thermonuclear plan review

## Verdict

GREEN after required plan fixes.

## Findings

- Live Composio Notion PoC instructions are captured and actionable:
  - server-only `composio.create(..., { mcp: true, manageConnections: ... })`;
  - MCP SDK / pi-adapter Streamable HTTP over `session.mcp.url` plus secret headers;
  - tool discovery via `COMPOSIO_SEARCH_TOOLS`;
  - execution through governed `mcp_readonly_call` to `COMPOSIO_MULTI_EXECUTE_TOOL`.
- Browser/agent exposure of raw Composio meta-tools is explicitly forbidden.
- Left-panel MCP/Sources onboarding and management UX is specified with provider cards, statuses, connect/manage, tool preview, audit preview, and user-friendly copy.
- Secret leakage controls are explicit: `session.mcp.headers` treated as secret, redaction/audit guards required, browser forbidden from receiving API keys/session headers/provider tokens.
- Plan avoids an overbuilt connector framework: one seam, one Composio implementation, one dispatch point, no plugin loading/migration/multiple unused production backends.

## Required fixes applied

- Replaced contradictory `ConnectorCredentialProvider + ConnectorToolProvider` architecture language with a single thin `ConnectorProvider` seam.
- Updated the call path to `ConnectorProvider.callTool`.
- Updated Phase 1 to add only the single `ConnectorProvider` contract.
- Replaced ambiguous product UI wording with explicit left-panel `Sources` UI work.

## Blockers

None.
