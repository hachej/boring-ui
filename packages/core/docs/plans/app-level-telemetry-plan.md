# PostHog Telemetry Plan for boring-ui-v2

**Status:** PR 65 rewrite — simplified and coherent  
**Primary decision:** core owns the PostHog env integration. Child apps enable telemetry with env vars only.  
**Last updated:** 2026-05-22

---

## 0. Summary

Telemetry should be boring to use:

```bash
BORING_TELEMETRY_ENABLED=true
POSTHOG_KEY=phc_...
BORING_TELEMETRY_PROJECT=full-app
```

That is the common path. A child app should not need to write PostHog setup code.

If telemetry is not wanted, do nothing. Telemetry is off by default.

```bash
# Either omit BORING_TELEMETRY_ENABLED, or set:
BORING_TELEMETRY_ENABLED=false
```

Core provides the PostHog env helper and wires it into core-composed apps. Agent and workspace stay PostHog-free and receive only a small optional telemetry sink.

---

## 1. Goals

Capture simple product and reliability signals:

- app opened
- workspace opened
- chat session started
- user message submitted, without content
- agent/tool run completed or failed
- workspace panel or command used
- server/frontend error happened, with stable error code only

Support several boring-ui apps using the same PostHog account/project by adding a project prefix/property.

Keep telemetry safe:

- no prompts
- no assistant output
- no file contents
- no command strings
- no stdout/stderr
- no raw paths unless explicitly allowlisted later
- no headers/cookies/tokens/env dumps
- no stack traces by default

---

## 2. Non-goals

Not in this pass:

- Sentry
- OpenTelemetry/OTLP
- billing/metering
- per-tenant PostHog routing
- multiple PostHog accounts selected at runtime
- database-backed analytics storage
- content capture
- complex consent management
- package-level PostHog singletons inside agent/workspace

---

## 3. Architecture decision

### 3.1 Common path: env only

Core-composed apps should automatically create telemetry from env:

```ts
const telemetry = options.telemetry ?? createPostHogTelemetryFromEnv(process.env)
```

Child apps enable telemetry by setting env vars. They do not need to call `createPostHogTelemetryFromEnv()` manually unless they are building a custom composition.

### 3.2 Escape hatch: custom sink

Advanced apps can still pass a custom sink:

```ts
createCoreWorkspaceAgentServer({
  telemetry: myTelemetrySink,
})
```

If `telemetry` is provided, core uses it and does not create the PostHog env sink.

### 3.3 Package boundary

- `@hachej/boring-core` owns the PostHog helper and core-composed wiring.
- `@hachej/boring-agent` does not import PostHog or core.
- `@hachej/boring-workspace` base code does not import PostHog or agent.
- Agent/workspace accept a structural `TelemetrySink` and default to no-op.

---

## 4. Env vars

```bash
# Required to enable telemetry. If unset, telemetry is off.
BORING_TELEMETRY_ENABLED=true

# Required when telemetry is enabled.
POSTHOG_KEY=phc_...

# Optional. Defaults to PostHog Cloud US unless overridden.
POSTHOG_HOST=https://us.i.posthog.com

# Optional. Recommended when several apps share one PostHog account/project.
BORING_TELEMETRY_PROJECT=full-app
```

Behavior:

| Env state | Result |
|---|---|
| `BORING_TELEMETRY_ENABLED` unset | no-op telemetry |
| `BORING_TELEMETRY_ENABLED=false` | no-op telemetry |
| `BORING_TELEMETRY_ENABLED=true`, `POSTHOG_KEY` missing | no-op telemetry, with a safe warning |
| `BORING_TELEMETRY_ENABLED=true`, `POSTHOG_KEY` set | send to PostHog |

Telemetry must be explicit opt-in. `POSTHOG_KEY` alone is not enough.

---

## 5. Project prefix rule

If `BORING_TELEMETRY_PROJECT=full-app`, core sends event names like:

```txt
full-app.app.opened
full-app.workspace.opened
full-app.agent.chat.started
full-app.agent.tool.completed
```

Core also sends the raw event name and project as properties:

```ts
{
  boringProject: 'full-app',
  eventName: 'agent.chat.started'
}
```

Why both:

- prefixed event names keep shared PostHog projects readable
- `boringProject` makes filtering/grouping easy
- no runtime multi-account routing needed in v1

