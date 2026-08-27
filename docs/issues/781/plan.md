## Problem Statement

The chat/session list shows stale per-session status because its live "working" badge is currently an in-memory browser overlay: `PiChatPanel` emits `boring:chat-session-status`, and `SessionBrowser` / `AppLeftPane` consume it. That works only while a panel that observes the session lifecycle stays mounted. If the session is switched away, unmounted, or only represented in the list, the list can miss the terminal state and keep showing stale status until a later remount/refresh/event reconciles it.

## Solution

Add a small authoritative session-activity read model at the Pi chat service seam, then make the current-workspace session-list surfaces reconcile their optimistic browser event overlay against that read model.

1. Backend: extend `PiChatSessionService` with optional bulk activity lookup and implement it in `HarnessPiChatService` without cold-instantiating sessions.
2. Wrapper/route: forward the new read method through `withAgentEffectAdmission`, then add a bounded activity endpoint under the Pi chat sessions API.
3. Frontend host/session layer: add a focused activity fetch/poll owner at the workspace host boundary and pass a plain `Map`/record of activity into `SessionBrowser` and `AppLeftPane`. Do **not** import `@hachej/boring-agent` values from workspace base front/shared code.
4. UI: keep `SessionBrowser` and `AppLeftPane` as presentational consumers of the injected activity plus the existing optimistic `boring:chat-session-status` overlay, so working badges clear when the backend reports non-working.
5. Preserve existing browser event behavior for instant start/stop responsiveness; do not make it the source of truth.

Concrete endpoint contract:

```txt
POST /api/v1/agent/pi-chat/sessions/activity
{ sessionIds: string[] }
-> { ok: true, sessions: Array<{ sessionId: string, working: boolean, status: 'idle' | 'submitted' | 'streaming' | 'aborting' | 'error', queuedCount?: number, source: 'live-runtime' | 'persisted' }> }
```

Rules: require/dedupe `sessionIds`, cap at 100 ids, validate id shape consistently with session routes, return only current-workspace accessible sessions or stable 404/validation behavior consistent with existing session APIs, and never instantiate cold Pi sessions just to compute activity. `queuedCount` is informational only in this slice; queued alone clears the working badge unless product later requests a queued badge.

## User Stories / Scenarios

- As a user watching the session list, when the active chat starts or finishes a run, its row changes status promptly without manual refresh.
- As a user switching away from a running session in the current workspace, when that background run finishes, its row clears the working status without needing to reopen that chat pane.
- As a user viewing pinned/open/history sessions for the current workspace, visible non-active session rows reconcile to backend status instead of remaining stale indefinitely.
- As a user during a temporary backend restart, the list may briefly keep the last optimistic state, but it retries/reconciles rather than requiring remount.

## Decisions

- Activity state is separate from `SessionSummary` to avoid changing the session inventory contract and to keep status polling bounded to visible ids.
- Browser `boring:chat-session-status` remains an optimistic overlay only.
- First slice reports Boring-owned live runtime status accurately. Persisted/cold sessions are `idle` unless an already-cheap existing summary can indicate `error`; do not promise standalone Pi process live detection.
- Scope is current/active workspace sessions only. Other-project rows in multi-project chrome are out of scope unless a separate cross-workspace activity contract exists.
- First UI pass renders only the existing working indicator; non-working statuses clear that indicator.

## Flag / Abstraction
- Needed?: No feature flag; this is a bug fix. Keep rollout constrained by using the new activity data only where passed by the host.
- Path: `PiChatSessionService.listSessionActivity` → `withAgentEffectAdmission` forwarding → `/api/v1/agent/pi-chat/sessions/activity` → host-owned activity poller/provider → injected activity props for `SessionBrowser` / `AppLeftPane`.
- Rollback: Stop passing activity props and/or remove the route/method; the existing event-only badges continue to work as before.

## Test Seams
- Highest public seam: HTTP route tests for the activity endpoint plus frontend host/component tests that simulate status events and backend reconciliation.
- Existing prior art: `packages/agent/src/server/http/routes/__tests__/piChat.test.ts`, `packages/agent/src/server/__tests__/registerAgentRoutes.test.ts`, `packages/agent/src/core/piChatSessionService.ts`, `packages/agent/src/front/chat/session/__tests__/usePiSessions.test.tsx`, `packages/workspace/src/front/chrome/session-list/__tests__/SessionBrowser.test.tsx`, `packages/workspace/src/front/layout/plugin-tabs/__tests__/AppLeftPane.test.tsx`, and `docs/issues/594/session-status-spike.md`.
- Avoid testing: native Pi internals, exact timer durations beyond bounded retry/poll behavior, visual styling snapshots, cross-workspace status, or standalone external Pi live status.

