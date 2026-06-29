# Claude Re-review: MCP Integration Plan After Gemini Amendments

**Date:** 2026-06-29  
**Review Type:** Plan re-review after Gemini review amendments  
**Status:** GREEN — All Gemini concerns addressed

---

## Summary

The plan has incorporated all six Gemini review concerns. Each amendment is present, specific, and technically sound. No blockers, highs, or mediums remain unaddressed.

---

## Gemini Concerns — Verification

### 1. Redaction Guard Feasibility ✅

**Gemini concern:** The original `McpRedactionGuard.redact(value: unknown)` interface was too abstract; redaction must be seeded with concrete credential values.

**Amendment present:** Lines 636–657

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

**Rules added:**
- Resolved access/refresh tokens, auth codes, dynamic client secrets, and authorization headers added to `sensitiveValues`
- Regex detection is only a fallback
- Tests must prove token under non-sensitive key is still removed when in `sensitiveValues`

**Verdict:** ✅ Addressed — Interface now accepts concrete context; tests required.

---

### 2. Schema Hash Drift Brittleness ✅

**Gemini concern:** Hard-disabling tools on any schema hash change causes operational pain; providers frequently update descriptions or add optional fields.

**Amendment present:** Lines 658–666

**Severity-based drift classification:**
- **Breaking drift** → disable affected tool (required input added, type changed, tool removed/renamed, output shape unparseable)
- **Review drift** → keep enabled but flag for review (description changed, optional input added, output schema expanded)
- **New tool drift** → disabled until classified

**Materialized V2 tools:** Stricter — any schema hash mismatch disables direct tool, but bridge may remain if compatibility passes.

**Verdict:** ✅ Addressed — Differentiates breaking vs. review drift; avoids blanket hard-disable.

---

### 3. Mode A CLI Config Trust Boundary ✅

**Gemini concern:** If agent can write `.mcp.json` and add malicious stdio servers, it can execute arbitrary code. Mode A config must be isolated from agent write permissions.

**Amendment present:** Lines 668–679

**Rules added:**
- User/global MCP config lives outside agent-writable workspace by default
- Project-local MCP config is read-only to agent unless user explicitly grants edit rights
- `doctor` warns if MCP config file is inside agent-writable directory
- Adding/enabling stdio MCP servers requires explicit user action outside autonomous agent edits
- Runtime agents cannot silently add stdio servers by writing `.mcp.json` and triggering reload
- Hosted Mode B disables arbitrary stdio by default

**Verdict:** ✅ Addressed — Clear trust boundary; agent cannot mutate config and execute.

---

### 4. V0 Tool Interface — Describe and Pagination ✅

**Gemini concern:** V0 must include `describe` capability so agent can fetch exact JSON schema before calling; pagination missing for tools/search.

**Amendment present:** Lines 681–697

**Final V0 bridge tools:**
```ts
mcp_servers_list({ cursor?, limit? })
mcp_server_status({ serverId })
mcp_server_doctor({ serverId })
mcp_server_probe({ serverId })
mcp_tools_search({ query, serverId?, cursor?, limit?, enabledOnly? })
mcp_tool_describe({ serverId, toolName })
mcp_resources_list({ serverId, cursor?, limit? })
mcp_resource_read({ serverId, uri })
mcp_readonly_call({ serverId, toolName, input })
```

**Clarification added:** `mcp_tool_describe` is required in V0; `mcp_tools_list` deprecated in favor of paginated search/describe.

**Verdict:** ✅ Addressed — Describe included; pagination on servers, tools_search, and resources_list.

---

### 5. Resource URI Validation ✅

**Gemini concern:** `allowedResourceUriPrefixes` must account for custom protocols (notion://, file://) and prevent local file reads in hosted mode.

**Amendment present:** Lines 699–706

**Rules:**
- Resource validation is provider-template based, not origin-based
- Providers must declare allowed URI schemes/prefixes or a validator
- Absent validator/prefix means resource reads denied
- `file://` and host-local paths denied in hosted Mode B unless app-defined provider explicitly owns them
- CLI Mode A may allow local filesystem resources only when MCP server config was user-approved and outside agent write control

**Verdict:** ✅ Addressed — Provider-template validation; file:// explicitly denied in Mode B unless approved.

---

### 6. Connection Lifecycle Guard ✅

**Gemini concern:** Execution guards wrap calls but not connections; hosted mode needs connection pooling strategy to avoid exhausting server connection pools.

**Amendment present:** Lines 708–724

**Interface added:**
```ts
interface McpConnectionManager {
  getOrCreateClient(actor, source): Promise<McpTransportClient>;
  releaseClient(actor, source): Promise<void>;
  closeSource(sourceId): Promise<void>;
  closeIdle(now: number): Promise<void>;
}
```

**Hosted Mode B requirements:**
- Cache key includes app/workspace/user/source/provider/config version
- Max active clients per user/workspace/source
- Max concurrent connects
- Idle TTL
- SSE clients are process-local and disposable
- No assumption of sticky sessions
- Disconnect/revoke invalidates source of truth and closes known local clients best-effort

**Verdict:** ✅ Addressed — Dedicated connection manager interface with pooling/leak prevention requirements.

---

## Review Output

```
## Review
- Correct: All six Gemini concerns have been addressed with specific interface amendments and rules:
  1. Redaction guard now accepts `McpRedactionContext` with concrete sensitive values (lines 636–657)
  2. Drift handling is severity-based (breaking/review/new) instead of blanket hard-disable (lines 658–666)
  3. CLI Mode A config trust boundary explicitly isolates agent-writable paths (lines 668–679)
  4. V0 tool interface includes `mcp_tool_describe` and pagination on all list/search operations (lines 681–697)
  5. Resource URI validation is provider-template based with explicit file:// denial in Mode B (lines 699–706)
  6. `McpConnectionManager` interface added for connection lifecycle/pooling (lines 708–724)

- Fixed: N/A — This is a plan review; amendments were already applied to the plan document.

- Blocker: None. All Gemini concerns resolved.

- Note: The plan is now ready for implementation. Remaining work is in the implementation phase, not design.
```

---

## Conclusion

**GREEN** — The plan has fully incorporated all Gemini review amendments. The design is coherent, addresses all identified risks, and provides clear interfaces for implementation. No further plan-level changes are required before proceeding to implementation.
