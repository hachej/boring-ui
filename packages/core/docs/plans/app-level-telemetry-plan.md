# Simple PostHog Telemetry Plan for boring-ui-v2

**Status:** simplified draft for PR 65  
**Branch/worktree:** `plan/telemetry` at `/home/ubuntu/projects/worktrees/boring-ui-v2-telemetry`  
**Primary decision:** use **PostHog**, configured by the child app through env vars.  
**Last updated:** 2026-05-22

---

## 0. What changed from the original plan

The old plan was too big for the current need. It designed a vendor-neutral telemetry layer with Sentry, OTLP, routing, multi-account selection, CSP planning, and nine beads.

We do not need that now.

New shape:

- PostHog is the only planned provider.
- The child app owns PostHog env vars and client creation.
- Packages receive a tiny optional telemetry sink and default to no-op.
- Shared PostHog accounts are handled with a stable project prefix/property, not routing logic.
- No Sentry, OTLP, tenant routing, event bus, or analytics database in this pass.

---

## 1. Goal

Add enough telemetry to answer simple product and reliability questions:

- app opened
- workspace opened
- chat session started
- user message submitted, without content
- agent/tool run completed or failed
- workspace panel/command used
- server/frontend error happened, with stable error code only

Telemetry must never capture prompts, assistant output, file contents, command output, secrets, headers, cookies, or raw env vars.

---

## 2. Decision

Telemetry is app-level and PostHog-focused.

Packages expose only this tiny structural contract:

```ts
export interface TelemetrySink {
  capture(event: TelemetryEvent): void | Promise<void>
}

export interface TelemetryEvent {
  name: string
  distinctId?: string
  properties?: Record<string, unknown>
}
```

Every package option that needs telemetry accepts `telemetry?: TelemetrySink`.
If absent, it uses a no-op sink.

Package code emits events like:

```ts
telemetry.capture({
  name: 'agent.chat.started',
  distinctId: userId,
  properties: {
    workspaceId,
    sessionId,
    runtimeMode,
  },
})
```

The final app decides how to build the PostHog sink from env vars.

---

## 3. Env vars

Use boring-ui env names for boring-ui behavior, and PostHog env names for PostHog credentials.

```bash
# Required to send telemetry.
POSTHOG_KEY=phc_...

# Optional. Defaults in the app helper if omitted.
POSTHOG_HOST=https://us.i.posthog.com

# Optional. If unset, telemetry is enabled when POSTHOG_KEY is set.
BORING_TELEMETRY_ENABLED=true

# Optional, but recommended when several apps share one PostHog account/project.
# Used both as an event-name prefix and as a property.
BORING_TELEMETRY_PROJECT=full-app
```

### Project prefix rule

If `BORING_TELEMETRY_PROJECT=full-app`, event names sent to PostHog become:

```txt
full-app.app.opened
full-app.workspace.opened
full-app.agent.chat.started
full-app.agent.tool.completed
```

The same value is also sent as a property:

```ts
{
  boringProject: 'full-app',
  eventName: 'agent.chat.started'
}
```

Why both:

- prefixed event names make PostHog dashboards easy when projects share an account/project
- the `boringProject` property makes filtering and grouping easy
- no need for multi-account routing in v1

If the prefix is unset, send the raw event name.

---

## 4. PostHog sink helper

Implement this helper in the app/example layer, not deep inside agent/workspace internals:

```ts
export function createPostHogTelemetryFromEnv(env = process.env): TelemetrySink {
  const enabled = env.BORING_TELEMETRY_ENABLED !== 'false' && Boolean(env.POSTHOG_KEY)

  if (!enabled) return noopTelemetry

  const posthog = new PostHog(env.POSTHOG_KEY!, {
    host: env.POSTHOG_HOST,
  })

  const prefix = env.BORING_TELEMETRY_PROJECT?.trim()

  return {
    capture(event) {
      const name = prefix ? `${prefix}.${event.name}` : event.name

      posthog.capture({
        distinctId: event.distinctId ?? 'anonymous',
        event: name,
        properties: {
          ...event.properties,
          boringProject: prefix,
          eventName: event.name,
        },
      })
    },
  }
}
```

Exact file location can be chosen during implementation. Preferred:

- reusable helper: `packages/core/src/server/telemetry/posthog.ts`, if core already owns app env/config helpers
- app-only helper: `apps/full-app/src/server/telemetry.ts`, if we want zero PostHog dependency in packages

For the first pass, prefer app-only helper unless there is a clear need to publish it.

---

## 5. Package boundaries

