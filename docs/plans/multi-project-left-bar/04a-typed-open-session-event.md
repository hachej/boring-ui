# 04a — Typed `openSession` Event + Cached Target Handoff

## Purpose

Add a typed live handoff so already-mounted workspace UIs can switch to a session without remounting.

Depends on:

- 03a persistent shell for cross-project open flow;
- 03b cache for cached inactive target behavior.

## Review budget

Target non-test/non-doc added LOC: **< 1,500**.
Hard cap for PR review: **< 15,000** non-test/non-doc added LOC.

## Scope

- Add `workspaceEvents.openSession` typed event.
- Emit event after `writeActiveSessionId` on explicit open.
- Add `WorkspaceAgentFront` subscriber.
- Subscriber ignores non-matching `workspaceId`.
- Subscriber switches through the same pane/session path as nav session clicks.
- Cached target case works without remount.

## Non-scope

- No-boot transcript/state route (04b).
- Runtime preboot endpoint (04c).
- First-tool wait (04d).

## Event shape

```ts
workspaceEvents.openSession: {
  workspaceId: string
  sessionId: string
}
```

## Tests / acceptance

- A and B mounted, A visible, B hidden.
- Click/open B/session-2:
  - storage write happens;
  - event emitted;
  - B subscriber switches active pane/session;
  - B becomes visible;
  - B did not remount;
  - A ignores event;
  - no cross-project pane created in A.
- Same-project open uses same switch path without navigation.
- Non-mounted B still works via storage read on first mount.

## Risks

- Do not implement this as ad-hoc `CustomEvent` strings. Use existing typed workspace events infrastructure.
- Do not bypass `WorkspaceAgentFront` pane state; visible chat pane must update, not only low-level session data.
