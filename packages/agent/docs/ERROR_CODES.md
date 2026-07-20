# ERROR_CODES

Canonical registry for stable `@hachej/boring-agent` error codes.

All API failures must use the response envelope:

```json
{
  "error": {
    "code": "PATH_ESCAPE",
    "message": "Path '../secrets' escapes workspace root",
    "details": {
      "path": "../secrets",
      "workspaceRoot": "/tmp/ws"
    }
  }
}
```

## Registry

| Code | When it fires | HTTP status | Suggested client action | Log level | Stability |
| --- | --- | --- | --- | --- | --- |
| `UNAUTHORIZED` | Request reached a protected path (e.g. credit metering) without an authenticated user | 401 | re-auth | warn | stable (public API) |
| `MISSING_API_KEY` | Required provider API key missing from runtime config | 500 | report-bug | error | stable (public API) |
| `INVALID_API_KEY` | Provider rejects API key as malformed/invalid | 401 | re-auth | warn | stable (public API) |
| `OIDC_REFRESH_FAILED` | OIDC refresh token exchange fails | 401 | re-auth | warn | stable (public API) |
| `VERCEL_AUTH_FAILED` | Vercel sandbox auth/token request fails | 401 | re-auth | warn | stable (public API) |
| `CONFIG_INVALID` | Runtime config fails schema validation | 500 | report-bug | error | stable (public API) |
| `PATH_ESCAPE` | Relative path escapes workspace root | 403 | user-fix | warn | stable (public API) |
| `PATH_ABSOLUTE` | Absolute path rejected where relative path is required | 400 | user-fix | warn | stable (public API) |
| `PATH_NULL_BYTE` | Path contains a null byte | 400 | user-fix | warn | stable (public API) |
| `PATH_SYMLINK_ESCAPE` | Realpath resolves outside workspace root | 403 | user-fix | warn | stable (public API) |
| `PATH_NOT_FOUND` | Read/stat/load targets missing path | 404 | user-fix | warn | stable (public API) |
| `PATH_NOT_WRITABLE` | Path parent missing or write denied | 403 | user-fix | warn | stable (public API) |
| `WORKSPACE_UNINITIALIZED` | Workspace adapter/store not initialized yet | 503 | retry | warn | stable (public API) |
| `WORKSPACE_NOT_READY` | Workspace substrate (`workspace-fs`, `sandbox-exec`, or `ui-bridge`) is still preparing | 503 | retry | warn | stable (public API) |
| `AGENT_HOST_SCOPE_VIOLATION` | Presented workspace selector conflicts with the trusted dedicated-host request scope | 421 | user-fix | warn | stable (public API) |
| `AGENT_RUNTIME_NOT_READY` | Selected workspace runtime dependencies (`runtime-dependencies` or `runtime:<name>`, e.g. `runtime:python`/`runtime:node`) are still preparing | 503 | retry | warn | stable (public API) |
| `AGENT_BINDING_DISPOSED` | A caller retained an agent binding after its host retired it | 410 | resolve a fresh binding | warn | stable (trusted API) |
| `AGENT_CONTROL_RECEIPT_INVALID` | The existing agent runtime returned a malformed interrupt/stop receipt through the trusted dispatcher | 500 | report-bug | error | stable (trusted API) |
| `RUNTIME_PROVISIONING_FAILED` | Agent runtime dependency provisioning failed before Level 3 runtime dependencies became ready | 503 | retry/report | error | stable (public API) |
| `RUNTIME_PROVISIONING_LOCKED` | Agent runtime provisioning is locked by another reconciler | 423 | retry | warn | stable (public API) |
| `BWRAP_UNAVAILABLE` | `bwrap` binary not found | 500 | report-bug | error | stable (public API) |
| `BWRAP_TIMEOUT` | Sandbox command exceeded timeout | 408 | retry | warn | stable (public API) |
| `OUTPUT_TRUNCATED` | Max output bytes reached; output was clipped | 200 | user-fix | warn | stable (public API) |
| `SANDBOX_NOT_READY` | Remote sandbox cold start / provisioning | 503 | retry | warn | stable (public API) |
| `SANDBOX_EXPIRED` | Remote sandbox TTL elapsed | 410 | retry | warn | stable (public API) |
| `VERCEL_API_ERROR` | Generic upstream Vercel SDK/API failure | 502 | retry | error | stable (public API) |
| `REMOTE_WORKER_TIMEOUT` | Remote worker request exceeded its client-side timeout before a response arrived | 504 | retry | warn | stable (public API) |
| `REMOTE_WORKER_STREAM_CLOSED` | Remote worker filesystem event stream closed unexpectedly | 502 | retry | warn | stable (public API) |
| `CIRCUIT_OPEN` | Circuit breaker open; request fast-failed | 503 | retry | warn | stable (public API) |
| `ABORTED` | Request cancelled via `AbortSignal` | 499 | retry | warn | stable (public API) |
| `PAYMENT_REQUIRED` | Billing/metering sink rejected the run (e.g. credits exhausted) | 402 | user-fix | warn | stable (public API) |
| `MODEL_BUDGET_EXCEEDED` | Governance model budget for this user/model is exhausted | 402 | user-fix | warn | stable (public API) |
| `METERING_UNSUPPORTED_COMMAND` | Slash-command execution is disabled because metering cannot yet reserve/settle that path | 409 | user-fix | warn | stable (public API) |
| `SESSION_NOT_FOUND` | Session id does not exist | 404 | user-fix | warn | stable (public API) |
| `SESSION_LOCKED` | Session currently locked by concurrent writer | 409 | retry | warn | stable (public API) |
| `NATIVE_SESSION_START_OUTCOME_UNKNOWN` | Native first-session creation remained unconfirmed after its reconciliation retry | 409 | delete local draft before retrying | warn | stable (public API) |
| `STREAM_BUFFER_EVICTED` | Resume cursor evicted from in-memory stream buffer | 410 | retry | warn | stable (public API) |
| `CURSOR_OUT_OF_RANGE` | Resume cursor invalid/out of range | 416 | user-fix | warn | stable (public API) |
| `BRIDGE_COMMAND_INVALID` | UI bridge command kind/params invalid | 400 | user-fix | warn | stable (public API) |
| `TOOL_NOT_FOUND` | Requested tool name not present in catalog | 404 | user-fix | warn | stable (public API) |
| `TOOL_INVALID_INPUT` | Tool input fails schema validation | 400 | user-fix | warn | stable (public API) |
| `TOOL_EXECUTION_ERROR` | Tool threw or returned execution failure | 500 | report-bug | error | stable (public API) |
| `AUTHORED_AGENT_ID_INVALID` | Authored agent materialization received an agent type id outside the product-safe grammar | 400 | user-fix | warn | stable (trusted API) |
| `AUTHORED_AGENT_TYPE_MISMATCH` | Trusted host expected one authored agent type but the directory declares another | 409 | user-fix | warn | stable (trusted API) |
| `AUTHORED_AGENT_CATALOG_REQUIRED` | Authored tool refs are present before a trusted server catalog resolver is available | 400 | user-fix | warn | stable (trusted API) |
| `AUTHORED_AGENT_CATALOG_INVALID` | Trusted authored-tool catalog failed while resolving a declared tool reference | 500 | report-bug | error | stable (trusted API) |
| `AUTHORED_AGENT_REFERENCE_UNKNOWN` | Authored agent materialization could not resolve a declared trusted reference | 400 | user-fix | warn | stable (trusted API) |
| `AUTHORED_AGENT_REFERENCE_UNSUPPORTED` | Authored agent materialization received non-empty reference families unsupported by v1 | 400 | user-fix | warn | stable (trusted API) |
| `AUTHORED_AGENT_TOOL_INVALID` | Trusted authored-tool catalog resolution produced a tool that fails authored-tool validation | 500 | report-bug | error | stable (trusted API) |
| `AUTHORED_AGENT_TOOL_COLLISION` | Trusted authored-tool resolution produced duplicate or colliding tool names | 409 | user-fix | warn | stable (trusted API) |
| `MCP_AGENT_ARTIFACT_INVALID` | Managed MCP delivery artifact is path-shaped, non-Markdown, binary, malformed UTF-8, or otherwise invalid | 400 | user-fix | warn | stable (public API) |
| `MCP_AGENT_ARTIFACT_TOO_LARGE` | Managed MCP final text, inline Markdown artifact, or serialized result exceeds the delivery v0 byte cap | 413 | user-fix | warn | stable (public API) |
| `MCP_AGENT_ARTIFACT_UNAVAILABLE` | Managed MCP artifact is missing, unreadable through the authorized workspace, or changed during read | 409 | retry | warn | stable (public API) |
| `PLUGIN_LOAD_FAILED` | Plugin failed to load/register | 500 | report-bug | error | stable (public API) |
| `PLUGIN_NAME_COLLISION` | Plugin name collides with existing tool/plugin | 409 | user-fix | warn | stable (public API) |
| `PLUGIN_RUNTIME_REVISION_MISMATCH` | Browser requested a stale plugin runtime revision after reload | 409 | retry | warn | stable (public API) |
| `PLUGIN_RUNTIME_PRIVATE_FILE` | Plugin runtime request targeted a disallowed private/non-front file | 403 | user-fix | warn | stable (public API) |
| `PLUGIN_RUNTIME_UNSAFE_IMPORT` | Plugin frontend import is browser-unsafe or bypasses the host runtime surface | 400 | user-fix | warn | stable (public API) |
| `PLUGIN_RUNTIME_TRANSFORM_FAILED` | Host runtime could not transform the plugin frontend module graph | 500 | report-bug | error | stable (public API) |
| `RUNTIME_PLUGIN_NOT_FOUND` | Runtime backend gateway could not find a live plugin snapshot | 404 | user-fix | warn | stable (public API) |
| `RUNTIME_PLUGIN_ROUTE_NOT_FOUND` | Runtime backend gateway could not match an exact plugin-owned route | 404 | user-fix | warn | stable (public API) |
| `RUNTIME_PLUGIN_HANDLER_FAILED` | Runtime backend handler threw while serving a plugin-owned route | 500 | report-bug | error | stable (public API) |
| `RUNTIME_PLUGIN_LOAD_FAILED` | Runtime backend module failed to import, validate, capture, or dispose | 500 | report-bug | error | stable (public API) |
| `RUNTIME_PLUGIN_RESPONSE_UNSUPPORTED` | Runtime backend handler returned an unsupported response value | 500 | report-bug | error | stable (public API) |
| `PROVISIONING_LAYOUT_FAILED` | Failed to create/write generated `.boring-agent` layout | 500 | report-bug | error | stable (public API) |
| `PROVISIONING_SKILLS_FAILED` | Failed to mirror plugin skills into `.boring-agent/skills` | 500 | report-bug | error | stable (public API) |
| `PROVISIONING_TEMPLATES_FAILED` | Failed to seed missing workspace template files | 500 | report-bug | error | stable (public API) |
| `PROVISIONING_NODE_PREFLIGHT_FAILED` | Node/npm preflight failed before runtime package install | 500 | user-fix | error | stable (public API) |
| `PROVISIONING_NPM_INSTALL_FAILED` | npm runtime package install failed | 500 | user-fix | error | stable (public API) |
| `PROVISIONING_UV_BOOTSTRAP_FAILED` | uv bootstrap/preflight failed for Python runtime packages | 500 | user-fix | error | stable (public API) |
| `PROVISIONING_UV_INSTALL_FAILED` | uv venv or uv pip install failed | 500 | user-fix | error | stable (public API) |
| `PROVISIONING_ARTIFACT_FAILED` | Runtime-mode adapter failed to prepare/upload install artifact | 500 | retry | error | stable (public API) |
| `ERR_NOT_IMPLEMENTED_UNTIL_T1` | Headless core method exists but the durable T1 implementation has not landed yet | 501 | retry-after-upgrade | warn | stable (public API) |
| `INTERNAL_ERROR` | Catch-all internal failure | 500 | report-bug | error | internal (may change) |
| `AR1_SHARE_NOT_FOUND` | `GET /a/:id` deep link: no such Lane W share entry, or the entry belongs to a workspace the requester is not authorized/scoped to (identical response either way — no existence oracle) | 404 | user-fix | warn | stable (public API) |
| `AR1_SHARE_TOMBSTONED` | `GET /a/:id` deep link: share entry exists but its target file is gone; response renders provenance + last-known metadata, never a bare 404 | 200 | user-fix | warn | stable (public API) |

## Readiness error details

`WORKSPACE_NOT_READY` is reserved for workspace substrate requirements:

```json
{
  "code": "WORKSPACE_NOT_READY",
  "retryable": true,
  "requirement": "workspace-fs"
}
```

Runtime dependency preparation is separate so chat/file work can continue while `.boring-agent` dependencies install:

```json
{
  "code": "AGENT_RUNTIME_NOT_READY",
  "retryable": true,
  "requirement": "runtime:python",
  "state": "preparing",
  "workspaceId": "workspace_123"
}
```

If dependency provisioning fails, dependency-backed tools return:

```json
{
  "code": "RUNTIME_PROVISIONING_FAILED",
  "retryable": true,
  "requirement": "runtime:python",
  "state": "failed",
  "causeCode": "PROVISIONING_UV_INSTALL_FAILED"
}
```
