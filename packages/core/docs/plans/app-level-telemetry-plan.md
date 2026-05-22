# App-Level Telemetry Plan for boring-ui-v2

**Status:** draft plan — ready for review, then bead conversion  
**Branch/worktree:** `plan/telemetry` at `/home/ubuntu/projects/worktrees/boring-ui-v2-telemetry`  
**Primary decision:** the **child app declares telemetry providers and routing**; package code emits typed vendor-neutral events only.  
**Packages touched:** `@hachej/boring-core`, `@hachej/boring-agent`, `@hachej/boring-workspace`, app examples under `apps/*`  
**Last updated:** 2026-05-21

---

## 0. Executive summary

boring-ui-v2 needs telemetry for product usage and reliability:

- usage: who opens workspaces, starts chat sessions, uses panels, runs tools, triggers commands
- reliability: chat stream failures, tool failures, sandbox/runtime failures, server 5xx, frontend error boundaries
- operations: durations, status codes, model/runtime/tool metadata, request IDs

But telemetry cannot be owned by `@hachej/boring-core`, `@hachej/boring-agent`, or `@hachej/boring-workspace` as vendor integrations. A final child app may need to send different events to different PostHog accounts, Sentry projects, OpenTelemetry collectors, or customer-specific analytics destinations.

Therefore:

> Packages expose and use a small `TelemetrySink` interface. The child app constructs the actual telemetry adapter and passes it into core/agent/workspace server and front entrypoints.

Packages never import PostHog or Sentry directly. Packages do not read `POSTHOG_KEY` or `SENTRY_DSN`. The final app does.

---

## 1. Goals

### 1.1 Product analytics

Capture enough events to answer:

- How many users open the app daily?
- How many workspaces are active?
- How often do users start chat sessions?
- How many messages per session?
- Which agent tools are used most?
- Which workspace panels and commands are used?
- Which plugins produce actual engagement?

### 1.2 Reliability analytics

Capture enough events to answer:

- Are chat streams failing?
- Which runtime mode fails most: `direct`, `local`, or `vercel-sandbox`?
- Which tools fail most?
- Are specific workspaces/users seeing repeated failures?
- Are frontend panel/plugin crashes happening?
- Are server 5xx errors correlated with agent sessions?

### 1.3 App-level provider control

The child app must be able to:

- disable telemetry entirely
- send all events to one destination
- route frontend and backend events differently
- route events per deployment or environment
- route events per workspace/customer/tenant
- use PostHog for analytics and Sentry for exceptions
- use only Sentry, only PostHog, only OTLP, or a custom internal endpoint

### 1.4 Privacy-safe by default

Telemetry must default to operational metadata only.

Do capture:

- IDs: user/workspace/session/request
- route/method/status/duration
- runtime mode, model provider, tool name
- counts and lengths
- error codes and sanitized messages

Do not capture by default:

- user prompt text
- assistant output text/code
- file contents
- command stdout/stderr
- environment variables
- raw headers/cookies/tokens
- secret values

---

## 2. Non-goals

- No built-in billing/metering system in this feature.
- No core-owned analytics database.
- No mandatory SaaS vendor.
- No automatic capture of prompt/content bodies.
- No full distributed tracing rollout in phase 1.
- No hard dependency from agent/workspace to core.
- No environment variables in packages like `POSTHOG_KEY`; those belong to child apps.
- No “telemetry SDK singleton” hidden in package internals.

---

## 3. Core architectural decision

### 3.1 Decision

Telemetry is declared at the child-app level.

```ts
const telemetry = createAppTelemetry({
  appId: 'full-app',
  environment: process.env.NODE_ENV,
  posthog: {
    defaultProjectKey: process.env.POSTHOG_PROJECT_KEY,
  },
  sentry: {
    dsn: process.env.SENTRY_DSN,
  },
  routeEvent: async (event) => {
    // Optional: choose destination by workspace/customer/deployment.
    return chooseTelemetryDestination(event.context?.workspaceId)
  },
})

const app = await createCoreWorkspaceAgentServer({
  telemetry,
  plugins,
  mode,
  workspaceRoot,
})
```

Package code only emits:

```ts
telemetry.capture({
  name: 'agent.chat.stream.failed',
  context: { workspaceId, sessionId, requestId, runtimeMode },
  properties: { durationMs, errorCode },
})
```

The app decides whether that becomes:

- `posthog.capture(...)`
- `Sentry.captureException(...)`
- an OTLP span/event
- a database insert
- a no-op

### 3.2 Why this is better

#### Package composability

`@hachej/boring-agent` must remain standalone. It cannot depend on core or a specific analytics vendor.

#### Tenant-specific telemetry

Future apps may be white-labeled or multi-tenant. Workspace A may need one PostHog account and workspace B another.

#### Deployment flexibility

Self-hosters may want no telemetry. Enterprise users may require a private collector. Local CLI users should not be forced to configure anything.

#### CSP flexibility

Browser analytics vendors require CSP `connect-src` changes. The app shell owns CSP policy and should decide which endpoints to allow.

#### Privacy policy ownership

The final app owns privacy policy, user consent, and data retention. Packages should not surprise-capture content.

---

## 4. Package boundaries and invariants

### 4.1 Existing package graph

Current project shape:

```txt
apps/*
  ├─→ @hachej/boring-core
  ├─→ @hachej/boring-workspace
  └─→ @hachej/boring-agent

@hachej/boring-workspace → @hachej/boring-core only where allowed by app composition rules
@hachej/boring-agent     → standalone leaf
```

Telemetry must not invert or tangle this graph.

### 4.2 Invariants

Telemetry work must preserve these project rules:

1. No `node:*` imports in `src/shared/**`.
2. No `Buffer` in `src/shared/**`.
3. Workspace base front/shared code has no value imports from `@hachej/boring-agent`.
4. Agent remains usable as standalone `createAgentApp()` and CLI.
5. Core remains the package that knows auth/workspace identity, but it does not own vendor telemetry credentials.
6. Error codes remain stable and canonical.
7. Telemetry failures never break user flows.

