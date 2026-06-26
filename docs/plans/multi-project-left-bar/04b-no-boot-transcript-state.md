# 04b — No-Boot Session Transcript/State Read

## Purpose

Allow existing chat/session UI to render before runtime/sandbox readiness.

A no-boot session **list** is not enough. Opening an existing session needs enough transcript/session state to render chat without provisioning runtime.

Depends on:

- 01 no-boot session list route patterns.

## Review budget

Target non-test/non-doc added LOC: **< 2,500**.
Hard cap for PR review: **< 15,000** non-test/non-doc added LOC.

## Scope

- Add a no-boot read path for a specific session transcript/state, backed by host `PiSessionStore` or equivalent file-backed store.
- It must not call runtime binding/provisioning.
- Front-end session hydration can use this path when opening existing sessions before runtime readiness.
- Preserve existing runtime-bound full state path where needed for active agent operations.

## Possible endpoint

Route name:

`GET /api/v1/agent/pi-chat/session-state-lite?sessionId=<id>&limit=<n>&beforeSeq=<seq?>`

Response schema mirrors the renderable subset of the existing Pi chat snapshot without live runtime handles:

```ts
type PiChatSessionStateLite = {
  sessionId: string
  title?: string | null
  seq: number
  messages: PiChatRenderableMessage[]
  hasMoreBefore: boolean
  nextBeforeSeq?: number
  updatedAt?: string | number
}
```

Rules:

- `limit` defaults to 100 and clamps to 200.
- Return the newest renderable messages up to `limit` unless `beforeSeq` requests an older page.
- `hasMoreBefore` indicates transcript history before the returned window.
- Conversion to renderable message shape must reuse existing Pi session parsing helpers where possible.

## Tests / acceptance

Backend:

- happy path returns transcript/state from file-backed session store;
- runtime binding/provisioning counter remains 0;
- forbidden/not-found errors use stable envelope;
- large transcript behavior is bounded: `limit` clamps to 200, `hasMoreBefore` and `nextBeforeSeq` expose older pages.

Frontend:

- opening existing target session renders transcript without waiting for runtime preboot;
- lite open does not call runtime-bound `/state`, `/events`, prompt, or service paths until an explicit runtime-bound operation/readiness transition;
- if lite state fails, UI shows session-level error without page takeover;
- runtime-bound operations still use normal service path when needed.

## Out of scope

- Sending prompts/tool execution.
- Runtime preboot endpoint.
- Mounted workspace cache.

## Risks

- Duplicating transcript parsing logic can drift from runtime-bound state. Prefer reusing `PiSessionStore` parsing helpers.
- Large transcripts must use the concrete windowing contract above; do not return unbounded JSONL.
