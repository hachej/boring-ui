# Claude-Style Thermonuclear Plan Review

**Document:** `docs/issues/416/mcp-integration/plan.md`
**Review date:** 2026-06-29
**Focus:** Architecture, plugin shape, CLI vs hosted modes, V0/V1/V2 tool exposure, credential boundaries, security, drift, implementation risks

---

## Review

### Correct (architecture verified)

- **Architecture diagram coherent** (lines 78-86): MCP registry → Hosted MCP facade → Transport client → Provider server → Trusted tools. Clear data flow with "agent must not receive raw provider tokens" invariant stated.

- **Plugin/package split architecturally sound** (lines 470-494):
  - Layer 1 (MCP server package): owns generic backend mechanics, no UI dependency
  - Layer 2 (app/internal trusted plugin): handles trusted routes, OAuth callbacks, encrypted token access
  - Correctly rejects runtime `.pi/extensions` for hosted production credentials

- **CLI vs hosted modes fully specified** (lines 534-608):
  - Mode A (user-managed/CLI): user owns config/auth, arbitrary stdio allowed with warnings
  - Mode B (app-predefined/hosted): app defines templates/policies, encrypted server-side credentials
  - Comparison table (lines 590-598) clearly documents trust boundary differences
  - Mode adapters pattern prevents CLI semantics leaking into hosted production (lines 612-619)

- **V0/V1/V2 tool exposure progressive and safe** (lines 400-463):
  - V0: minimal proxy tools (`mcp_tools_search`, `mcp_tool_describe`, `mcp_readonly_call`)
  - V1: Hermes-style progressive disclosure with search/describe/call bridge
  - V2: Materialized tools as sugar over same facade, never bypass security
  - Search interface (`McpToolsSearchRequest`/`McpToolsSearchResult`) fully specified (lines 400-422)
  - Materialization trigger conditions explicit (lines 425-444): exact classification, enabledByDefault, schema hash match, read-only, admin flag, stable naming
  - Trusted route surface enumerated (lines 447-463)

- **Credential boundaries enforced** (lines 274-284, 369-378):
  - `McpCredentialProvider` interface with opaque credential references
  - `McpResolvedCredential` shape defined (accessToken, expiresAt, refreshToken?, tokenType?, scopes?)
  - Explicit: "agent must not receive raw provider tokens or raw `.mcp.json` config" (line 87)
  - Production: "must source this from encrypted storage only" (line 377)
  - No token writes to `.pi`, workspace files, Pi transcripts, browser responses, or logs (lines 185-187)

- **Security posture comprehensive** (lines 128-135, 255-271, 309-315):
  - Policy rules: deny-before-allow, source ownership, tool name regex, input/URI size limits
  - `McpRedactionGuard` interface: `redact()`, `assertSafeForAgent()`, `assertSafeForLog()`
  - `McpExecutionGuard` hooks: `beforeCall()`, `afterCall()`, `afterFailure()` for rate limits/breakers
  - 14 stable error codes including `MCP_SECRET_LEAK_GUARD`, `MCP_TOOL_NOT_ALLOWED`, `MCP_PROVIDER_TOOL_DRIFT`

- **Drift detection fully specified** (lines 353-366):
  - `MCP_PROVIDER_TOOL_DRIFT` triggers on 5 concrete conditions:
    1. Allowed tool missing from live `tools/list`
    2. Live tool with changed input schema hash
    3. Live tool with changed output schema hash
    4. New live tool without exact checked-in classification
    5. Previously denied tool with changed schema/description
  - Default response: disable affected tool/server until reclassified

- **Implementation risks explicitly deferred** (lines 189-200, 340-350):
  - Credential storage: deferred but interface defined
  - Rate limits/circuit breakers: deferred but `McpExecutionGuard` hooks provided
  - Admin classification UI: deferred, code/config workflow for V0
  - All deferred items clearly marked as "production readiness dependencies"

### Fixed

None required. All prior review medium items (passes 1-5, tool-roadmap review) have been addressed in the plan:
- Redaction guard interface: specified (lines 255-271)
- Credential provider contract: defined (lines 274-284)
- Classification testing strategy: five test cases (lines 298-305)
- Execution guard hooks: defined (lines 309-315)
- Drift detection shape: five concrete conditions (lines 353-366)
- `McpResolvedCredential` shape: complete interface (lines 369-378)
- Resource URI defaults: explicit deny when absent (lines 381-384)
- V1 search semantics: `McpToolsSearchRequest`/`McpToolsSearchResult` interfaces (lines 400-422)
- V2 materialization triggers: six explicit conditions (lines 425-444)
- Trusted route surface: 10 routes enumerated (lines 447-463)

### Blocker

None. The plan is architecturally complete, security-conscious, and appropriately scoped for foundation implementation.

### High

None. All security invariants, credential boundaries, and mode separation are properly specified.

### Medium

None. All prior medium items from previous reviews have been addressed. The plan is clean.

---

## Summary

**Verdict: GREEN**

The MCP onboarding plan is architecturally sound, security-hardened, and production-aware. Key strengths:

1. **Mode separation**: CLI and hosted modes are cleanly separated with explicit trust boundary differences
2. **Security by default**: Deny-before-allow, redaction guard, credential opacity, drift detection
3. **Progressive tool exposure**: V0/V1/V2 roadmap preserves security invariants at each layer
4. **Plugin shape correct**: Avoids runtime `.pi/extensions` for production credentials
5. **Interfaces defined**: All deferred items have contracts (redaction, credentials, execution guard)
6. **Drift handling**: Five concrete conditions with safe default (disable until reclassified)

No blockers, highs, or mediums remain. The plan is ready for implementation.
