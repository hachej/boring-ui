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
| `AGENT_FLEET_PLUGIN_UNKNOWN` | Agent fleet configuration references a plugin that the app did not load | 500 | fix app configuration | error | stable (trusted API) |
| `AGENT_FLEET_CONFIG_BINDING_UNKNOWN` | Agent fleet configuration passes a plugin config key outside its declared Agent config contract | 500 | fix app configuration | error | stable (trusted API) |
| `AGENT_FLEET_MODEL_POLICY_UNCOMPILED` | Agent fleet configuration declares a model policy that the app fleet compiler did not resolve | 500 | configure app fleet compiler | error | stable (trusted API) |
| `AGENT_FLEET_SEAT_PERSONA_INVALID` | `loadConfiguredAgentFleet` excluded a fleet.yaml seat because its persona package failed to materialize or compose | 500 | fix persona package/spec | error | stable (trusted API) |
| `AGENT_FLEET_SEAT_SKILL_DIGEST_MISMATCH` | `loadConfiguredAgentFleet` excluded a fleet.yaml seat because a pinned skill's canonical content was unavailable or its digest drifted | 500 | run `pnpm write:skill-digests` or fix the skill file | error | stable (trusted API) |
| `AGENT_FLEET_SEAT_INSTRUCTIONS_PATH_UNPUBLISHABLE` | `loadConfiguredAgentFleet` composed a fleet.yaml seat but withheld the link to its persona `instructions.md`. Usually because the host serves a workspace root that does not contain the personas tree (multi-workspace hosts resolve a root per request and pass `workspaceRoot: null`); rarely because the seat name is not a safe path segment | 500 | expected on multi-workspace hosts — the seat runs normally, only the Agent-details instruction link is withheld. On a single-root host, check that `workspaceRoot` is the root the `user` filesystem serves and contains `personasDir`. If the message names the seat, rename it to `[A-Za-z0-9][A-Za-z0-9._-]*` | warn | stable (trusted API) |
| `AGENT_FLEET_CONFIG_FILE_INVALID` | `loadConfiguredAgentFleet`'s fleet.yaml could not be read, parsed, or validated (whole-fleet failure, not per-seat) | 500 | fix `.agents/factory/fleet.yaml` | error | stable (trusted API) |
| `AGENT_DEFINITION_ID_CONFLICT` | Multiple discovered plugin packages claim the same agent definition id, so every claimant is excluded | 500 | remove or rename conflicting definitions | error | stable (trusted API) |
| `AGENT_DEFINITION_UNSEATED` | A discovered agent package is not named by the fleet roster and remains inert | 200 | seat it in class-B fleet config if activation is intended | info | stable (trusted API) |
| `RUNTIME_PROVISIONING_FAILED` | Agent runtime dependency provisioning failed before Level 3 runtime dependencies became ready | 503 | retry/report | error | stable (public API) |
| `RUNTIME_PROVISIONING_LOCKED` | Agent runtime provisioning is locked by another reconciler | 423 | retry | warn | stable (public API) |
| `BWRAP_UNAVAILABLE` | `bwrap` binary not found | 500 | report-bug | error | stable (public API) |
| `BWRAP_TIMEOUT` | Sandbox command exceeded timeout | 408 | retry | warn | stable (public API) |
| `OUTPUT_TRUNCATED` | Max output bytes reached; output was clipped | 200 | user-fix | warn | stable (public API) |
| `SANDBOX_NOT_READY` | Remote sandbox cold start / provisioning | 503 | retry | warn | stable (public API) |
| `SANDBOX_EXPIRED` | Remote sandbox TTL elapsed | 410 | retry | warn | stable (public API) |
| `VERCEL_API_ERROR` | Generic upstream Vercel SDK/API failure | 502 | retry | error | stable (public API) |
| `REMOTE_WORKER_CONFIG_INVALID` | Static remote-worker fleet configuration is invalid or incomplete | 500 | report-bug | error | stable (trusted API) |
| `REMOTE_WORKER_PROTOCOL_MISMATCH` | Worker protocol or provider-contract version differs from the configured V1 cohort | 502 | operator-fix | error | stable (trusted API) |
| `REMOTE_WORKER_UNAUTHENTICATED` | Worker rejected the per-box capability or authenticated receipt | 401 | operator-fix | warn | stable (trusted API) |
| `REMOTE_WORKER_UNAVAILABLE` | The statically owning worker cannot serve the request; no fallback is attempted | 503 | retry | warn | stable (public API) |
| `REMOTE_WORKER_UNQUALIFIED` | Worker qualification or artifact facts do not match static placement config | 503 | operator-fix | error | stable (trusted API) |
| `REMOTE_WORKER_REQUEST_INVALID` | A strict remote-worker request schema rejected the request | 400 | report-bug | warn | stable (trusted API) |
| `REMOTE_WORKER_RESPONSE_INVALID` | A strict remote-worker response schema rejected the worker response | 502 | operator-fix | error | stable (trusted API) |
| `REMOTE_WORKER_CAPABILITY_EXPIRED` | A short-lived worker capability expired or exceeded its maximum lifetime | 401 | retry | warn | stable (trusted API) |
| `REMOTE_WORKER_CAPABILITY_REPLAY` | A single-use worker capability nonce was presented more than once | 409 | report-security | warn | stable (trusted API) |
| `REMOTE_WORKER_CAPABILITY_NONCE_STORE_EXHAUSTED` | Worker cannot accept another capability without violating its bounded nonce history | 503 | retry | warn | stable (trusted API) |
| `REMOTE_WORKER_AUTHORIZED_WORKSPACE_REQUIRED` | Remote provider creation lacked an authenticated workspace identity | 403 | report-bug | warn | stable (trusted API) |
| `REMOTE_WORKER_BINDING_RECEIPT_INVALID` | Create returned an unauthenticated or mismatched sandbox/workspace binding receipt | 502 | operator-fix | error | stable (trusted API) |
| `REMOTE_WORKER_SANDBOX_WORKSPACE_MISMATCH` | Authorized workspace capability does not match the immutable sandbox lease binding | 404 | report-security | warn | stable (trusted API) |
| `REMOTE_WORKER_SANDBOX_NOT_FOUND` | Addressed remote sandbox lease does not exist | 404 | reacquire | warn | stable (trusted API) |
| `REMOTE_WORKER_SANDBOX_EXPIRED` | Addressed remote sandbox lease has expired | 410 | reacquire | warn | stable (trusted API) |
| `REMOTE_WORKER_SANDBOX_DISPOSED` | Addressed remote sandbox lease was already disposed | 410 | reacquire | warn | stable (trusted API) |
| `REMOTE_WORKER_CREATE_CONCURRENCY_EXHAUSTED` | Worker create concurrency is exhausted | 429 | retry | warn | stable (trusted API) |
| `REMOTE_WORKER_EXEC_CONCURRENCY_EXHAUSTED` | Worker execution concurrency is exhausted | 429 | retry | warn | stable (trusted API) |
| `REMOTE_WORKER_IDEMPOTENCY_CONFLICT` | Reused lease/invocation id has a different request digest | 409 | report-bug | warn | stable (trusted API) |
| `REMOTE_WORKER_EXEC_IN_PROGRESS` | Duplicate invocation is still executing | 409 | retry | warn | stable (trusted API) |
| `REMOTE_WORKER_SECRET_INVOCATION_NOT_REPLAYABLE` | Completed secret-bearing invocation cannot replay cached output | 409 | start-new-request | warn | stable (trusted API) |
| `REMOTE_WORKER_SECRET_REFERENCE_REJECTED` | Invocation secret metadata is invalid, cross-workspace, or classified as a model credential | 403 | report-bug | warn | stable (trusted API) |
| `REMOTE_WORKER_EXEC_ABORTED` | Invocation was aborted after bounded in-sandbox cleanup | 499 | retry | warn | stable (trusted API) |
| `REMOTE_WORKER_OUTPUT_LIMIT` | Invocation output exceeded its configured combined byte ceiling | 413 | reduce-output | warn | stable (trusted API) |
| `REMOTE_WORKER_PATH_UNSAFE` | Workspace operation failed dirfd-relative path confinement | 400 | report-bug | warn | stable (trusted API) |
| `REMOTE_WORKER_PATH_PRIMITIVE_UNAVAILABLE` | Required dirfd/openat2 containment primitive is unavailable | 503 | operator-fix | error | stable (trusted API) |
| `REMOTE_WORKER_QUOTA_EXCEEDED` | Fixed workspace byte or inode quota was exceeded | 507 | free-space | warn | stable (trusted API) |
| `REMOTE_WORKER_OUTCOME_UNKNOWN` | Worker loss left an effectful invocation outcome unknown; no automatic replay is safe | 502 | inspect-before-retry | error | stable (public API) |
| `REMOTE_WORKER_INCOMPLETE_CLEANUP` | Provider could not prove remote lease teardown after bounded retries | 502 | operator-fix | error | stable (trusted API) |
| `REMOTE_WORKER_DOCKER_COMMAND_FAILED` | Worker runtime command failed without exposing infrastructure stderr | 502 | operator-fix | error | stable (trusted API) |
| `REMOTE_WORKER_TIMEOUT` | Remote worker request exceeded its client-side timeout before a response arrived | 504 | retry | warn | stable (public API) |
| `REMOTE_WORKER_STREAM_CLOSED` | Remote worker filesystem event stream closed unexpectedly | 502 | retry | warn | stable (public API) |
| `CIRCUIT_OPEN` | Circuit breaker open; request fast-failed | 503 | retry | warn | stable (public API) |
| `ABORTED` | Request cancelled via `AbortSignal` | 499 | retry | warn | stable (public API) |
| `PAYMENT_REQUIRED` | Billing/metering sink rejected the run (e.g. credits exhausted) | 402 | user-fix | warn | stable (public API) |
| `MODEL_BUDGET_EXCEEDED` | Governance model budget for this user/model is exhausted | 402 | user-fix | warn | stable (public API) |
| `METERING_UNSUPPORTED_COMMAND` | Slash-command execution is disabled because metering cannot yet reserve/settle that path | 409 | user-fix | warn | stable (public API) |
| `SESSION_NOT_FOUND` | Session id does not exist | 404 | user-fix | warn | stable (public API) |
| `SESSION_LOCKED` | Session currently locked by concurrent writer | 409 | retry | warn | stable (public API) |
| `SESSION_TRANSCRIPT_UNREADABLE` | Canonical native session transcript exists but cannot be opened safely | 500 | retry | error | stable (public API) |
| `STREAM_BUFFER_EVICTED` | Resume cursor evicted from in-memory stream buffer | 410 | retry | warn | stable (public API) |
| `CURSOR_OUT_OF_RANGE` | Resume cursor invalid/out of range | 416 | user-fix | warn | stable (public API) |
| `BRIDGE_COMMAND_INVALID` | UI bridge command kind/params invalid | 400 | user-fix | warn | stable (public API) |
| `TOOL_NOT_FOUND` | Requested tool name not present in catalog | 404 | user-fix | warn | stable (public API) |
| `TOOL_INVALID_INPUT` | Tool input fails schema validation | 400 | user-fix | warn | stable (public API) |
| `TOOL_EXECUTION_ERROR` | Tool threw or returned execution failure | 500 | report-bug | error | stable (public API) |
| `AUTHORED_AGENT_ID_INVALID` | Authored agent materialization received an agent type id outside the product-safe grammar | 400 | user-fix | warn | stable (trusted API) |
| `AUTHORED_AGENT_TYPE_MISMATCH` | Trusted host expected one authored agent type but the directory declares another | 409 | user-fix | warn | stable (trusted API) |
| `AUTHORED_AGENT_REFERENCE_UNSUPPORTED` | Authored source contains a non-empty legacy capability/tool/skill/MCP selector; move behavior to trusted host plugins | 400 | user-fix | warn | stable migration error |
| `AUTHORED_AGENT_TOOL_COLLISION` | Normal trusted tool composition produced duplicate or colliding tool names | 409 | user-fix | warn | stable (trusted API) |
| `MCP_AGENT_ARTIFACT_INVALID` | Managed MCP delivery artifact is path-shaped, non-Markdown, binary, malformed UTF-8, or otherwise invalid | 400 | user-fix | warn | stable (public API) |
| `MCP_AGENT_ARTIFACT_TOO_LARGE` | Managed MCP final text, inline Markdown artifact, or serialized result exceeds the delivery v0 byte cap | 413 | user-fix | warn | stable (public API) |
| `MCP_AGENT_ARTIFACT_UNAVAILABLE` | Managed MCP artifact is missing, unreadable through the authorized workspace, or changed during read | 409 | retry | warn | stable (public API) |
| `AGENT_MCP_GRANT_REF_UNGRANTED` | Agent declared an `mcpServerRefs` connector with no matching per-agent MCP grant in the workspace; the connector is dropped, never silently allowed | 200 | user-fix | warn | stable (public API) |
| `AGENT_MCP_GRANT_TOOL_NOT_ALLOWED` | A grant's `allowedTools` entry is not part of the connector's known tool catalog and was dropped during resolution | 200 | user-fix | warn | stable (public API) |
| `AGENT_MCP_GRANT_RECORD_MALFORMED` | A persisted MCP grant record has a missing or malformed config and was skipped rather than crashing the workspace's grant listing | 200 | user-fix | warn | stable (public API) |
| `AGENT_MCP_GRANT_CONNECTOR_UNKNOWN` | A grant's connector is unknown to the supplied connector catalog; the connector is denied rather than left unfiltered | 200 | user-fix | warn | stable (public API) |
| `AGENT_MCP_GRANT_TOOL_NAME_INVALID` | A grant's `allowedTools` entry contains a glob metacharacter (e.g. `*`), which is rejected at write time so it can never be misinterpreted as a wildcard downstream | 400 | user-fix | warn | stable (public API) |
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
| `SKILL_DISCOVERY_FAILED` | Skill discovery failed without exposing package-manager or host-path details | 200 | retry | warn | stable (public API) |
| `PACKAGE_RESOURCE_INVALID` | A declared or scanned package resource (skill/agent) failed validation | 400 | user-fix | warn | stable (public API) |
| `PACKAGE_RESOURCE_CONFLICT` | Two package resources claim the same identity/path | 409 | user-fix | warn | stable (public API) |
| `RUNTIME_FILESYSTEM_BINDING_DUPLICATE` | A filesystem id was bound more than once while merging host/request-scoped runtime filesystem bindings | 500 | report-bug | error | stable (public API) |
| `RUNTIME_READONLY_FILESYSTEM_POLICY_INVALID` | A readonly primary-workspace path is not a normalized workspace-relative path | 400 | user-fix | warn | stable (public API) |
| `EVENT_STORE_OPEN_FAILED` | `BORING_CHAT_DURABLE_STREAM=1` but the SQLite event-stream store could not be opened: either no host-resolvable root exists (no `sessionRoot` and no host storage root — this deliberately never falls back to an in-sandbox/guest path) or `openDatabase` failed at the resolved path (bad path/permissions); reported via telemetry alongside `DURABLE_STREAM_UNAVAILABLE` | n/a (boot-time diagnostic, not an HTTP response) | report-bug | error | stable (public API) |
| `DURABLE_STREAM_UNAVAILABLE` | `BORING_CHAT_DURABLE_STREAM=1` but the durable event-stream store could not be opened; boot fails loudly with the underlying cause instead of silently falling back to in-memory streaming (flag off = in-memory, unchanged) | n/a (boot-time failure, not an HTTP response) | user-fix | error | stable (public API) |
| `ERR_NOT_IMPLEMENTED_UNTIL_T1` | Headless core method exists but the durable T1 implementation has not landed yet | 501 | retry-after-upgrade | warn | stable (public API) |
| `INTERNAL_ERROR` | Catch-all internal failure | 500 | report-bug | error | internal (may change) |
| `AR1_SHARE_NOT_FOUND` | `GET /a/:id` deep link: no such Lane W share entry, or the entry belongs to a workspace the requester is not authorized/scoped to (identical response either way — no existence oracle) | 404 | user-fix | warn | stable (public API) |
| `AR1_SHARE_TOMBSTONED` | `GET /a/:id` deep link: share entry exists but its target file is gone; response renders provenance + last-known metadata, never a bare 404 | 200 | user-fix | warn | stable (public API) |