---

## 5. Telemetry contract

Each package should expose a compatible structural type from its own shared layer.

Why per-package instead of a new shared package right now:

- avoids adding a new publishable package before needed
- avoids forcing agent to depend on core/workspace
- keeps shared code browser-safe
- TypeScript structural typing lets one child-app object satisfy all package contracts

Potential future extraction:

- `@hachej/boring-telemetry` can be added later if the contract grows.
- Do not start there unless the contract becomes large or duplicated logic hurts.

### 5.1 Shared type

```ts
export type TelemetrySeverity = 'debug' | 'info' | 'warn' | 'error'

export interface TelemetryContext {
  appId?: string
  environment?: string
  deploymentId?: string
  userId?: string
  workspaceId?: string
  sessionId?: string
  requestId?: string
  route?: string
  method?: string
  runtimeMode?: string
  pluginId?: string
}

export interface TelemetryEvent {
  name: string
  timestamp?: string
  severity?: TelemetrySeverity
  context?: TelemetryContext
  properties?: Record<string, string | number | boolean | null | undefined>
}

export interface TelemetryErrorInfo {
  code?: string
  statusCode?: number
  className?: string
  // Optional, already-sanitized, short message. No raw upstream error text by default.
  message?: string
}

export interface TelemetryErrorEvent extends TelemetryEvent {
  error?: TelemetryErrorInfo
}

export interface TelemetrySink {
  capture(event: TelemetryEvent): void | Promise<void>
  captureError(event: TelemetryErrorEvent): void | Promise<void>
  flush?(): Promise<void>
}
```

**Simplicity rule:** package code passes sanitized error metadata, not raw `unknown` exceptions. App adapters may capture raw exceptions only inside app-owned code paths where the app has its own scrubbers and consent policy.

### 5.2 Noop sink

```ts
export const noopTelemetry: TelemetrySink = {
  capture() {},
  captureError() {},
  async flush() {},
}
```

### 5.3 Safe capture wrapper

Package code should not `await telemetry.capture(...)` directly in hot paths unless needed. Use a helper that swallows sink errors and optionally logs them.

```ts
export function safeCaptureTelemetry(
  telemetry: TelemetrySink,
  event: TelemetryEvent,
  logger?: { warn?: (data: unknown, message?: string) => void },
): void {
  try {
    void Promise.resolve(telemetry.capture(event)).catch((error) => {
      logger?.warn?.({ err: error, eventName: event.name }, 'telemetry capture failed')
    })
  } catch (error) {
    logger?.warn?.({ err: error, eventName: event.name }, 'telemetry capture failed')
  }
}
```

A similar `safeCaptureTelemetryError` should exist. It accepts `TelemetryErrorInfo`, not raw `unknown`.

### 5.4 Why failures are swallowed

Telemetry is observability, not product logic. If PostHog/Sentry/collector is down, chat should still work.

---

## 6. Server integration design

### 6.1 Core server

Add optional telemetry to `CreateCoreAppOptions`:

```ts
export interface CreateCoreAppOptions {
  authProvider?: AuthProvider
  userStore?: UserStore
  workspaceStore?: WorkspaceStore
  provisioner?: WorkspaceProvisioner
  manageShutdown?: boolean
  telemetry?: TelemetrySink
}
```

Decorate Fastify:

```ts
app.decorate('telemetry', options?.telemetry ?? noopTelemetry)
```

Fastify module augmentation:

```ts
declare module 'fastify' {
  interface FastifyInstance {
    telemetry: TelemetrySink
  }
}
```

Capture:

- request failures
- unhandled errors
- shutdown errors if useful
- workspace CRUD lifecycle events
- auth lifecycle events only after privacy review

### 6.2 Core workspace-agent app

`createCoreWorkspaceAgentServer()` is the key child-app composition path. It should accept either a ready sink or a small factory.

Keep the common case simple:

```ts
createCoreWorkspaceAgentServer({ telemetry })
```

Allow the advanced case without making every package know about stores:

```ts
export interface CreateCoreWorkspaceAgentServerOptions
  extends Omit<RegisterAgentRoutesOptions, 'extraTools'> {
  telemetry?: TelemetrySink
  createTelemetry?: (ctx: {
    config: CoreConfig
    userStore: UserStore
    workspaceStore: WorkspaceStore
  }) => TelemetrySink | Promise<TelemetrySink>
  // existing options...
}
```

Implementation shape:

```ts
const runtime = await createCoreRuntime(config, {
  telemetry: options.telemetry,
  createTelemetry: options.createTelemetry,
})

await app.register(registerAgentRoutes, {
  telemetry: runtime.telemetry,
  // existing options...
})
```

Use `telemetry` for one-account apps. Use `createTelemetry` only when routing needs `workspaceStore`/customer settings. The same resolved sink flows through the composed server unless the child app intentionally passes separate sinks.

### 6.3 Agent standalone server

Add telemetry to `CreateAgentAppOptions`:

```ts
export interface CreateAgentAppOptions {
  telemetry?: TelemetrySink
  // existing options...
}
```

Standalone mode defaults to noop.

```ts
const telemetry = opts.telemetry ?? noopTelemetry
```

### 6.4 Agent embedded routes

Add telemetry to `RegisterAgentRoutesOptions`:

```ts
export interface RegisterAgentRoutesOptions {
  telemetry?: TelemetrySink
  // existing options...
}
```

When embedded in core, agent should use:

```ts
const telemetry = opts.telemetry ?? maybeAppTelemetry(app) ?? noopTelemetry
```

This must be structural; agent cannot import core types.

```ts
function maybeAppTelemetry(app: FastifyInstance): TelemetrySink | undefined {
  const value = (app as FastifyInstance & { telemetry?: unknown }).telemetry
  return isTelemetrySink(value) ? value : undefined
}
```

---

## 7. Frontend integration design

### 7.1 Core front

