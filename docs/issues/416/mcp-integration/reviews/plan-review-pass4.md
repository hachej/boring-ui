## Review

### Correct
- Clear foundation vs hosted OAuth scope split; deferrals are explicit.
- Security posture: deny-by-default, read-only default, tool name validation, redaction guard interface.
- Status/doctor/probe lifecycle is well-scoped and OpenClaw-aligned.
- Provider template registry shape is coherent; `toolClassifications` as single source of truth.
- Interfaces (`McpRedactionGuard`, `McpCredentialProvider`, `McpToolClassification`, `McpExecutionGuard`) are minimal and testable.
- Error code list is comprehensive for V0.

### Blocker
- None.

### High
- None.

### Medium
- **Drift detection shape undefined**: `MCP_PROVIDER_TOOL_DRIFT` error code exists but the plan does not specify what constitutes drift (schema hash only? tool list changes? both?). Recommendation: add a `schemaHash` comparison rule and specify that tool-list additions/removals also trigger drift.
- **`McpResolvedCredential` shape missing**: The credential provider interface references `McpResolvedCredential` but its structure is not defined. Recommendation: add a minimal shape definition (e.g., `{ accessToken: string, expiresAt: number, refreshToken?: string }`) to ensure fake/production implementations align.
- **`allowedResourceUriPrefixes` fallback undefined**: This field is optional but there is no guidance on default behavior if absent. Recommendation: specify that absent value defaults to the provider endpoint origin or denies all resource URIs.

### Note
- Manual classification workflow is appropriate for V0; ensure operational docs cover the admin review cadence once shipped.
- Rate-limit/breaker hooks are correctly deferred as no-op; verify tests assert they do not bypass security checks when implemented.

---
**Verdict: GREEN** (3 medium issues documented; no blockers/highs)
