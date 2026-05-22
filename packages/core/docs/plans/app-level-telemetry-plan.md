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
- Core owns the PostHog env helper for core-composed apps.
- Child apps enable telemetry and pass credentials with env vars; no app code is required for the common path.
- Agent/workspace internals receive a tiny optional telemetry sink and default to no-op.
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

For core-composed apps, core creates the sink from env automatically unless a custom `telemetry` sink is passed. This gives the common child-app usage:

```bash
BORING_TELEMETRY_ENABLED=true
POSTHOG_KEY=phc_...
BORING_TELEMETRY_PROJECT=full-app
```

No extra child-app code is required. Advanced apps can still pass `telemetry` explicitly to override the env helper.

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

Core builds the default PostHog sink from env vars for core-composed apps. Advanced apps can override this by passing a custom `TelemetrySink`.

---

## 3. Env vars

Use boring-ui env names for boring-ui behavior, and PostHog env names for PostHog credentials.

```bash
# Required to send telemetry. If omitted, telemetry is no-op.
BORING_TELEMETRY_ENABLED=true

# Required when telemetry is enabled.
POSTHOG_KEY=phc_...

# Optional. Defaults in the core helper if omitted.
POSTHOG_HOST=https://us.i.posthog.com

# Optional, but recommended when several apps share one PostHog account/project.
# Used both as an event-name prefix and as a property.
BORING_TELEMETRY_PROJECT=full-app
```

Telemetry is **off by default**. If `BORING_TELEMETRY_ENABLED` is unset or set to `false`, core returns `noopTelemetry` even if other app code imports the helper.

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

Implement this helper in core's app/server layer, not inside agent/workspace internals:

```ts
// packages/core/src/server/telemetry/posthog.ts
export function createPostHogTelemetryFromEnv(env = process.env): TelemetrySink {
  const enabled = env.BORING_TELEMETRY_ENABLED === 'true' && Boolean(env.POSTHOG_KEY)

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

Core-composed app entrypoints use it by default:

```ts
const telemetry = options.telemetry ?? createPostHogTelemetryFromEnv(process.env)
```

Child apps that want telemetry set env vars. Child apps that do not want telemetry leave `BORING_TELEMETRY_ENABLED` unset or set it to `false`.

Advanced apps may still pass their own `telemetry` sink to bypass the PostHog env helper.

---

## 5. Package boundaries

### Core

Core owns the PostHog env helper and may pass telemetry through app creation options. Core captures generic app/server events:

- `app.opened`
- `server.request.failed`
- `auth.user.signed_in` if auth hooks already exist naturally

Core must not require PostHog env vars to boot. Missing env or disabled env means no-op telemetry.

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

- core-composed browser entrypoints initialize PostHog only if public telemetry env/config is explicitly enabled
- workspace/agent front providers accept the same `TelemetrySink` shape
- workspace/agent packages do not read `VITE_POSTHOG_KEY` directly

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

### Bead 2 — core PostHog env helper

- Add `createPostHogTelemetryFromEnv()` in `packages/core/src/server/telemetry/posthog.ts`.
- Wire core-composed server entrypoints to use `options.telemetry ?? createPostHogTelemetryFromEnv(process.env)`.
- Add browser equivalent only if a core-composed browser entrypoint needs it.
- Support `POSTHOG_KEY`, `POSTHOG_HOST`, `BORING_TELEMETRY_ENABLED`, and `BORING_TELEMETRY_PROJECT`.

Acceptance:

- unset env = no-op
- `BORING_TELEMETRY_ENABLED=false` = no-op even with key
- `BORING_TELEMETRY_ENABLED=true` plus `POSTHOG_KEY` sends events
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