`CoreFront` currently owns providers and `AppErrorBoundary`. Add:

```ts
export interface CoreFrontProps {
  children?: ReactNode
  authPages?: CoreFrontAuthPagesOverride
  cspNonce?: string
  telemetry?: TelemetrySink
}
```

Wire error boundary:

```tsx
<AppErrorBoundary
  onError={(error, errorInfo) => {
    safeCaptureTelemetryError(telemetry, {
      name: 'core.frontend.error',
      severity: 'error',
      error: sanitizeError(error),
      context: { route: window.location.pathname },
      properties: {
        componentStackHash: hashString(errorInfo.componentStack ?? ''),
      },
    })
  }}
>
```

Do not capture raw component stack by default. It can include component names but may still be noisy. Hash is enough for grouping in product telemetry. If a child app wants Sentry raw exceptions, it can do that inside its own `AppErrorBoundary` or adapter after applying its own scrubbers.

### 7.2 Workspace front

Add telemetry to `WorkspaceProvider` and context.

```tsx
<WorkspaceProvider telemetry={telemetry} plugins={[...]}>
  <IdeLayout />
</WorkspaceProvider>
```

Capture:

- provider mounted
- panel opened/closed
- left tab selected
- command executed
- catalog row opened
- UI command posted/failed
- plugin/panel error boundary

### 7.3 Agent front

Add telemetry to `ChatPanel` and/or `useAgentChat` options.

```tsx
<ChatPanel telemetry={telemetry} />
```

Frontend can capture user-intent events immediately:

- message submit clicked
- attachment rejected
- chat UI error shown
- stream disconnected in browser

Backend remains source of truth for stream/tool success/failure.

### 7.4 Composed frontend helpers

The app-level composition helpers must forward telemetry too. Otherwise child apps using the default boring app shell would have to manually re-compose everything.

Required pass-throughs:

- `CoreWorkspaceAgentFront telemetry` → `CoreFront telemetry`
- `CoreWorkspaceAgentFront telemetry` → `WorkspaceAgentFront telemetry`
- `WorkspaceAgentFront telemetry` → `WorkspaceProvider telemetry`
- `WorkspaceAgentFront telemetry` → default `ChatPanel`/chat params when it renders the default agent panel

Keep this as simple prop forwarding. Do not make workspace context the only way for agent front code to receive telemetry, because base workspace code must not value-import agent.

---

## 8. Child app telemetry adapters

### 8.1 Server adapter example

Location for example:

```txt
apps/full-app/src/telemetry/server.ts
```

Shape:

```ts
export interface ServerTelemetryConfig {
  appId: string
  environment: string
  posthog?: {
    defaultProjectKey?: string
    host?: string
  }
  sentry?: {
    dsn?: string
  }
  routeEvent?: (event: TelemetryEvent | TelemetryErrorEvent) => Promise<TelemetryDestination> | TelemetryDestination
}
```

The example should be dependency-light. If adding actual vendor packages is too much for first pass, use documented extension points and maybe a minimal `fetch`-based PostHog capture example.

### 8.2 Browser adapter example

Location:

```txt
apps/full-app/src/telemetry/browser.ts
```

Browser env vars are public:

```bash
VITE_POSTHOG_KEY=
VITE_POSTHOG_HOST=https://us.i.posthog.com
VITE_SENTRY_DSN=
```

CSP notes must be documented because browser telemetry needs `connect-src` additions.

### 8.3 Multi-account routing

Example routing:

```ts
const app = await createCoreWorkspaceAgentServer({
  createTelemetry: ({ config, workspaceStore }) => createServerTelemetry({
    appId: config.appId,
    environment: process.env.NODE_ENV ?? 'development',
    routeEvent: async (event) => {
      const workspaceId = event.context?.workspaceId
      if (!workspaceId) return defaultDestination

      const settings = await workspaceStore.getWorkspaceSettings(workspaceId)
      const posthogProjectKey = settings.find((s) => s.key === 'POSTHOG_PROJECT_KEY')
      if (posthogProjectKey?.configured) {
        return { posthog: { projectKey: await decryptSetting(workspaceId, 'POSTHOG_PROJECT_KEY') } }
      }

      return defaultDestination
    },
  }),
})
```

This is why package-level provider initialization is wrong. Most apps should use plain `telemetry`; apps that need store-backed routing use `createTelemetry`.

---

## 9. Event taxonomy

Event names use stable dotted names.

Naming rules:

- prefix by package/domain: `core.*`, `agent.*`, `workspace.*`
- use past-tense lifecycle names: `created`, `started`, `completed`, `failed`
- use stable low-cardinality event names
- put high-cardinality values in properties only if safe
- no raw user text in event names or properties

### 9.1 Core events

| Event | When | Context | Properties |
|---|---|---|---|
| `core.app.started` | server boot completes | appId, environment, deploymentId | packageVersion |
| `core.http.request.failed` | 5xx/unhandled route error | requestId, route, method, userId, workspaceId | statusCode, errorCode, durationMs |
| `core.auth.sign_in.completed` | sign-in succeeds | userId | provider |
| `core.auth.sign_in.failed` | sign-in fails | requestId | statusCode, reason |
| `core.auth.sign_up.completed` | sign-up succeeds | userId | provider |
| `core.workspace.created` | workspace created | userId, workspaceId | isDefault |
| `core.workspace.updated` | workspace changed | userId, workspaceId | changedFieldsCount |
| `core.workspace.deleted` | workspace removed | userId, workspaceId | hadRuntime |
| `core.workspace.opened` | front loads active workspace | userId, workspaceId | source |
| `core.frontend.error` | React boundary catches error | route, userId, workspaceId | componentStackHash |

Auth events may be phased later if better-auth hooks are awkward or privacy review wants fewer identity events first.

### 9.2 Agent events

