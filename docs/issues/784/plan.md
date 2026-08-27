# Plan for #784 — Feedback skill discovery and chat question focus regressions

## Problem Statement

Four related regressions make the workspace chat/control-plane feel unreliable:

1. The `feedback` skill exists in the workspace (`.agents/skills/feedback/SKILL.md`) but was not advertised in this session's `<available_skills>` list, so users cannot reliably invoke it.
2. An `ask_user`/question from a background chat session can steal focus or open the Questions surface while the user is working in another session.
3. Pending questions sometimes do not render until a browser refresh.
4. Creating a new chat sometimes leaves the previous session focused instead of selecting the new session.

The shared theme is session-scoped state not being routed, refreshed, and focused consistently across the Pi chat panel, workspace attention/questions layer, and skill discovery runtime.

## Solution

Implement as **independent PR-sized slices**, not one broad branch. The slices touch different packages and should land separately unless investigation proves a shared root cause.

1. **Skill discovery contract:** `.agents/skills` is canonical. Confirm every relevant runtime/app mode, including remote/core worker mode, includes workspace skills and advertises `feedback`. Add regression coverage.
2. **Question event refresh:** make pending question state update via the existing UI command/state bridge without requiring a page refresh. Preserve `questions.pending` across reloads, but rely on live event/state propagation during normal use.
3. **Session-gated question opening:** keep background questions as attention/session badges. Only auto-open the Questions surface when the owning chat session is active/open. Use or tighten the existing `openOnlyWhenSessionOpen` policy and `WORKSPACE_SURFACE_OPEN_SKIPPED_EVENT` path rather than adding a second routing mechanism.
4. **New-chat focus:** ensure every successful in-panel new session creation selects/persists the created session and that follow-up refreshes cannot restore the previous active session over the optimistic selection.

Prefer focused fixes in existing seams rather than new global stores. The implementation should not make all questions global-modal, and it should not bypass session scoping to paper over stale state.

## User Stories / Scenarios

- As a user, when I type a request that should use `feedback`, the skill is listed and can be loaded from the workspace skill directory.
- As a user in session A, if session B asks a question, I see an attention indicator for B but my active chat and workbench focus stay on A.
- As a user, when I later open session B, its pending question opens automatically in the Questions surface.
- As a user, pending questions appear without a hard browser/page refresh.
- As a user, when I click/create a new chat, the newly created session becomes the active/focused chat immediately.

## Decisions

- Canonical workspace skill path: **`.agents/skills`**. Do not move `feedback` to `.agent`; fix discovery/configuration so `.agents/skills/feedback` is advertised.
- Remote/core worker mode should also support workspace skill discovery for `.agents/skills`; if current code intentionally excludes it, change that invariant deliberately with tests and documented safeguards.
- Model background questions as attention/blockers tied to `sessionId`, not as active-session chat navigation commands.
- Use existing surface dispatch policy (`openOnlyWhenSessionOpen`, `shouldOpenSurface`, skipped event) as the guardrail for auto-opening questions.
- New-chat focus should be owned by the session model (`usePiSessions.create()` / active session persistence), not by ad hoc DOM focus hacks.

## Flag / Abstraction

- Needed?: No runtime feature flag expected. This is bug-fix behavior restoring intended session-scoped routing and workspace skill discovery.
- Path: Existing abstractions: Pi skill `additionalSkillPaths`, workspace bridge/UI state (`questions.pending`), attention provider/blockers, `dispatchUiCommand`, `ChatPanelHost`, `usePiSessions`/`PiChatPanel`.
- Rollback: Revert the focused slice/PR. No data migration. If question auto-open regresses, disable only the auto-open-on-owning-session path while preserving attention badges.

## Test Seams

- Highest public seam:
  - Skill discovery: server/runtime tests that inspect `getPi().additionalSkillPaths` and generated available skill prompt/snapshot in each app mode that can run workspace agents.
  - Question routing: workspace front tests around `WorkspaceAgentFront`, `ChatPanelHost`, `dispatchUiCommand`, and attention/session list behavior.
  - New-chat focus: `packages/agent/src/front/chat/__tests__/PiChatPanel.test.tsx` and/or `usePiSessions` tests.
