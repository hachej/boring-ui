---
github: https://github.com/hachej/boring-ui/issues/873
issue: 873
state: ready-for-agent
updated: 2026-07-21
flag: not-needed
track: fast
---

# gh-873 CLI ask_user question should appear without page refresh

## Problem

In CLI workspace mode, an `ask_user` question can be pending while the already-open workspace Questions surface remains empty until the user refreshes the page.

Clarified report: the user has repeatedly had to refresh the page to see an ask-user question; the workspace was open, but the Questions area/list was still empty.

## Solution

Investigate and fix the live update path from CLI ask-user server state to the front-end Questions UI. The fix should ensure that when a new pending question is created, an already-mounted CLI workspace receives the pending hint/state and opens or hydrates the question without page refresh.

Likely seams to inspect:
- `plugins/ask-user/src/server/askUserStatePublisher.ts`
- `plugins/ask-user/src/server/askUserBridgeHandlers.ts`
- `plugins/ask-user/src/front/index.tsx`, `plugins/ask-user/src/front/runtime.ts`, and `plugins/ask-user/src/front/providerHooks.ts`
- `packages/cli/src/front/App.tsx` plugin registration / workspace state wiring
- `plugins/ask-user/e2e/ask-user.spec.ts`

## Decisions

- This is a live-delivery/rendering bug, not a request to disable browser refresh.
- Preserve refresh as a recovery path; the product requirement is that refresh is not needed in the normal path.
- Start with a failing no-refresh reproduction test that creates a pending question after the workspace is already mounted.
- Prefer fixing the event/state publication contract over adding client polling, unless the current architecture intentionally lacks event push.
- Do not auto-open/focus the Questions pane for this issue. The expected fix is live state/bridge freshness plus a clear badge/attention indicator; clicking the existing open icon must work without page refresh.

## Flag / Abstraction
- Needed?: no
- Path: ask-user state/event propagation fix with focused test
- Rollback: revert ask-user front/server event handling changes

## Test Seams
- Highest public seam: ask-user plugin e2e/integration where a pending question is created after the page is already mounted and then appears without reload.
- Existing prior art: `plugins/ask-user/e2e/ask-user.spec.ts`, `askUserPlugin.test.tsx`, `askUserStatePublisher.test.ts`.
- Avoid testing: low-level timers unless the bug is specifically a subscription debounce/race.

## Acceptance

- With the CLI workspace already open, triggering `ask_user` updates the visible badge/attention state without refreshing the page.
- Clicking the existing Questions/open icon after the prompt arrives shows the pending question without refreshing the page.
- Existing rehydration on refresh/remount remains working.
- Hidden-session/multi-session question behavior remains intact.
- If live delivery fails, UI should have a clear non-destructive recovery affordance, but not require refresh for the happy path.

## Proof
- Exact command: `pnpm --filter @hachej/boring-ask-user test` for focused unit/integration coverage; if available, also run the specific Playwright ask-user spec.
- Screenshot/demo: question appears in the open Questions pane after triggering a CLI `ask_user` request.
- Manual steps: open CLI workspace, trigger `ask_user`, do not refresh, verify the question appears.
- Waiver if proof is not possible: explain missing CLI browser harness and include focused front/server regression tests.

## Slices

### Slice: Reproduce and fix live ask-user pending delivery
**Delivers:** failing no-refresh reproduction test, then minimal event/state propagation fix at the proven seam.
**Blocked by:** None.
**Proof:** focused ask-user test/e2e or manual CLI demo.
**Review budget:** inside.

## Out of Scope

- Redesigning the entire Questions inbox.
- Changing `ask_user` schema semantics.
- Removing refresh/reload controls globally.

## Grill / Unknowns

### Known-knowns
- Ask-user front tests already cover rehydrating pending questions after provider remount/refresh.
- The user-visible failure specifically says refresh works, so persisted pending state likely exists; live notification/render is suspect.

### Known-unknowns
- Whether the CLI default plugin path receives ask-user state publisher events at all.
- Whether the Questions panel is mounted but subscribed to the wrong session id, or unmounted and never opened from attention state.

### Unknown-knowns
- Resolved UX trigger: do not auto-open; update badge/attention state and ensure the existing open icon/pane hydrates the pending question without refresh.

### Unknown-unknowns / blindspots
- **Concurrency:** multiple sessions/questions may race; fixing active-session only could regress hidden-session pending questions.
- **Failure modes:** event missed during workspace reconnect should fall back to a state pull, not remain empty forever.
- **Migration:** CLI includes ask-user as an internal default plugin; plugin package/runtime discovery differences may bypass normal SSE/plugin updates.
- **Rollback:** no data format change expected.

**Resolved decision:** Do not auto-open/focus. Show a clear badge/attention indicator, and make the existing Questions/open icon hydrate/show the pending question without page refresh.
**Why it matters:** The reported failure was likely a stale UI bridge: even clicking the open icon on top of the composer did not work until refresh.
**Evidence:** Current report says the workspace was open but empty; user clarified the question was not auto-opened and the open icon also failed, suggesting stale live state rather than an intentional focus behavior gap.
**Chosen answer:** fix bridge/front freshness and open-icon hydration; preserve explicit-open behavior.

## Next Action

`/exec #873`