## Credential registry

Credential failures use their own stable enum, `CREDENTIAL_ERROR_CODES` in
`src/shared/credentials/errors.ts`, surfaced as `CredentialResolutionError.code`.
These are trusted-API codes: messages are metadata only and never carry a
credential value, a workspace DEK, or KEK material.

| Code | When it fires | HTTP status | Suggested client action | Log level | Stability |
| --- | --- | --- | --- | --- | --- |
| `CREDENTIAL_PROVIDER_UNKNOWN` | The referenced provider is not in the startup provider registry | 404 | report-bug | warn | stable (trusted API) |
| `CREDENTIAL_NOT_CONFIGURED` | No credential material is configured for that workspace/provider, or a required registered field is absent | 404 | user-fix (connect the provider) | warn | stable (trusted API) |
| `CREDENTIAL_DISABLED` | The workspace credential exists but is administratively disabled | 403 | user-fix | warn | stable (trusted API) |
| `CREDENTIAL_REVOKED` | The workspace credential was revoked; no fallback is attempted | 403 | user-fix (reconnect) | warn | stable (trusted API) |
| `CREDENTIAL_FORBIDDEN` | The verified principal may not use this credential | 403 | user-fix | warn | stable (trusted API) |
| `CREDENTIAL_WORKSPACE_MISMATCH` | A credential artifact does not belong to the authority-verified workspace | 403 | report-bug | error | stable (trusted API) |
| `CREDENTIAL_CONSUMER_MISMATCH` | A reference, binding, and provider triple disagree, or the binding is not registered for its provider | 403 | report-bug | warn | stable (trusted API) |
| `CREDENTIAL_DELIVERY_FORBIDDEN` | The requested delivery channel is not permitted for that binding, or a lease was serialized | 403 | report-bug | error | stable (trusted API) |
| `CREDENTIAL_AUTHORITY_INVALID` | The workspace credential authority is unissued, copied, or expired | 403 | re-auth | warn | stable (trusted API) |
| `CREDENTIAL_SCHEMA_MISMATCH` | A credential reference, registry/binding definition, KEK context, or envelope AAD context failed strict validation | 400 | report-bug | warn | stable (trusted API) |
| `CREDENTIAL_UNREADABLE` | A credential envelope or wrapped workspace DEK failed AES-256-GCM authentication — tampered ciphertext/nonce/tag, a swapped AAD component, a wrong KEK, or another backend's envelope. Never treated as "absent" | 500 | operator-fix | error | stable (trusted API) |
| `CREDENTIAL_BACKEND_UNAVAILABLE` | The credential store or its KEK provider reported not-ready or failed unexpectedly; the operation fails closed with no fallback | 503 | retry/operator-fix | error | stable (trusted API) |
| `CREDENTIAL_KEK_UNAVAILABLE` | The configured KEK source is missing, unreadable, or the wrong length, so no workspace DEK could be wrapped or unwrapped. Never falls back to another backend or to plaintext | 503 | operator-fix (mount/repair the sealed KEK file) | error | stable (trusted API) |
| `CREDENTIAL_LEASE_EXPIRED` | A resolved credential lease was used after disposal or expiry | 410 | resolve a fresh lease | warn | stable (trusted API) |
| `CREDENTIAL_OAUTH_STATE_INVALID` | A one-use OAuth state transaction was unknown, replayed, or expired | 400 | restart the connect flow | warn | stable (trusted API) |
| `CREDENTIAL_OAUTH_REFRESH_FAILED` | Upstream refused a refresh-token exchange | 401 | re-auth | warn | stable (trusted API) |

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