If `BORING_TELEMETRY_PROJECT` is unset, core sends the raw event name.

---

## 6. Shared telemetry contract

Each package may define or import a compatible structural type:

```ts
export interface TelemetrySink {
  capture(event: TelemetryEvent): void | Promise<void>
  flush?(): void | Promise<void>
}

export interface TelemetryEvent {
  name: string
  distinctId?: string
  properties?: Record<string, unknown>
}
```

No package call site should depend on PostHog types.

Provide:

```ts
export const noopTelemetry: TelemetrySink = {
  capture() {},
}
```

And optionally:

```ts
export function safeCapture(telemetry: TelemetrySink, event: TelemetryEvent): void {
  try {
    void Promise.resolve(telemetry.capture(event)).catch(() => {})
  } catch {
    // telemetry must never break product behavior
  }
}
```

---

## 7. Core PostHog helper

Location:

```txt
packages/core/src/server/telemetry/posthog.ts
```

Shape:

```ts
export function createPostHogTelemetryFromEnv(env = process.env): TelemetrySink {
  const enabled = env.BORING_TELEMETRY_ENABLED === 'true'

  if (!enabled) return noopTelemetry

  if (!env.POSTHOG_KEY) {
    // warn once, then no-op
    return noopTelemetry
  }

  const posthog = new PostHog(env.POSTHOG_KEY, {
    host: env.POSTHOG_HOST ?? 'https://us.i.posthog.com',
  })

  const prefix = parseTelemetryProject(env.BORING_TELEMETRY_PROJECT)

  return {
    capture(event) {
      const name = prefix ? `${prefix}.${event.name}` : event.name

      posthog.capture({
        distinctId: event.distinctId ?? 'anonymous',
        event: name,
        properties: {
          ...sanitizeTelemetryProperties(event.properties),
          boringProject: prefix,
          eventName: event.name,
        },
      })
    },
    async flush() {
      await posthog.shutdown()
    },
  }
}
```

`parseTelemetryProject()` accepts only a slug safe for event-name prefixing, such as `full-app` or `customer-portal`. Invalid values warn once and disable the prefix instead of sending surprising event names.

`sanitizeTelemetryProperties()` is the central allowlist from this plan. It drops unknown keys before events reach PostHog, so one mistaken emitter cannot leak prompts, command output, raw paths, headers, or stack traces.

Rules:

- helper lives in core server code only
- agent/workspace do not import it
- disabled/misconfigured env returns no-op
- capture failures and rejected promises are swallowed or logged at debug level
- PostHog `shutdown()` is exposed through optional `telemetry.flush()` and wired into server shutdown

---

## 8. Frontend telemetry

Frontend telemetry should also work from env-only setup.

Preferred first pass:

1. Core server creates the PostHog sink from env.
2. Core exposes non-secret runtime config such as `{ telemetry: { enabled, endpoint } }`.
3. Core exposes a small internal telemetry endpoint for browser events, only when telemetry is enabled.
4. Core-composed frontend installs an HTTP telemetry sink only when `telemetry.enabled === true`.
5. The server forwards those events to PostHog with the same prefix/property rule.

This avoids requiring child apps to expose `VITE_POSTHOG_KEY` or initialize PostHog in browser code.

Endpoint rules:

- bounded request body
- only known event names from this plan
- reuse the same central property allowlist as the server PostHog sink
- authenticated when the app is authenticated
- telemetry endpoint failures never break UI behavior

If direct browser PostHog becomes necessary later, add it as a separate bead.

---

## 9. Event property policy

Allowed by default:

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

Identity:

- use a safe auth/user id as `distinctId` when available
- otherwise use `anonymous`
- do not send emails by default

Not allowed by default:

- prompts/messages
- assistant output
- file contents
- command strings
- command output
- raw file paths
- stack traces
- raw errors
- headers/cookies/tokens
- env vars

The allowlist should be enforced centrally by `sanitizeTelemetryProperties()` before any event reaches PostHog or the frontend telemetry endpoint.

If a future event needs richer data, add a small explicit allowlist in the same PR.

---

## 10. Initial event list

### Core

- `app.opened`
- `server.request.failed`
- `auth.user.signed_in` if there is already a natural auth hook

### Workspace