| Event | When | Context | Properties |
|---|---|---|---|
| `agent.chat.session.created` | session created | workspaceId, sessionId, userId | source |
| `agent.chat.message.sent` | user message accepted | workspaceId, sessionId, userId | messageLength, attachmentCount |
| `agent.chat.stream.started` | backend stream opens | workspaceId, sessionId, requestId, runtimeMode | modelProvider, modelName |
| `agent.chat.stream.completed` | stream finishes normally | workspaceId, sessionId, requestId, runtimeMode | durationMs, chunkCount, toolCallCount |
| `agent.chat.stream.failed` | stream errors | workspaceId, sessionId, requestId, runtimeMode | durationMs, errorCode, statusCode |
| `agent.tool.started` | tool call begins | workspaceId, sessionId, runtimeMode | toolName |
| `agent.tool.completed` | tool call succeeds | workspaceId, sessionId, runtimeMode | toolName, durationMs |
| `agent.tool.failed` | tool call fails | workspaceId, sessionId, runtimeMode | toolName, durationMs, errorCode |
| `agent.runtime.binding.created` | runtime binding created | workspaceId, runtimeMode | fsCapability |
| `agent.runtime.binding.recreated` | expired sandbox recreated | workspaceId, runtimeMode | reason |
| `agent.sandbox.failed` | sandbox/runtime operation failed | workspaceId, runtimeMode | statusCode, errorCode |
| `agent.plugin.load.failed` | pi plugin failed to load | workspaceId | pluginSourceHash, errorCode |

### 9.3 Workspace events

| Event | When | Context | Properties |
|---|---|---|---|
| `workspace.provider.mounted` | provider initializes | userId, workspaceId | pluginCount |
| `workspace.panel.opened` | dockview opens panel | workspaceId | panelId, placement, source |
| `workspace.panel.closed` | dockview closes panel | workspaceId | panelId, durationMs |
| `workspace.left_tab.selected` | left tab selected | workspaceId | tabId |
| `workspace.command.executed` | command palette command runs | workspaceId | commandId, source |
| `workspace.catalog.searched` | catalog search submitted | workspaceId | catalogId, queryLength, resultCount |
| `workspace.catalog.row.opened` | catalog row opens surface | workspaceId | catalogId, kind |
| `workspace.ui_command.posted` | server posts UI command | workspaceId | commandType, source |
| `workspace.ui_command.dispatched` | front dispatches command | workspaceId | commandType |
| `workspace.ui_command.failed` | command cannot dispatch | workspaceId | commandType, reason |
| `workspace.plugin.error` | plugin boundary catches error | workspaceId, pluginId | panelId, componentStackHash |

---

## 10. Privacy and content policy

### 10.1 Default capture matrix

| Data | Default | Rationale |
|---|---:|---|
| userId | yes | app already owns auth; useful for support |
| workspaceId | yes | needed for workspace-level reliability |
| sessionId | yes | needed for chat debugging |
| requestId | yes | joins logs/errors |
| route template | yes | operational metadata |
| raw URL query string | no | may include secrets/search text |
| status code | yes | operational metadata |
| durationMs | yes | performance |
| runtimeMode | yes | compare direct/local/vercel-sandbox |
| toolName | yes | low-cardinality product metadata |
| model provider/name | yes | cost/reliability analysis |
| prompt text | no | sensitive content |
| assistant text/code | no | sensitive content/IP |
| file contents | no | sensitive/IP |
| file path | no by default | may reveal project structure; app can opt into hash/basename |
| command stdout/stderr | no | may include secrets |
| command string | no by default | may include secrets; maybe hash only later |
| env vars | never | secrets |
| cookies/auth headers | never | secrets |

### 10.2 Sanitization helpers

Add helpers where needed:

```ts
function sanitizeError(error: unknown): TelemetryErrorInfo
function sanitizeErrorCode(error: unknown): string | undefined
function sanitizeStatusCode(error: unknown): number | undefined
function lengthOnly(value: string | undefined): number
function safeRoute(request: FastifyRequest): string
function truncateTelemetryString(value: string, maxLength?: number): string
```

Do not add generic deep object telemetry serialization. That invites accidental content capture.

### 10.3 Event allowlists

Privacy tests should validate allowlisted fields per event name, not only `not.toContain('secret')` snapshots.

Simple rule: each package keeps a tiny test-only map of expected event names and allowed `context`/`properties` keys for the events it emits. Tests fail if code starts spreading raw request/body/error objects into telemetry.

Do not build a big runtime schema system in v1. Test allowlists are enough.

### 10.3 User consent

The package-level sink contract should not enforce consent. The child app adapter should decide:

- disabled until user opts in
- enabled for operational error events only
- enabled for all product events
- disabled for enterprise deployments

This can be a `beforeSend` hook in the child-app adapter.

```ts
beforeSend(event) {
  if (!userConsentAllows(event)) return null
  return sanitize(event)
}
```

---

## 11. Core implementation plan

### 11.1 Shared contract

Files:

```txt
packages/core/src/shared/telemetry.ts
packages/core/src/shared/index.ts
```

Exports:

- `TelemetrySeverity`
- `TelemetryContext`
- `TelemetryEvent`
- `TelemetryErrorEvent`
- `TelemetrySink`
- `noopTelemetry`
- `safeCaptureTelemetry`
- `safeCaptureTelemetryError`

Tests:

```txt
packages/core/src/shared/__tests__/telemetry.test.ts
```

Acceptance:

- noop accepts events
- safe helpers swallow sync throw
- safe helpers swallow async rejection
- helpers call logger warn when provided

### 11.2 Fastify decoration

Files:

```txt
packages/core/src/server/app/types.ts
packages/core/src/server/app/createCoreApp.ts
```

Add `telemetry` option and decoration.

Acceptance:

- `createCoreApp(config)` exposes noop telemetry
- `createCoreApp(config, { telemetry })` exposes supplied sink
- no behavior change when omitted

### 11.3 Error handler capture

File:

```txt
packages/core/src/server/app/errorHandler.ts
```

Capture only server failures and validation/rate-limit failures if useful.

First pass recommendation:

- capture 5xx in `captureError`
- optionally capture 4xx auth/rate-limit later

