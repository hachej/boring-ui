# Core DB Telemetry Plan for boring-ui-v2

**Decision:** v1 telemetry stores sanitized server-side events in the core database. No PostHog, no browser endpoint, no external telemetry vendor.

## Common path

Child apps that use `createCoreWorkspaceAgentServer()` enable telemetry with one env var:

```bash
BORING_TELEMETRY_ENABLED=true
```

If the env var is omitted or set to anything else, telemetry is a no-op. Core uses `CoreConfig.appId` as the `app_id` column, so several apps sharing one database can still filter their own events.

## Boundaries

- `@hachej/boring-core` owns persistence and sanitization.
- `@hachej/boring-agent` and `@hachej/boring-workspace` stay DB/vendor-free.
- Agent/workspace receive only a tiny structural `TelemetrySink` with `capture()` and optional `flush()`.
- Standalone agent remains no-op unless an embedder injects a sink.

## Data model

Table: `telemetry_events`

| Column | Purpose |
|---|---|
| `id` | row id |
| `app_id` | `CoreConfig.appId` |
| `event_name` | sanitized event name, e.g. `agent.chat.started` |
| `distinct_id` | sanitized user id or `anonymous` |
| `properties` | sanitized low-cardinality metadata JSON |
| `created_at` | insert timestamp |

Indexes:

- `(app_id, created_at)` for app-scoped time windows
- `event_name` for event filtering

## V1 events

| Area | Events |
|---|---|
| Core | `app.opened`, `server.request.failed` |
| Agent chat | `agent.chat.started`, `agent.chat.message.submitted`, `agent.chat.completed`, `agent.chat.failed` |
| Agent tools | `agent.tool.completed`, `agent.tool.failed` |

Workspace browser/frontend events are deferred.

## Allowed properties

Only these low-cardinality properties are stored:

- `workspaceId`
- `sessionId`
- `requestId`
- `runtimeMode`
- `modelProvider`
- `toolName`
- `panelId`
- `commandId`
- `status`
- `durationMs`
- `errorCode`
- `packageName`
- `packageVersion`

Unknown keys are dropped.

## Privacy exclusions

Never capture:

- prompts
- assistant output
- file contents
- command strings
- stdout/stderr
- raw file paths
- raw errors or stack traces
- headers/cookies/tokens
- env dumps
- secrets

The DB sink sanitizes event names, distinct ids, and properties centrally before insertion. Insert failures are swallowed so telemetry never changes product behavior.

## Deferred

- Browser-originated telemetry
- Workspace frontend events
- Auth hook telemetry
- Plugin-error telemetry
- UI-command telemetry
- Tool-started events
- External SaaS adapters
- OpenTelemetry/OTLP
- Retention/cleanup policy
- Lifecycle flush wiring

## Validation

```bash
pnpm --filter @hachej/boring-core test src/shared/__tests__/telemetry.test.ts src/server/telemetry/__tests__ src/app/server/__tests__/createCoreWorkspaceAgentServer.telemetry.test.ts src/app/server/__tests__/createCoreWorkspaceAgentServer.telemetry-smoke.test.ts
pnpm --filter @hachej/boring-agent test src/shared/__tests__/telemetry.test.ts src/server/http/routes/__tests__/chat.test.ts src/server/harness/pi-coding-agent/__tests__/tool-adapter.telemetry.test.ts src/server/__tests__/createAgentApp.test.ts
pnpm --filter @hachej/boring-workspace test src/shared/__tests__/telemetry.test.ts
pnpm lint:invariants
```