- `workspace.opened`
- `workspace.panel.opened`
- `workspace.command.executed`
- `workspace.ui_command.posted`
- `workspace.plugin.error`

### Agent

- `agent.chat.started`
- `agent.chat.message.submitted`
- `agent.chat.completed`
- `agent.chat.failed`
- `agent.tool.started`
- `agent.tool.completed`
- `agent.tool.failed`

Keep names stable once shipped.

---

## 11. Package wiring

### Core-composed server

Core server entrypoints accept:

```ts
telemetry?: TelemetrySink
```

Then resolve:

```ts
const telemetry = options.telemetry ?? createPostHogTelemetryFromEnv(process.env)
```

Core passes the resolved sink into workspace/agent composition.

### Agent standalone

Agent standalone remains no-op by default. It accepts `telemetry?: TelemetrySink` for embedders.

No PostHog env helper in agent for this pass.

### Workspace standalone

Workspace remains no-op by default. It accepts `telemetry?: TelemetrySink` in provider/server composition where needed.

No PostHog env helper in workspace for this pass.

---

## 12. Error handling

Telemetry must never break user flows.

Rules:

- never throw from no-op or safe capture helpers
- do not await telemetry in hot streaming paths unless already async and safe
- swallow or debug-log sink failures
- send stable `errorCode`, not raw stack/message by default
- if PostHog is down, product behavior is unchanged

---

## 13. Implementation beads

### Bead 1 — telemetry contract and no-op

- Add `TelemetrySink`, `TelemetryEvent`, optional `flush()`, `noopTelemetry`, and safe capture helper where needed.
- Keep shared files platform-neutral.
- Add unit tests for no-op, sync throw, async rejection, and safe capture.

Acceptance:

- no `node:*` or `Buffer` in shared files
- telemetry capture cannot throw into product code
- agent/workspace do not import PostHog or core

### Bead 2 — core PostHog env helper

- Add `packages/core/src/server/telemetry/posthog.ts`.
- Add `posthog-node` dependency to core if needed.
- Implement explicit opt-in via `BORING_TELEMETRY_ENABLED=true`.
- Implement `POSTHOG_KEY`, `POSTHOG_HOST`, and `BORING_TELEMETRY_PROJECT`.
- Add central property sanitization and project-prefix slug validation.
- Add optional `flush()` support and wire it into server shutdown.
- Add tests for disabled, missing key, enabled, host override, project prefix, invalid prefix, property sanitization, and flush.

Acceptance:

- unset env = no-op
- `BORING_TELEMETRY_ENABLED=false` = no-op
- `POSTHOG_KEY` without `BORING_TELEMETRY_ENABLED=true` = no-op
- enabled env sends prefixed event and properties

### Bead 3 — core wiring and frontend bridge

- Wire core-composed server entrypoints to resolve telemetry from `options.telemetry ?? env helper`.
- Pass the resolved sink to workspace/agent composition.
- Add non-secret runtime config for `telemetry.enabled` and `telemetry.endpoint`.
- Add internal frontend telemetry endpoint if frontend events are included in this pass.
- Add HTTP frontend sink in core-composed frontend if the endpoint is added.

Acceptance:

- child app can enable telemetry with env only
- child app can disable telemetry by omitting env
- custom `telemetry` option overrides env helper
- frontend endpoint, if added, validates/drops unsafe properties

### Bead 4 — event emitters

- Add the initial core/workspace/agent event calls.
- Use only the allowed property list.
- Avoid hot-path awaits.

Acceptance:

- tests prove expected safe events are emitted
- tests prove prompts/output/file contents/command output are not emitted
- package boundaries remain intact

### Bead 5 — docs

- Document env vars.
- Document event names.
- Document privacy rules.
- Add shared PostHog account example with `BORING_TELEMETRY_PROJECT`.

Acceptance:

- docs match implementation
- no Sentry/OTLP/routing scope reappears

---

## 14. Definition of done

Telemetry v1 is done when:

- a core-composed app can enable PostHog with env vars only
- telemetry is off by default
- shared PostHog accounts can use `BORING_TELEMETRY_PROJECT`
- agent/workspace remain PostHog-free
- no content or secret-bearing data is captured by default
- tests cover opt-in, opt-out, prefixing, and privacy behavior