Payload:

```ts
{
  name: 'core.http.request.failed',
  severity: 'error',
  error: sanitizeError(error),
  context: {
    requestId: request.id,
    route: request.routeOptions?.url,
    method: request.method,
    userId: request.user?.id,
  },
  properties: {
    statusCode: 500,
    errorCode: 'internal_error',
  },
}
```

Acceptance:

- HTTP response unchanged
- telemetry sink receives event on 500
- telemetry sink failure does not change response

### 11.4 Front error boundary capture

Files:

```txt
packages/core/src/front/CoreFront.tsx
packages/core/src/front/AppErrorBoundary.tsx
```

`AppErrorBoundary` already supports `onError`; wire from `CoreFront` prop.

Acceptance:

- rendering crash calls telemetry
- no telemetry prop means no crash in tests
- no raw component stack in product properties unless explicitly accepted

---

## 12. Agent implementation plan

### 12.1 Shared contract

Files:

```txt
packages/agent/src/shared/telemetry.ts
packages/agent/src/shared/index.ts
```

Same structural contract as core.

### 12.2 Options

Files:

```txt
packages/agent/src/server/createAgentApp.ts
packages/agent/src/server/registerAgentRoutes.ts
```

Add:

```ts
telemetry?: TelemetrySink
```

Embedded routes fallback to `app.telemetry` if structurally present.

### 12.3 Chat route events

Likely files:

```txt
packages/agent/src/server/http/routes/chat.ts
packages/agent/src/server/http/routes/sessions.ts
```

Capture:

- message accepted
- stream started
- stream completed
- stream failed
- stream aborted
- session created

Important: do not capture message content. Only length/count.

Current chat streaming can handle generator errors inside the stream executor, write an error chunk, and still finish HTTP plumbing. Therefore telemetry must live inside the stream execution path, not only an outer route `try/catch`.

Simple terminal rule:

- emit `agent.chat.stream.started` once when backend execution starts
- emit exactly one terminal event per backend execution:
  - `agent.chat.stream.completed` for normal completion
  - `agent.chat.stream.failed` for harness/generator/tool error
  - `agent.chat.stream.aborted` for client abort/cancel when detectable
- resume/replay endpoints must not emit a second terminal event for an already-finished stream

Acceptance:

- test sink receives stream lifecycle events
- failed stream emits failure event with sanitized error code/status
- successful stream emits completion duration
- aborted stream emits aborted, not completed
- no duplicate terminal events on resume/replay
- no event snapshot includes prompt text

### 12.4 Tool lifecycle events

Preferred design: wrap tools once when building the tool list, not inside every tool implementation.

```ts
function withToolTelemetry(
  tools: AgentTool[],
  telemetry: TelemetrySink,
  getContext: () => TelemetryContext,
): AgentTool[]
```

Wrapper captures:

- `agent.tool.started`
- `agent.tool.completed`
- `agent.tool.failed`

The exact `AgentTool` shape must be read before implementation. Do not assume handler property name.

Acceptance:

- every standard/extra/plugin tool is wrapped once
- wrapper preserves tool schema/name/description/onUpdate behavior
- wrapper does not alter tool result/errors
- failures still propagate to harness
- `agent.tool.failed` is emitted for thrown errors and for tool results with `isError === true`
- wrapper combines binding context (`workspaceId`, `runtimeMode`) with tool execution context (`sessionId`)

### 12.5 Runtime/sandbox events

Locations:

```txt
packages/agent/src/server/registerAgentRoutes.ts
packages/agent/src/server/runtime/*
packages/agent/src/server/sandbox/vercel-sandbox/*
```

First pass can capture at route registration layer:

- runtime binding created
- runtime binding recreated because sandbox expired
- runtime binding creation failed

Avoid deep invasive instrumentation in sandbox adapters until needed.

---

## 13. Workspace implementation plan

### 13.1 Shared contract

Files:

```txt
packages/workspace/src/shared/telemetry.ts
packages/workspace/src/shared/index.ts
```

Browser-safe only. No `node:*`, no `Buffer`.

### 13.2 Provider wiring

Likely files:

```txt
packages/workspace/src/front/WorkspaceProvider.tsx
packages/workspace/src/front/context/*
```

Add telemetry to workspace runtime context.

Acceptance:

- omitted telemetry defaults noop
- plugins/panels can access telemetry through workspace context if needed
- no agent import added to base workspace code

### 13.3 UI events

Capture at central dispatch points, not scattered everywhere.

Preferred central points:

- panel open API / surface resolver dispatch
- command execution registry
- catalog row open helper
- UI bridge command dispatcher
- plugin/panel error boundaries

Acceptance:

- opening a panel emits one event
- command execution emits one event
- failed UI command emits failure event
- plugin error boundary emits error event

### 13.4 Workspace server events

A few workspace events are server-owned, not front-owned. Keep this small and focused.

Wire optional telemetry into:

- `uiRoutes` for UI command HTTP route failures
- `createWorkspaceUiTools` / `exec_ui` for server-posted UI commands
- `createWorkspaceAgentServer` composition helper
- core composed server when it registers workspace UI routes/tools

Acceptance:

- server-posted UI command emits `workspace.ui_command.posted`
- `exec_ui` failure emits `workspace.ui_command.failed`
- no new dependency from workspace server to agent/core internals

---

## 14. App example plan

### 14.1 `apps/full-app` server example

Files:

```txt
apps/full-app/src/telemetry/server.ts
apps/full-app/src/server/main.ts
apps/full-app/src/server/vercel-entry.ts
apps/full-app/.env.example
apps/full-app/README.md
```

Implement a minimal app-level adapter. Depending on dependency appetite:

Option A — dependency-free example:

- use `fetch` to PostHog capture API if configured
- use console or placeholder for Sentry
- document where to plug actual SDK

Option B — real adapters:

- add `posthog-node`
- add `@sentry/node`
- add `@sentry/react` for browser