- Existing prior art:
  - `packages/cli/src/server/modeApps.ts` currently adds `join(workspaceRoot, ".agents", "skills")` to Pi `additionalSkillPaths` for one local-hub path.
  - Core/remote-worker paths may currently exclude per-workspace skills; that exclusion must be revisited for this issue.
  - `packages/workspace/src/front/bridge/__tests__/uiCommandDispatcher.test.ts` already verifies session-gated `openSurface` skip behavior.
  - `packages/workspace/src/front/chrome/chat/__tests__/ChatPanelHost.test.tsx` verifies blocker actions dispatch question surfaces with `{ sessionId, openOnlyWhenSessionOpen: true }`.
  - `packages/workspace/src/app/front/__tests__/WorkspaceAgentFront.test.tsx` has question surface/session-open coverage.
  - `packages/agent/src/front/chat/session/usePiSessions.ts` optimistically `setActiveSessionId(session.id)` on create.
- Avoid testing:
  - Browser focus implementation details or brittle tab order.
  - Full end-to-end agent runs unless a manual demo is cheaper than mocking the UI command stream.
  - Duplicating coverage at every layer; one high-level behavior test plus targeted unit tests per changed seam is enough.

## Acceptance

- `feedback` appears in `<available_skills>`/runtime skill discovery for this workspace after normal reload/startup in the affected app mode(s).
- A pending question from inactive session B does not switch the active chat from session A and does not open the Questions surface over A.
- Session B displays a visible attention/question signal while inactive.
- Opening/selecting session B auto-opens or reveals its pending question without a page refresh.
- Question state updates through normal event/state propagation; a hard refresh is not required to see a newly pending question.
- Creating a new chat selects/focuses the new session and persists that active selection; subsequent session refresh does not revert to the previous session.
- Existing active-session question behavior, blocker actions, explicit “Open Questions”, session switching, delete, reset, and external-session hosts remain working.

## Proof

- Exact command:
  - `pnpm --filter @hachej/boring-workspace test -- --runInBand` or the narrower changed workspace test files if this repo’s test runner supports file filters.
  - `pnpm --filter @hachej/boring-agent test -- --runInBand` or targeted Pi chat/session tests.
  - Add a targeted skill-discovery test in the package that owns `getPi`/prompt generation and run that package’s test command.
- Screenshot/demo:
  - Required for no-refresh/focus behavior: two chat sessions where B receives a pending question while A is active; show A remains active, B gets a question badge, no browser refresh happens, then clicking B opens the Questions surface.
  - Create a new chat and show the active session changes to the newly created session.
- Manual steps:
  1. Reload/start the workspace and verify `feedback` is advertised/usable.
  2. Open/create session A and session B.
  3. Cause B to emit an `ask_user` question while A is active.
  4. Verify no focus steal, no page refresh, B attention badge, and auto-open on selecting B.
  5. Create a new chat from the chat UI and verify the new chat is selected.
- Waiver if proof is not possible:
  - Unit/jsdom tests are not enough to prove “no browser refresh”. If a real background agent question is hard to orchestrate locally, use a test-only seeded bridge/UI-command fixture plus a short manual clip of production UI behavior.

## Slices

### Slice: Restore and prove feedback skill discovery
**Delivers:** `feedback` is consistently advertised from `.agents/skills` in every affected workspace-agent runtime mode, with regression tests documenting the canonical path.  
**Blocked by:** None — product decision resolved: `.agents/skills` canonical; remote/core worker mode should support workspace skills.  
**Proof:** Targeted server/runtime skill discovery tests plus manual check of `<available_skills>` after reload/startup.  
**Review budget:** inside if limited to skill path plumbing; exceeds if broader remote-worker isolation/security assumptions change.

Implementation notes:
- First identify the exact failing runtime/app mode for this report: local hub, core server, remote worker, or another harness path.
- Start from `packages/cli/src/server/modeApps.ts` for the known-good `.agents/skills` local-hub path, then inspect `packages/core/src/app/server/createCoreWorkspaceAgentServer.ts`, `packages/workspace/src/app/server/createWorkspaceAgentServer.ts`, and plugin/runtime snapshot paths for omissions.
- If remote/core worker mode intentionally excluded per-workspace skills, replace that invariant deliberately: keep split-brain safeguards, add tests, and document why workspace skills are now included.
- If the loader filters malformed skills, inspect why `.agents/skills/feedback/SKILL.md` is excluded before changing paths.

