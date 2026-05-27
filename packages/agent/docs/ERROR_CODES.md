# ERROR_CODES

Canonical registry for stable `@boring/agent` error codes.

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
| `BWRAP_UNAVAILABLE` | `bwrap` binary not found | 500 | report-bug | error | stable (public API) |
| `BWRAP_TIMEOUT` | Sandbox command exceeded timeout | 408 | retry | warn | stable (public API) |
| `OUTPUT_TRUNCATED` | Max output bytes reached; output was clipped | 200 | user-fix | warn | stable (public API) |
| `SANDBOX_NOT_READY` | Remote sandbox cold start / provisioning | 503 | retry | warn | stable (public API) |
| `SANDBOX_EXPIRED` | Remote sandbox TTL elapsed | 410 | retry | warn | stable (public API) |
| `VERCEL_API_ERROR` | Generic upstream Vercel SDK/API failure | 502 | retry | error | stable (public API) |
| `CIRCUIT_OPEN` | Circuit breaker open; request fast-failed | 503 | retry | warn | stable (public API) |
| `ABORTED` | Request cancelled via `AbortSignal` | 499 | retry | warn | stable (public API) |
| `SESSION_NOT_FOUND` | Session id does not exist | 404 | user-fix | warn | stable (public API) |
| `SESSION_LOCKED` | Session currently locked by concurrent writer | 409 | retry | warn | stable (public API) |
| `STREAM_BUFFER_EVICTED` | Resume cursor evicted from in-memory stream buffer | 410 | retry | warn | stable (public API) |
| `CURSOR_OUT_OF_RANGE` | Resume cursor invalid/out of range | 416 | user-fix | warn | stable (public API) |
| `BRIDGE_COMMAND_INVALID` | UI bridge command kind/params invalid | 400 | user-fix | warn | stable (public API) |
| `TOOL_NOT_FOUND` | Requested tool name not present in catalog | 404 | user-fix | warn | stable (public API) |
| `TOOL_INVALID_INPUT` | Tool input fails schema validation | 400 | user-fix | warn | stable (public API) |
| `TOOL_EXECUTION_ERROR` | Tool threw or returned execution failure | 500 | report-bug | error | stable (public API) |
| `PLUGIN_LOAD_FAILED` | Plugin failed to load/register | 500 | report-bug | error | stable (public API) |
| `PLUGIN_NAME_COLLISION` | Plugin name collides with existing tool/plugin | 409 | user-fix | warn | stable (public API) |
| `PLUGIN_RUNTIME_REVISION_MISMATCH` | Browser requested a stale plugin runtime revision after reload | 409 | retry | warn | stable (public API) |
| `PLUGIN_RUNTIME_PRIVATE_FILE` | Plugin runtime request targeted a disallowed private/non-front file | 403 | user-fix | warn | stable (public API) |
| `PLUGIN_RUNTIME_UNSAFE_IMPORT` | Plugin frontend import is browser-unsafe or bypasses the host runtime surface | 400 | user-fix | warn | stable (public API) |
| `PLUGIN_RUNTIME_TRANSFORM_FAILED` | Host runtime could not transform the plugin frontend module graph | 500 | report-bug | error | stable (public API) |
| `PROVISIONING_LAYOUT_FAILED` | Failed to create/write generated `.boring-agent` layout | 500 | report-bug | error | stable (public API) |
| `PROVISIONING_SKILLS_FAILED` | Failed to mirror plugin skills into `.boring-agent/skills` | 500 | report-bug | error | stable (public API) |
| `PROVISIONING_TEMPLATES_FAILED` | Failed to seed missing workspace template files | 500 | report-bug | error | stable (public API) |
| `PROVISIONING_NODE_PREFLIGHT_FAILED` | Node/npm preflight failed before runtime package install | 500 | user-fix | error | stable (public API) |
| `PROVISIONING_NPM_INSTALL_FAILED` | npm runtime package install failed | 500 | user-fix | error | stable (public API) |
| `PROVISIONING_UV_BOOTSTRAP_FAILED` | uv bootstrap/preflight failed for Python runtime packages | 500 | user-fix | error | stable (public API) |
| `PROVISIONING_UV_INSTALL_FAILED` | uv venv or uv pip install failed | 500 | user-fix | error | stable (public API) |
| `PROVISIONING_ARTIFACT_FAILED` | Runtime-mode adapter failed to prepare/upload install artifact | 500 | retry | error | stable (public API) |
| `INTERNAL_ERROR` | Catch-all internal failure | 500 | report-bug | error | internal (may change) |