Recommendation for first implementation: start with dependency-free or optional adapters. Do not force new vendor deps into packages.

### 14.2 Browser example

Files:

```txt
apps/full-app/src/telemetry/browser.ts
apps/full-app/src/front/main.tsx
```

Initialize browser telemetry only if public env vars exist.

### 14.3 CSP updates

Core CSP currently has `connectSrc: ['self']`. If browser telemetry is enabled, child app needs a way to extend CSP connect sources.

Possible approaches:

1. Add core config for CSP extra connect sources.
2. Document that app must override config/security.
3. Server injects CSP based on app config.

This is a blocker for browser PostHog/Sentry in production. Server-side telemetry is not blocked.

Recommended first bead for CSP:

- add config field `security.csp.connectSrcExtra?: string[]`
- wire it through core config schema/loadConfig/types
- use it in `createCoreApp` helmet config
- app example sets PostHog/Sentry hosts when env vars exist

Keep this small: only extend `connect-src`; do not redesign the whole CSP system.

---

## 15. Data flow examples

### 15.1 Chat stream failure

```txt
User sends message
  ↓
ChatPanel/useAgentChat posts to /api/v1/agent/chat/:sessionId
  ↓
agent chat route emits agent.chat.message.sent
  ↓
stream starts: agent.chat.stream.started
  ↓
harness/tool/sandbox throws
  ↓
chat stream executor marks stream failed and emits sanitized terminal event
  ↓
telemetry.captureError(agent.chat.stream.failed)
  ↓
child app adapter sends sanitized event to PostHog/Sentry
```

Captured data:

```json
{
  "name": "agent.chat.stream.failed",
  "context": {
    "workspaceId": "ws_123",
    "sessionId": "sess_456",
    "requestId": "req_789",
    "runtimeMode": "vercel-sandbox"
  },
  "properties": {
    "durationMs": 1832,
    "errorCode": "sandbox_expired",
    "statusCode": 410
  }
}
```

Not captured:

- prompt body
- generated code
- command output

### 15.2 Workspace panel open

```txt
User runs command palette command
  ↓
workspace command registry executes open panel
  ↓
panel open central function emits workspace.panel.opened
  ↓
child app adapter sends to PostHog
```

### 15.3 Multi-account event routing

```txt
agent.chat.stream.failed workspaceId=customer_a
  ↓
app routeEvent reads workspace/customer mapping
  ↓
send to Customer A PostHog project and shared Sentry project

agent.chat.stream.failed workspaceId=customer_b
  ↓
send to Customer B PostHog project and shared Sentry project
```

---

## 16. Performance considerations

Telemetry must be low overhead.

Rules:

- Do not block chat streaming on telemetry network calls.
- Use fire-and-forget safe wrappers for most events.
- Only `flush()` on graceful shutdown if available.
- Avoid serializing large objects.
- Keep properties low-cardinality and small.
- Avoid hashing huge strings/content.
- Batch in child-app adapters if vendor supports it.

Shutdown:

`createCoreApp` already has graceful shutdown handling. If telemetry has `flush`, call it during shutdown/onClose, but do not hang beyond grace window.

---

## 17. Error handling rules

Telemetry must never cause:

- failed HTTP request
- broken chat stream
- broken React render
- failed tool call
- failed app boot, unless the child app adapter intentionally throws during construction

Package helpers swallow runtime telemetry sink errors.

The only errors that should fail boot are explicit child-app configuration errors, e.g. malformed DSN in `createAppTelemetry`, and those happen in app code.

---

## 18. Testing strategy

### 18.1 Unit tests

Core:

- noop/safe helper behavior
- Fastify decoration with noop/custom sink
- error handler emits event on 500
- frontend boundary emits event

Agent:

- noop/safe helper behavior
- `createAgentApp({ telemetry })` wires sink
- `registerAgentRoutes({ telemetry })` wires sink
- chat success/failure events
- tool wrapper success/failure events
- no prompt text in snapshots
- exactly-one terminal stream event for success/failure/abort
- resume/replay does not duplicate terminal events

Workspace:

- provider defaults noop
- panel open event
- command event
- UI command failure event
- plugin error boundary event

### 18.2 Integration tests

- composed `createCoreWorkspaceAgentServer({ telemetry })` receives both core and agent events through one sink
- request workspace ID appears in agent events
- user ID appears when auth hook has populated `request.user`
- telemetry sink rejection does not alter response status/body

### 18.3 Privacy/allowlist tests

Build representative captured events and assert they do not contain forbidden strings:

```ts
expect(JSON.stringify(events)).not.toContain('my secret prompt')
expect(JSON.stringify(events)).not.toContain('DATABASE_URL')
expect(JSON.stringify(events)).not.toContain('file contents')
expect(JSON.stringify(events)).not.toContain('stdout with token')
```

Also assert each emitted event uses only allowed context/property keys for that event name. This is the main guard against accidental object spreading.

Examples:

```ts
expectEventKeys(events, {
  'agent.chat.stream.failed': {
    context: ['workspaceId', 'sessionId', 'requestId', 'runtimeMode'],
    properties: ['durationMs', 'errorCode', 'statusCode'],
    error: ['code', 'statusCode', 'className'],
  },
})
```

### 18.4 Quality gates

Run relevant scoped tests while implementing:

```bash
pnpm --filter @hachej/boring-core test
pnpm --filter @hachej/boring-agent test
pnpm --filter @hachej/boring-workspace test
```

