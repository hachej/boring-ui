# MCP Tool Roadmap & Plugin/Shape Review

**Plan reviewed:** `docs/issues/416/mcp-integration/plan.md`
**Review date:** 2026-06-29
**Focus:** V1/V2 tool exposure roadmap and plugin/package shape decision

---

## Review

### GREEN

The plan is clean and coherent. No blockers identified.

#### Correct (evidence-backed)

1. **V0/V1/V2 roadmap is logically progressive**
   - V0: minimal proxy tools (`mcp_tools_search`, `mcp_tool_describe`, `mcp_readonly_call`)
   - V1: Hermes-style progressive disclosure with search/describe/call bridge
   - V2: OpenClaw/Hermes-style materialized tools as sugar over the same facade
   - Each layer builds on the previous without bypassing security checks

2. **Plugin/package split is architecturally sound**
   - Layer 1 (MCP server package): owns generic backend mechanics, no UI dependency
   - Layer 2 (app/internal trusted plugin): handles trusted routes, OAuth callbacks, encrypted token access, server-side MCP calls
   - Correctly identifies that runtime `.pi/extensions` plugins are inappropriate for hosted production credentials/OAuth

3. **Security invariants preserved across all V1/V2 stages**
   - V2 materialized tools explicitly route through the same MCP facade
   - Direct tools inherit source ownership, credential, redaction, audit, and policy checks
   - Schema hash drift disables direct tools until reclassified

4. **Consistent with existing plan content**
   - Tool classification workflow (manual + conservative V0) aligns with V1/V2 progression
   - Drift detection rules apply uniformly across V0/V1/V2
   - Redaction guard and credential provider interfaces support all exposure levels

#### Fixed

None required.

#### Blocker

None.

#### High

None.

#### Medium

1. **V1 `mcp_tools_search` semantics underspecified**
   - Location: Tool exposure roadmap, V1 section
   - Issue: The plan states `mcp_tools_search` "searches enabled/classified MCP tools across connected servers" but does not define:
     - Search input shape (query string? filters? serverId scope?)
     - Output shape (full schema? summary only? classification metadata?)
     - Performance expectations (indexed catalog vs. live probe)
   - Risk: Implementation may diverge from intent; Hermes reference not linked
   - Suggestion: Add a minimal interface sketch or reference to Hermes search spec

2. **V2 materialization trigger not defined**
   - Location: Tool exposure roadmap, V2 section
   - Issue: The plan says "for high-confidence enabled tools, optionally materialize direct agent tools" but does not specify:
     - What constitutes "high-confidence" (e.g., usage count, schema stability duration, manual flag?)
     - Who/what triggers materialization (admin action? automated after N successful calls?)
     - How materialized tools are discovered/registered with the agent
   - Risk: Ambiguity may lead to inconsistent implementation or premature materialization
   - Suggestion: Define a simple trigger condition (e.g., "admin-confirmed classification + 30-day schema stability")

3. **Plugin trusted routes not enumerated**
   - Location: Plugin/package shape decision, Layer 2 section
   - Issue: States plugin needs "trusted server routes" but does not list expected route shapes
   - Risk: May lead to scope creep or missing endpoints during implementation
   - Suggestion: Add a minimal route list (e.g., `/api/mcp/servers`, `/api/mcp/{serverId}/probe`, `/api/mcp/auth/callback`)

#### Note

1. **Tool exposure roadmap aligns well with OpenClaw/Hermes references**
   - Progressive disclosure pattern is well-established in the referenced systems
   - The "sugar over facade" pattern for V2 is a safe design choice

2. **Plugin shape decision correctly avoids runtime `.pi/extensions` for production**
   - This prevents credential leakage through workspace files or Pi transcripts
   - Trusted plugin approach matches the architectural invariants in `AGENTS.md`

3. **Consider adding a migration path from V0 to V1**
   - If V0 is shipped first, how do existing deployments upgrade to V1 search/describe?
   - This is likely low-risk (additive change) but worth documenting

---

## Summary

**Verdict:** GREEN

The V1/V2 tool exposure roadmap and plugin/package shape decision are well-reasoned and consistent with the broader MCP foundation plan. Three medium-severity clarifications are suggested for search semantics, materialization triggers, and route enumeration, but none block implementation.
