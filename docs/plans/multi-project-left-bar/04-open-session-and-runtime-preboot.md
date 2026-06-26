# 04 — Open Session Handoff + Runtime Preboot

## Purpose

Make project/session open intent fast and honest:

- target chat UI appears as soon as identity + transcript are ready;
- runtime/sandbox preboot starts after explicit user intent;
- chat render does not wait for runtime;
- first tool/file/runtime step waits inline if preboot is still pending;
- already-mounted cached workspaces receive a live session switch without remount.

Depends on:

- 03 — persistent shell + mounted content cache.

## Current problem

Cross-project open currently does only:

1. `writeActiveSessionId(sessionId, { storageScope: projectId })`
2. `navigate(workspaceHref(projectId))`

That works for first mount, but fails for cached targets that are already mounted: their `usePiSessions` initial state has already run, so they need a live switch signal. Also, there is no explicit runtime preboot trigger separate from rendering the target workspace.

## Desired open flow

Click session S in project B while project A visible:

1. Shell records `openingWorkspaceId = B` and `openingSessionId = S`.
2. Shell calls `writeActiveSessionId(S, { storageScope: B })` synchronously.
3. Shell navigates to `/workspace/B`.
4. Shell emits typed `workspaceEvents.openSession({ workspaceId: B, sessionId: S })`.
5. If B is already mounted, B's `WorkspaceAgentFront` subscriber switches live to S.
6. If B is not mounted, event is ignored; B reads storage on first mount.
7. Shell starts runtime/sandbox preboot for B in background.
8. Shell keeps A visible until B chat UI is ready enough.
9. First tool/file/runtime command waits inline if preboot is still pending.

## Typed event

Add to workspace front events:

```ts
workspaceEvents.openSession: {
  workspaceId: string
  sessionId: string | null
}
```

Consumer rules:

- `WorkspaceAgentFront` subscribes once.
- It ignores events whose `workspaceId !== ownWorkspaceId`.
- It switches session only if the target session belongs to this workspace's session set or is loadable by the session hook.
- It must not create cross-project split panes.

## Runtime preboot trigger

Need an honest backend seam. Do not fake preboot with a UI flag.

Preferred minimal endpoint:

`POST /api/v1/agent/runtime/preboot`

Request:

```json
{ "reason": "open-project" | "open-session" }
```

Workspace scoping:

- uses `x-boring-workspace-id` or existing request workspace resolver;
- idempotent per workspace;
- if runtime already provisioning/ready, returns current readiness;
- must not send chat messages or start agent turns;
- starts `getOrCreateRuntimeBinding` / provisioning path in background.

Response:

```ts
type RuntimePrebootResponse = {
  status: 'started' | 'already-ready' | 'already-starting' | 'not-supported'
}
```

If a real endpoint is too broad for current stack, stop and split this into a prerequisite. Do not pretend preboot exists.

## Inline wait for first tool/file command

Command/tool execution path should already have readiness gates in some places. The requirement here:

- if runtime preboot is pending and user sends a command that needs runtime/tools/files, the chat/tool step shows inline readiness state;
- no page-level loader;
- no lost user message;
- once runtime ready, command proceeds.

Implementation should identify the existing readiness mechanism before adding a new one.

## Tests / acceptance

Event tests:

- Add event type compile/runtime test if event bus has tests.
- Mounted workspace B receives `openSession` and switches session when event workspace id matches.
- Workspace A ignores event for B.
- Non-mounted target still works by storage read on mount.

Core tests:

- Cross-project session click calls `writeActiveSessionId`, `navigate`, emits event, and calls preboot endpoint.
- Cached target B switches without remount (mount counter test from plan 03).
- Same-project session click does not navigate and uses live switch/event path.

Preboot tests:

- Endpoint is idempotent.
- Explicit open intent triggers preboot.
- Project expansion/browsing does not trigger preboot.
- Chat UI render test proves runtime preboot promise does not block visible target chat.
- First runtime/tool command waits inline if preboot incomplete (or test existing readiness gate if already present).

## Out of scope

- Mounted cache implementation (plan 03).
- Store isolation (plan 02).
- Session-list pagination/lazy fetch (plan 01).

## Risks

- Starting preboot on every click can thrash if user rapidly clicks through projects. Debounce or idempotency should make repeated opens cheap.
- Runtime preboot cancellation/teardown on cache eviction may require server support. If not available, document warm runtime TTL/cleanup behavior.
- Event bus must not become a generic untyped global custom-event dumping ground; keep a typed event with explicit workspace id.


## Thermo review fixes

### No-boot transcript/state seam

Rendering an existing chat before runtime readiness requires more than a no-boot session **list**. Current `/state` hydration is runtime-service bound. This plan must add or depend on a no-boot transcript/session-state read path for existing sessions, or it cannot honestly claim chat render does not wait for runtime.

Required options:

1. Add `GET /api/v1/agent/pi-chat/session-state-lite` (name TBD) backed by host `PiSessionStore` that reads transcript/session entries without provisioning runtime; or
2. explicitly make transcript hydration part of runtime readiness and drop the "chat render before runtime" claim.

#385 intends option 1. Add tests proving transcript/state read does not call runtime binding/provisioning.

### First-tool inline wait end-to-end

The client prompt path currently hydrates session state before prompt and can time out/rollback optimistic messages. The plan must define how a user message survives runtime-preboot waits:

- optimistic user message is retained as pending, not lost;
- inline "Preparing workspace…" readiness state is attached to the turn/tool step;
- timeout policy is long enough or retryable for runtime preboot;
- once runtime ready, prompt/tool execution proceeds.

Add acceptance tests for pending prompt surviving delayed preboot.

### Pane-state switch

The `openSession` consumer must switch through the same pane/session path as nav session clicks. It is not enough to call a low-level session API. Tests must assert the target chat pane becomes visible and no cross-project pane is created in the previous workspace.