### Core

Core may pass telemetry through app creation options and capture generic app/server events:

- `app.opened`
- `server.request.failed`
- `auth.user.signed_in` if auth hooks already exist naturally

Core must not require PostHog env vars to boot.

### Agent

Agent accepts `telemetry?: TelemetrySink` in server/app options and emits agent events:

- `agent.chat.started`
- `agent.chat.message.submitted`
- `agent.chat.completed`
- `agent.chat.failed`
- `agent.tool.started`
- `agent.tool.completed`
- `agent.tool.failed`

No prompt text, assistant text, stdout, stderr, file contents, or command args by default.

### Workspace

Workspace accepts `telemetry?: TelemetrySink` in provider/server options and emits UI/workspace events:

- `workspace.opened`
- `workspace.panel.opened`
- `workspace.command.executed`
- `workspace.ui_command.posted`
- `workspace.plugin.error`

No panel params unless explicitly allowlisted and known safe.

---

## 6. Minimal event properties

Use low-cardinality metadata only.

Allowed by default:

- `workspaceId`
- `sessionId`
- `requestId`
- `userId` only as `distinctId` or a safe hashed/id value already used by auth
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

Not allowed by default:

- prompts/messages
- file paths unless explicitly normalized/approved later
- command strings
- command output
- stack traces
- raw errors
- headers/cookies/tokens
- env vars

If a future event needs richer data, add it intentionally with a small allowlist.

---

## 7. Error handling

Telemetry must never break user flows.

Rules:

- `capture()` calls are best-effort.
- Package call sites must not `await` telemetry on hot streaming paths unless already async and safe.
- Sink failures are swallowed or logged at debug level.
- Error events send `errorCode`, not raw error messages/stacks by default.

---

## 8. Browser telemetry

Keep browser telemetry simple:

- app shell initializes PostHog in the browser only if a public key/config is provided
- workspace/agent front providers accept the same `TelemetrySink` shape
- no package reads `VITE_POSTHOG_KEY` directly

The app can expose config however it already exposes runtime config.
For Vite demo apps, use:

```bash
VITE_POSTHOG_KEY=phc_...
VITE_POSTHOG_HOST=https://us.i.posthog.com
VITE_BORING_TELEMETRY_PROJECT=workspace-playground
```

The browser helper should follow the same prefix rule as the server helper.

---

## 9. Implementation plan

### Bead 1 — telemetry contract and no-op

- Add `TelemetrySink`, `TelemetryEvent`, and `noopTelemetry` where each package can use them without adding forbidden dependencies.
- Add a safe wrapper/helper if useful.
- Add unit tests for no-op and prefix formatting if helper exists.

Acceptance:

- packages compile without PostHog installed unless app/helper needs it
- no `node:*` or `Buffer` in shared files
- no telemetry call can throw into product code

### Bead 2 — PostHog env helper in app/example

- Add `createPostHogTelemetryFromEnv()` for server usage.
- Add browser equivalent for Vite/demo usage if needed.
- Support `POSTHOG_KEY`, `POSTHOG_HOST`, `BORING_TELEMETRY_ENABLED`, and `BORING_TELEMETRY_PROJECT`.
- Wire it in `apps/full-app` or the canonical demo shell.

Acceptance:

- unset env = no-op
- `BORING_TELEMETRY_ENABLED=false` = no-op even with key
- project prefix changes event names and adds `boringProject`

### Bead 3 — core/agent/workspace event calls

- Thread `telemetry?: TelemetrySink` through existing app/provider/server options.
- Add only the minimal event list from this plan.
- Keep privacy allowlist strict.

Acceptance:

- tests prove expected events are emitted with safe metadata
- tests prove prompts/output/file contents are not included
- quality gates pass

### Bead 4 — docs

- Document env vars.
- Document event names.
- Document privacy rules.
- Add a short “shared PostHog account” example using `BORING_TELEMETRY_PROJECT`.

Acceptance:

- docs match implementation
- no extra vendor/routing/Sentry/OTLP scope sneaks back in

---

## 10. Explicit non-goals for this PR

Do not implement now:

- Sentry integration
- OpenTelemetry/OTLP
- per-tenant provider routing
- database-backed telemetry storage
- billing/metering
- content capture
- complex consent system
- automatic CSP management
- multi-account PostHog routing

If any of those become necessary, make separate beads later.

---

## 11. Definition of done

This plan is done when:

- PR 65 describes the simplified PostHog-only direction.
- The event prefix/env-var contract is clear.
- The implementation work is small enough to start without another architecture pass.
