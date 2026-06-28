## Review

### Correct

- **Issue tracking alignment**: Plan is clearly scoped to issue #416 with "draft" status. Foundation scope is explicitly separated from "Later shippable hosted scope" (lines 24-37), avoiding overclaiming implementation.

- **Scope separation**: Foundation owns contracts/templates/registry shapes/policy concepts; hosted OAuth/token storage/production routes are deferred appropriately.

- **Provider templates documented**: Notion and Airtable templates include endpoint, transport, auth mode, and default read-only policy (lines 44-68).

- **Policy rules specified**: Deny-before-allow, tool name regex validation, input schema validation, resource URI prefix validation, and "denied/invalid calls never reach MCP transport" are all explicitly stated (lines 128-135).

- **OpenClaw lifecycle patterns captured**: Status/doctor/probe concepts are defined with clear boundaries (status = static local state, doctor = local config validation, probe = live connect/discovery) at lines 146-151.

- **pi-mcp-adapter treated as reference**: README (line 22) and plan acceptance criteria (line 194) explicitly state pi-mcp-adapter is implementation inspiration, not a raw hosted extension dependency.

- **Error codes enumerated**: 14 stable MCP error codes are listed including MCP_SECRET_LEAK_GUARD, MCP_TOOL_NOT_ALLOWED, MCP_PROVIDER_TOOL_DRIFT (lines 160-173).

- **Generic agent tools surface defined**: 7 generic MCP tools are specified instead of exposing every provider tool directly (lines 113-122).

### Fixed

- None required. This is a design/planning document review pass.

### Blocker

- None. The plan is appropriately scoped for a foundation tracking document.

### Note

- **Medium**: pi-mcp-adapter lessons are referenced in README but not detailed in the plan itself. Consider adding a "Lessons from pi-mcp-adapter" section capturing specific patterns (e.g., transport abstraction boundaries, lazy connection lifecycle, proxy-tool security model) to make the design more self-contained.

- **Medium**: New/unclassified provider tools are "disabled until classified" (line 71) but the classification workflow/mechanism is not specified. Add a note about how allowlists get updated (manual admin process? automated heuristics? provider certification?).

- **Medium**: `mcp_credentials` table is shown in architecture diagram (line 82) but credential storage/encryption/rotation strategy is deferred entirely to "later PR". Consider adding a risk note about credential handling being a dependency for production readiness.

- **Medium**: Rate limiting and circuit breakers are listed in "Later shippable hosted scope" (line 34) but no guidance is given on why they're deferred or what the foundation scope should leave hooks for. Add a brief note about extensibility points the foundation should preserve.

- **Low**: Airtable deny patterns use simple prefix matching (`create_*`, `update_*`, etc.). Consider noting that provider tool naming conventions may vary and the policy engine should support more flexible matching (regex, glob, or provider-specific classification).
