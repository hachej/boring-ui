# Plan Review Pass 3 — Final

Document: `docs/issues/416/mcp-integration/plan.md`
Review date: 2026-06-28
Focus: Verify interface additions address pass2 High items

## Review

### Correct

- **Redaction guard interface specified** (lines 255-271): `McpRedactionGuard` with `redact()`, `assertSafeForAgent()`, `assertSafeForLog()` methods. Rules clearly state transport responses must pass through `assertSafeForAgent` before returning to tools, and logs pass through `redact` before persistence.

- **Credential provider contract defined** (lines 274-284): `McpCredentialProvider` with `resolveCredentialRef()` and `refreshIfNeeded()` methods. Explicitly notes V0 may use fake implementation, production belongs to hosted OAuth work with encrypted storage.

- **Tool classification interface added** (lines 287-296): `McpToolClassification` with `toolName`, `risk`, `enabledByDefault`, `reason`, `schemaHash` fields.

- **Classification test requirements specified** (lines 298-305): Five specific test cases listed including allowlist enable, deny pattern disable, unknown tool disabled, schema hash drift, and manual template update.

- **Execution guard hooks defined** (lines 309-315): `McpExecutionGuard` with `beforeCall()`, `afterCall()`, `afterFailure()` methods for rate limits, circuit breakers, timeout budgets, and metrics.

- **Admin UI scope clarified** (line 324): "No admin classification UI in the foundation. Classification is a checked-in code/config workflow until a later product UI exists."

### Fixed

- **High → Fixed**: Redaction guard interface now specified with `McpRedactionGuard` and clear rules for when it applies.

- **High → Fixed**: Credential storage contract now defined with `McpCredentialProvider` interface even though implementation is deferred.

- **High → Fixed**: Classification testing strategy now included with five explicit test cases under `McpToolClassification`.

- **High → Fixed**: Rate limit/circuit-breaker hooks now specified with `McpExecutionGuard` interface.

### Blocker

- **None.** All pass2 High items have been addressed.

### Note

- **Medium**: Provider-specific classification metadata structure is mentioned ("lives in provider templates or checked-in provider registry artifacts" at line 286) but the exact shape/location is not specified. This can be refined during implementation.

- **Medium**: Tool name regex extensibility is noted ("Provider templates may later override validation" at line 321) but the mechanism for override is not defined. Low risk since unknown/special-character tools remain disabled by default.

---

**Verdict: GREEN.** All pass2 High items have been addressed with concrete interface definitions. The plan is now complete for foundation implementation. Medium notes are implementation details that can be refined during coding.