Before close:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm lint:invariants
```

---

## 19. Rollout strategy

### Phase 1 — contracts/noop

Lowest risk. No behavior changes.

Deliver:

- shared telemetry types in all packages
- sanitized error metadata type
- noop and safe helpers
- public exports
- tests

### Phase 2 — core server/front

Deliver:

- `createCoreApp({ telemetry })`
- Fastify decoration
- sanitized error handler capture
- `CoreFront telemetry` prop
- frontend boundary capture

### Phase 3 — agent chat events

Deliver:

- `createAgentApp({ telemetry })`
- `registerAgentRoutes({ telemetry })`
- chat/session stream lifecycle events
- exactly-one terminal stream event semantics
- privacy/allowlist tests

### Phase 4 — composed passthrough

Deliver:

- `createCoreWorkspaceAgentServer({ telemetry })`
- optional `createTelemetry({ config, userStore, workspaceStore })`
- composed frontend telemetry prop forwarding

### Phase 5 — agent tool/runtime events

Deliver:

- tool wrapper
- thrown-error and `isError` failure detection
- runtime binding created/recreated/failed
- sandbox expired/recreated event

### Phase 6 — workspace UI/server UI-command events

Deliver:

- provider context
- panel/command/catalog/UI bridge/plugin error events
- `uiRoutes` and `exec_ui` server-side events

### Phase 7 — CSP support

Deliver:

- `security.csp.connectSrcExtra?: string[]`
- Helmet `connectSrc` append support
- tests for default and extra hosts

### Phase 8 — app examples and docs

Deliver:

- `apps/full-app` app-level adapter example
- README docs
- event taxonomy docs

---

## 20. Risks and mitigations

### Risk: accidental content capture

Mitigation:

- explicit allowlisted properties only
- tests asserting forbidden content absent
- no generic object spreading into telemetry payloads

### Risk: telemetry breaks streaming performance

Mitigation:

- fire-and-forget safe wrappers
- no await in stream hot path unless using in-memory sink in tests
- child-app adapter handles batching

### Risk: event cardinality explosion

Mitigation:

- stable event names
- avoid raw paths/URLs/queries
- avoid arbitrary error messages as dimensions

### Risk: duplicate events frontend/backend

Mitigation:

- define source-of-truth per event
- backend owns chat/tool success/failure
- frontend owns UI interaction events
- if both emit, use different event names (`message.submitted` vs `message.sent`)

### Risk: package dependency tangle

Mitigation:

- structural per-package contracts
- no imports between packages for telemetry types
- no vendor SDKs in packages

### Risk: CSP blocks browser analytics

Mitigation:

- app-level CSP extension config
- docs list required `connect-src` hosts

---

## 21. Open questions

1. Should auth success/failure events be in the first implementation, or deferred until core auth hooks are reviewed?
2. Should file paths be omitted entirely by default or captured as stable salted hashes?
3. Should event names be exported constants, or keep string literals plus docs?
4. Should server request telemetry capture all 4xx or only 5xx?
5. Should we add an explicit user consent API in core front, or leave consent entirely to child apps?
6. Should agent use existing `@opentelemetry/api` dependency for optional spans later?
7. Should child-app examples use actual vendor SDKs or dependency-free fetch adapters?
8. Should telemetry sink support `identify(user)` and `group(workspace)` helpers, or keep only event capture?

Recommendation for v1:

- keep only `capture`, `captureError`, `flush`
- defer `identify/group` to app adapter or future expansion
- start with 5xx/chat/tool/UI events before auth analytics

---

## 22. Bead breakdown

The beads should stay small. Do not build a tracing platform. Ship a simple sink contract, a few high-value events, and tests that prevent content leaks.

### Bead 1 — `telemetry-contracts-noop`

**Goal:** add vendor-neutral telemetry contracts and noop/safe helpers to core, agent, workspace.

Files:

```txt
packages/core/src/shared/telemetry.ts
packages/core/src/shared/index.ts
packages/core/src/shared/__tests__/telemetry.test.ts
packages/agent/src/shared/telemetry.ts
packages/agent/src/shared/index.ts
packages/agent/src/shared/__tests__/telemetry.test.ts
packages/workspace/src/shared/telemetry.ts
packages/workspace/src/shared/index.ts
packages/workspace/src/shared/__tests__/telemetry.test.ts
```

Acceptance:

- types exported from public shared barrels
- noop works
- safe helpers swallow sync/async failures
- `TelemetryErrorEvent.error` is sanitized metadata, not raw `unknown`
- no `node:*` or `Buffer` in shared files

Dependencies: none.

### Bead 2 — `core-telemetry-hooks`

**Goal:** wire telemetry into core server and frontend error boundary.

Files:

```txt
packages/core/src/server/app/types.ts
packages/core/src/server/app/createCoreApp.ts
packages/core/src/server/app/errorHandler.ts
packages/core/src/front/CoreFront.tsx
packages/core/src/front/__tests__/*telemetry*.test.tsx
packages/core/src/server/app/__tests__/*telemetry*.test.ts
```

Acceptance:

- `createCoreApp(config, { telemetry })` decorates app
- 500 handler emits `core.http.request.failed` with sanitized error metadata
- `CoreFront telemetry` captures boundary crash without raw component stack in properties
- telemetry failure does not change responses/rendering

Dependencies: Bead 1.

### Bead 3 — `composed-app-telemetry-passthrough`

**Goal:** pass app-level telemetry through default composed server and front helpers.

Files:

```txt
packages/core/src/app/server/createCoreWorkspaceAgentServer.ts
packages/core/src/app/server/__tests__/*telemetry*.test.ts
packages/core/src/app/front/CoreWorkspaceAgentFront.tsx
packages/core/src/app/front/__tests__/*telemetry*.test.tsx
packages/workspace/src/app/front/WorkspaceAgentFront.tsx
packages/workspace/src/app/front/__tests__/*telemetry*.test.tsx
```

Acceptance:

- simple `telemetry` sink works for composed server
- optional `createTelemetry({ config, userStore, workspaceStore })` works for store-backed routing
- resolved sink is passed to core and agent route registration
- frontend telemetry prop forwards to `CoreFront`, `WorkspaceAgentFront`, `WorkspaceProvider`, and default chat panel params
- omitted sink remains noop

Dependencies: Beads 1-2 and agent options from Bead 4 if done together.

### Bead 4 — `agent-chat-telemetry`

**Goal:** wire telemetry into agent server routes and capture chat/session lifecycle.

Files:

```txt
packages/agent/src/server/createAgentApp.ts
packages/agent/src/server/registerAgentRoutes.ts
packages/agent/src/server/http/routes/chat.ts
packages/agent/src/server/http/routes/sessions.ts
packages/agent/src/server/http/routes/__tests__/*telemetry*.test.ts
```

Acceptance:

- `createAgentApp({ telemetry })` accepted
- `registerAgentRoutes({ telemetry })` accepted and can fall back to structural `app.telemetry`
- chat started/completed/failed/aborted events emitted from the stream execution path
- exactly one terminal stream event per backend execution
- resume/replay does not duplicate terminal events
- message/session events use counts/lengths only
- allowlist/privacy tests pass

Dependencies: Bead 1.

### Bead 5 — `agent-tool-runtime-telemetry`

**Goal:** capture tool and runtime/sandbox failures.

Files:

```txt
packages/agent/src/server/tools/* or new telemetry wrapper location
packages/agent/src/server/registerAgentRoutes.ts
packages/agent/src/server/__tests__/*tool-telemetry*.test.ts
```

Acceptance:

- all tools wrapped once
- started/completed/failed emitted
- failed means thrown error OR `ToolResult.isError === true`
- wrapper preserves schema/name/description/onUpdate/result/error behavior
- runtime binding recreate/failure emits event
- allowlist/privacy tests pass

Dependencies: Bead 4.

### Bead 6 — `workspace-ui-telemetry`

**Goal:** capture workspace UI usage and the small set of workspace-owned server UI command events.

Files:

```txt
packages/workspace/src/front/**
packages/workspace/src/front/components/PanelErrorBoundary.tsx
packages/workspace/src/front/plugin/PluginErrorBoundary.tsx
packages/workspace/src/server/ui-control/http/uiRoutes.ts
packages/workspace/src/server/ui-control/tools/uiTools.ts
packages/workspace/src/app/server/createWorkspaceAgentServer.ts
packages/workspace/src/front/**/__tests__/*telemetry*.test.tsx
packages/workspace/src/server/**/__tests__/*telemetry*.test.ts
```

Acceptance:

- `WorkspaceProvider telemetry` accepted
- panel open/close emits events
- commands emit events
- UI command posted/failure emits events server-side where appropriate
- plugin/panel boundary emits sanitized error event
- no workspace base front/shared value import from agent

Dependencies: Bead 1.

### Bead 7 — `core-csp-connect-src-extra`

**Goal:** let child apps opt into browser telemetry endpoints without weakening CSP globally.

Files:

```txt
packages/core/src/shared/types.ts
packages/core/src/server/config/*
packages/core/src/server/app/createCoreApp.ts
packages/core/src/server/app/__tests__/*csp*.test.ts
```

Acceptance:

- config supports `security.csp.connectSrcExtra?: string[]`
- values append to Helmet `connectSrc`
- default remains `connectSrc: ["'self'"]`
- tests cover default and extra PostHog/Sentry-style hosts

Dependencies: none, but needed before browser telemetry example is useful in production.

### Bead 8 — `full-app-telemetry-example`

**Goal:** show child-app-owned PostHog/Sentry-style routing with minimal dependencies.

Files:

```txt
apps/full-app/src/telemetry/server.ts
apps/full-app/src/telemetry/browser.ts
apps/full-app/src/server/main.ts
apps/full-app/src/server/vercel-entry.ts
apps/full-app/src/front/main.tsx
apps/full-app/README.md
apps/full-app/.env.example
```

Acceptance:

- app creates telemetry adapter
- app passes it into composed server/front
- docs explain plain `telemetry` vs advanced `createTelemetry`
- adapter has `beforeSend`, bounded queue or clear drop behavior, and flush timeout
- docs explain privacy defaults

Dependencies: Beads 2-7.

### Bead 9 — `telemetry-docs-event-taxonomy`

**Goal:** publish stable event taxonomy and privacy policy docs.

Files:

```txt
packages/core/docs/CORE.md or docs/telemetry.md
packages/agent/docs/plans/agent-package-spec.md or package docs
packages/workspace/docs/INTERFACES.md or package docs
README.md
```

Acceptance:

- event names documented
- sanitized payload rules documented
- child app integration documented
- no vendor is presented as mandatory

Dependencies: Beads 1-8.

---

## 23. Recommended implementation order

1. Bead 1 — contracts/noop.
2. Bead 4 — agent chat telemetry, because original user need includes chat session errors.
3. Bead 2 — core error/front hooks.
4. Bead 3 — composed app passthrough.
5. Bead 5 — tool/runtime events.
6. Bead 6 — workspace UI/server UI-command events.
7. Bead 7 — CSP connect-src extra.
8. Bead 8 — app examples.
9. Bead 9 — docs finalization.

Reasoning:

- Chat errors are the urgent user value.
- Contracts are required first.
- Core passthrough is what makes app-level declaration real.
- CSP can wait until browser vendor examples, but must land before production browser telemetry docs.
- Workspace UI events can follow once backend reliability is covered.

---

## 24. Definition of done

Telemetry work is done when:

- child app can pass one telemetry sink into composed boring app
- core emits server/frontend error events
- agent emits chat stream failure/success events
- agent emits tool failure/success events
- workspace emits central UI usage/error events
- no package imports PostHog/Sentry directly
- no prompt/file/command output content is captured by default
- examples show PostHog/Sentry-style routing at app level
- tests prove telemetry failures do not break product behavior
- docs explain event taxonomy and privacy guarantees

---

## 25. Review prompt for next model pass

Use this exact review prompt with a stronger reasoning model:

```txt
Carefully review this entire plan for me and come up with your best revisions in terms of better architecture, new features, changed features, etc. to make it better, more robust/reliable, more performant, more compelling/useful, etc. For each proposed change, give me your detailed analysis and rationale/justification for why it would make the project better along with the git-diff style change versus the original plan shown below:

<PASTE THIS COMPLETE PLAN HERE>
```

After receiving review, integrate revisions in-place and then convert to beads.
