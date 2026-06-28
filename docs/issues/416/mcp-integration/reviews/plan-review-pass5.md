# Plan Review Pass 5 — Drift/Credential/Resource Defaults Verification

Document: `docs/issues/416/mcp-integration/plan.md`
Review date: 2026-06-28
Focus: Verify pass4 medium items (drift, credential shape, resource URI defaults)

## Review

### Correct

- **Drift detection fully specified** (lines 353-366): `MCP_PROVIDER_TOOL_DRIFT` now has 5 concrete conditions:
  - allowed tool missing from live `tools/list`
  - live tool with changed input schema hash
  - live tool with changed output schema hash
  - new live tool without exact checked-in classification
  - previously denied tool with changed schema/description

- **`McpResolvedCredential` shape defined** (lines 369-378): Complete interface with `accessToken`, `expiresAt`, `refreshToken?`, `tokenType?`, `scopes?`. Explicitly notes fake implementations may use sentinel values and production must use encrypted storage.

- **Resource URI prefix defaults explicit** (lines 381-384): "If `allowedResourceUriPrefixes` is absent, resource reads are denied by default." No fallback to endpoint origin for V0. Providers must explicitly opt in.

### Fixed

- **Medium → Fixed**: Drift detection shape now fully specified with 5 concrete conditions triggering `MCP_PROVIDER_TOOL_DRIFT`.

- **Medium → Fixed**: `McpResolvedCredential` interface now defined with complete shape for fake/production alignment.

- **Medium → Fixed**: `allowedResourceUriPrefixes` fallback now explicitly denies all resource reads when absent.

### Blocker

- None.

### High

- None.

### Medium

- None. All pass4 medium items have been addressed.

---

**Verdict: GREEN** (clean — all prior medium issues resolved; no new blockers/highs/mediums)