## Acceptance

- When a current-workspace session status changes from working to idle/error, `SessionBrowser` updates without manual refresh, remount, or navigation away/back.
- `AppLeftPane` uses the same reconciled behavior for current/active workspace session rows.
- Active-session and current-workspace visible non-active-session rows update correctly.
- The backend activity lookup does not instantiate cold Pi sessions just to compute activity.
- `withAgentEffectAdmission` preserves/forwards the new read method in runtimes that use the wrapper.
- Tests cover optimistic event update and later backend reconciliation/clearing.

## Proof
- Exact command: `pnpm --filter @hachej/boring-agent test -- piChat registerAgentRoutes piChatSessionService usePiSessions` and `pnpm --filter @hachej/boring-workspace test -- SessionBrowser AppLeftPane`.
- Type/invariant command: `pnpm --filter @hachej/boring-agent typecheck` and `pnpm --filter @hachej/boring-workspace typecheck`.
- Pre-manual gate: do **not** ask a human to retest until all of these are true:
  1. implementation branch contains the activity route/hook/UI wiring;
  2. automated tests above are green;
  3. playground has been restarted from that exact branch/SHA;
  4. `POST /api/v1/agent/pi-chat/sessions/activity` returns 200 in the playground backend;
  5. logs or UI-visible version notes identify the tested branch/SHA.
- Agent smoke before human handoff: reproduce the scenario locally or with Playwright/devtools once and capture the observed before/after status transition. If this cannot be automated, capture backend logs showing activity polling and a screenshot/video of the row clearing.
- Screenshot/demo: start a chat run, keep the session list visible, switch to another current-workspace session or pane, and show the original row clearing its working badge when the run completes without refresh/remount.
- Manual steps: trigger a session state transition, leave the list visible, verify the row status changes promptly for active and non-active visible sessions.
- Waiver if proof is not possible: include focused route + host/component tests and a manual note explaining why browser demo was unavailable.

## Slices

### Slice: Authoritative session activity read model
**Delivers:** Service DTO/type, `HarnessPiChatService` implementation, `withAgentEffectAdmission` forwarding, route/schema, and backend route/wrapper/service tests for live working and persisted idle sessions.  
**Blocked by:** None.  
**Proof:** route/service tests proving activity returns `working: true` for a live/streaming known channel and `working: false` for listed cold sessions without creating channels; wrapper/register-route tests proving the method is available with admission wrapping.  
**Review budget:** inside if confined to service interface/wrapper/route/service tests; split if it touches unrelated session lifecycle or changes `SessionSummary`.

### Slice: Reconciled current-workspace session-list status UI
**Delivers:** Host-owned activity polling/reconciliation, injected activity props, and wiring into `SessionBrowser` and `AppLeftPane` without workspace importing agent values.  
**Blocked by:** Authoritative session activity read model.  
**Proof:** frontend tests simulating `boring:chat-session-status` `working: true`, mocked activity response `working: false`, and assertion that the visible row clears without remount; tests for both list surfaces and current-workspace scoping.  
**Review budget:** inside if confined to host polling plus the two list surfaces; split if it starts refactoring session insertion, search, or multi-project cross-workspace behavior.

## Wide Refactor Strategy

Not applicable. This should be a narrow expand → consume path, not a broad session-list rewrite.

## Out of Scope

- Detecting standalone external Pi process live status.
- Cross-workspace/other-project status polling in multi-project chrome.
- Rebuilding the session browser or app-left pane.
- Solving delayed insertion of newly created chats (#778).
- Adding queued/error badges or task-card session activity badges beyond clearing the existing working indicator.

## Open Questions

- What exact poll interval is acceptable for “promptly” while avoiding noisy session-list traffic? Recommended first pass: bounded interval while mounted/visible (for example 2–5s), plus immediate reconcile after optimistic status events.

## Adversarial Review Result

Accepted and addressed: avoid workspace→agent value imports, forward through `withAgentEffectAdmission`, scope to current workspace, define a concrete DTO/endpoint contract, clarify queued semantics, add wrapper/typecheck proof, make review-budget split triggers concrete, and remove #778 overlap.

## Next Action

`ready-for-agent` — implement Slice 1 first, then Slice 2.