### Slice: Make pending questions live-update without refresh
**Delivers:** newly pending questions update the Questions/attention state through existing bridge/event plumbing without browser refresh.  
**Blocked by:** Check open PR/branch status for #778/#781 first; if shared session-state work is in flight, sequence/rebase rather than edit in parallel.  
**Proof:** Focused test that simulates a pending-question bridge/state update and asserts Questions/attention state updates without component remount; required manual no-refresh demo/GIF.  
**Review budget:** inside if limited to missed subscription/invalidation; exceeds if it changes global event architecture.

Implementation notes:
- Timebox investigation first. Classify root cause as:
  - (a) missed subscription/invalidation/preserved-state update — implement in this slice, or
  - (b) architectural event model gap — stop and create/escalate a broader plan rather than hiding a refactor inside #784.
- Inspect `questions.pending` preservation, `WorkspaceAttentionProvider`, `emitWorkspaceAttentionAction`, UI command stream/polling fallback, and browser state bridge routes.
- Prefer fixing missed subscription/invalidated state over adding polling unless the existing architecture is intentionally polling-based.

### Slice: Session-gate automatic question opening
**Delivers:** background-session questions become attention indicators only; auto-open happens when the owning session is active/open.  
**Blocked by:** Slice “Make pending questions live-update without refresh” for reliable pending state.  
**Proof:** Tests for inactive-session skip and active-session open using `openOnlyWhenSessionOpen`; required two-session manual demo/GIF.  
**Review budget:** inside, but needs high-taste UI review because focus-stealing is user-visible.

Implementation notes:
- Reuse existing policy in `dispatchUiCommand` and `ChatPanelHost` (`meta: { sessionId, openOnlyWhenSessionOpen: true }`).
- Verify the host’s `shouldOpenSurface` compares the command `sessionId` with the active chat/session, and that skipped openings are remembered or retried when the owning session becomes active.
- Ensure explicit user actions such as clicking “Open Questions” still work when appropriate.

### Slice: Make new-chat creation focus the created session robustly
**Delivers:** new chat creation selects/persists the created session and refresh reconciliation cannot roll back to the previous active session.  
**Blocked by:** Check open PR/branch status for #778/#781 first; if shared session-state work is in flight, sequence/rebase rather than edit in parallel.  
**Proof:** `PiChatPanel`/`usePiSessions` test where create resolves then refresh returns stale/previous data; assert active id remains the created session. Manual new-chat demo.  
**Review budget:** inside.

Implementation notes:
- `usePiSessions.create()` already sets active session optimistically. Investigate refresh/load reconciliation, storage scope, persisted active id, external session mode, and any host wrapper that may keep rendering the previous `sessionId`.
- Cover both in-panel New Chat and any external entrypoint if cheap; otherwise document external entrypoint as follow-up/covered by #778.

## Wide Refactor Strategy

Not a wide refactor as planned. If investigation shows the same stale event/state issue underlies #778, #781, and #784, use expand → migrate batches → contract only under a separate broader plan:

1. Expand: add a single tested invalidation/refresh event path that coexists with current behavior.
2. Migrate batches: move session status, session list, and question pending updates onto it one at a time.
3. Contract: remove duplicate/manual refresh hacks only after tests cover all affected surfaces.

## Out of Scope

- Rewriting the Questions panel UX.
- Changing the public `ask_user` tool schema.
- Creating a new global notification system.
- Solving all session-list stale-status issues from #781 unless required for question state.
- Solving all external-entrypoint chat creation issues from #778 unless required for new-chat focus.
- Moving `feedback` to `.agent/skills`; `.agents/skills` is canonical.

## Open Questions

None blocking implementation.

## Adversarial Review Result

Reviewer found the first draft too broad as a single unit and flagged two skill-discovery decisions: canonical path and whether remote/core worker mode should scan workspace skills. The user answered:

- Canonical path: keep `.agents/skills`.
- Remote/core worker mode: yes, it should scan/support workspace skills.

Accepted revisions:

- Split the work into independent PR-sized slices.
- Added app-mode identification and remote/core-worker investigation to Slice 1.
- Added stop condition for Slice 2 if the root cause is architectural.
- Added #778/#781 sequencing preconditions for shared session-state slices.
- Made manual demo/GIF required for no-refresh/focus proof.

## Loop Exit

State: `ready-for-agent`

Next action: implement Slice 1 first as a standalone PR. Slices 1 and 4 are independent; sequence Slice 2 before Slice 3. Do not bundle all four slices in one implementation branch.
