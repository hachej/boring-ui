---
github: https://github.com/hachej/boring-ui/issues/1086
issue: 1086
state: ready-for-agent
updated: 2026-08-05
flag: not-flaggable
track: owner
---

# gh-1086 Inline agent questions and Inbox review pane

## Problem

A pending `ask_user` question has two jobs:

1. it must be answerable in the conversation where the agent requested it; and
2. it must be reachable from Inbox when the user is working elsewhere.

Today the latter route calls the generic artifact capability, which opens the
full `SurfaceShell` workbench. That makes evidence outrank the question: the
user is moved from an attention task into file-tree, tabs, and workspace chrome.

## Product decision

One pending question, identified by `(agentTypeId, sessionId, questionId)`, has
two presentations and one state/answer path:

- **Chat presentation:** an inline interactive question card in the originating
  transcript. It renders the question context, form, artifact affordance, and
  submit/cancel behavior in the chat where the request occurred.
- **Inbox presentation:** a focused `ask-user.questions` Workspace pane for
  the exact same pending question. It is a normal pane opened from Inbox, not a
  left-menu surface and not a new workspace-wide mode.

Both presentations share `QuestionsRuntime`, the existing pending-question
store, the attention blocker, and the existing bridge answer/cancel operations.
Answering or cancelling in either location resolves the same blocker and makes
the other presentation disappear or become resolved.

An artifact remains evidence attached to the question. Its compact preview is
inline when practical. A user may explicitly open the artifact in the existing
Workbench for editing, multi-file investigation, or a viewer that needs larger
space. General agent `openSurface` commands continue to open the Workbench;
this issue changes only the Inbox route for a pending ask-user item.

## Non-goals

- No persistent/global compact, review, or workspace view mode.
- No new left rail/menu, nested Dockview, mini-workbench, or ephemeral tabs.
- No second artifact viewer or new generic surface kind.
- No review-mode editing: edit/diff and deep inspection retain existing
  Workbench routing.
- No change to non-blocker artifact opens in v1.
- No change to the `UiBridge.postCommand` dispatch authority.

## Existing seams

- `plugins/ask-user/src/front/index.tsx` owns `QuestionsRuntime`,
  `QuestionsPane`, its current session-selection policy, answer/cancel calls,
  and the `questions` surface resolver.
- `plugins/ask-user/src/front/primitives/QuestionForm.tsx` is the existing
  typed form primitive and must be reused by both renderers.
- `plugins/ask-user/src/front/inbox/WorkspaceInboxShellContext.tsx` is the sole
  Inbox-to-artifact routing boundary.
- `packages/workspace/src/app/front/useWorkspaceShellCapabilitiesController.ts`
  already supports panel artifacts as ordinary Workspace panes and routes
  surface artifacts to the full Workbench.
- `packages/workspace/src/app/front/WorkspaceAgentFront.tsx` owns shell state,
  resolver access, layout composition, and the canonical Workbench dispatch.
- `packages/workspace/src/front/chrome/chat/ChatPanelHost.tsx` receives
  session-scoped blockers and is the current chat-to-question opening seam.
- `packages/workspace/src/front/bridge/uiCommandDispatcher.ts` must retain its
  current `openSurface` -> Workbench behavior.

## Decisions

### D1 — Inbox opens the existing Questions panel directly

`WorkspaceShellArtifactTarget` already supports `{ type: "panel",
panelComponentId, params }`, and the shell capability opens that as an ordinary
Dockview pane without `SurfaceShell`. Change the ask-user Inbox artifact adapter
to emit the existing `ask-user.questions` panel with exact `questionId` and
`sessionId` params. Generic surface artifacts retain their existing Workbench
route; no new capability option or `UiCommand` behavior is needed.

The composer blocker’s current `openSurface` path remains unchanged: it is an
agent/session-local escalation. Inbox is the only route changed by this issue.

### D2 — The Questions renderer is hostable and target-authoritative

Extract the current pane body/submit/cancel behavior into a reusable question
renderer. It accepts an explicit session/question target, an explicit-target
hosting mode, and an optional host close callback. For Inbox, the target wins
over the active session and bypasses the existing hidden-session auto-close
policy; this prevents an Inbox item for session B from showing session A's
question or flash-closing before it hydrates. The existing Questions
center-pane uses the same renderer with its current selection fallback.

Remove the obsolete private `__closeWorkbenchOnDone` parameter after the Inbox
route no longer opens `SurfaceShell`; submit/cancel close only their hosting
Questions pane.

### D3 — Inline chat uses the existing `ask_user` tool-renderer seam

The chat already merges plugin `toolRenderers` by tool name, so ask-user
registers an `ask_user` tool renderer rather than inventing a transcript
contribution protocol. That renderer receives the tool call part and must match
it to a pending question deterministically.

Thread the Pi `toolCallId` through `createAskUserTool` into `runtime.ask`, then
persist/publish it with the pending question and its hint. The renderer resolves
`part.toolCallId -> pending question` through `QuestionsRuntime` and mounts the
same reusable question renderer. It must never infer identity from display text,
the active session, or the DOM.

### D4 — Artifact handling is progressive disclosure

The inline card shows an attached artifact affordance and a compact preview only
where the registered viewer supports it without a separate renderer. `Open in
workspace` routes the unchanged `SurfaceOpenRequest` through the existing
resolver/Workbench path. Complex/multi-file artifacts use that action rather
than turning the inline card or Questions pane into an IDE.

### D5 — Inbox pane is ordinary Workspace placement

Inbox opens `ask-user.questions` as a focused Workspace pane with the exact
`questionId` and `sessionId`; it does not open `SurfaceShell` as a right-side
artifact surface. Pane close leaves the blocker pending. Submit/cancel closes
only the question pane and leaves unrelated Workspace state unchanged.

## Flag / Abstraction

- Needed?: No rollout flag. This is a local presentation/routing correction
  in the ask-user Inbox artifact adapter.
- Path: ask-user Inbox blockers emit the existing panel artifact variant with
  exact params; other artifacts retain their current generic route.
- Rollback: restore the ask-user blocker artifact to its current `questions`
  surface target. No persisted-data migration is involved.

## Slices

### Slice 1: Reusable, exact-target question presentation

**Delivers:**
- A renderer-independent pending-question body using the existing
  `QuestionForm` and bridge client.
- Explicit target semantics that select `(sessionId, questionId)` before any
  active-session fallback.
- `toolCallId` persisted/published with a pending question and its hints.
- An `ask_user` tool renderer that matches its tool-call id to that pending
  question and mounts the shared renderer inline in chat.
- Existing `ask-user.questions` pane migrated to the same renderer, including
  explicit-target hosting that does not auto-close a hidden session.

**Blocked by:** None.

**Implementation constraints:**
- Keep `QuestionsRuntime` as the sole state source.
- Preserve one-pending-question-per-session storage semantics.
- Match typed `toolCallId` data; no display-text, active-session, or DOM
  inference.
- An inline submit/cancel must update the existing blocker and unblock the
  waiting agent exactly once.

**Proof:**
- Plugin component tests prove inline and pane presentations show the same
  exact target despite another active pending question.
- Submit/cancel tests prove one bridge command, shared state transition, and
  no stale inline card.
- `pnpm --filter @hachej/boring-ask-user test -- askUserPlugin QuestionForm`
- `pnpm --filter @hachej/boring-ask-user typecheck`

**Review budget:** Inside one focused PR. The existing plugin tool-renderer
seam is sufficient once the pending-question contract retains `toolCallId`.

### Slice 2: Inbox-to-Questions-pane review routing

**Delivers:**
- Inbox blockers emit the existing panel-artifact variant for the exact
  `ask-user.questions` pane, without opening `SurfaceShell`/Workbench artifact
  chrome.
- Explicit `Open in workspace` continues to route the same surface request
  through `UiBridge.openSurface` and the existing resolver.

**Blocked by:** Slice 1, because the target-authoritative shared renderer makes
the dedicated pane correct for a non-active session.

**Implementation constraints:**
- Keep generic/default artifact calls on the existing Workbench path.
- Do not change `WorkspaceShellCapabilities` or `uiCommandDispatcher`
  semantics for generic agent commands.
- Pane close is non-destructive; only submit/cancel resolves an attention
  blocker.
- Work in classic and plugin-tabs layouts; do not gate the pane on the app-left
  Inbox overlay.

**Proof:**
- Workspace front test proves Inbox pane open does not set `surfaceOpen`.
- Inbox/adaptor test proves an ask-user blocker emits a panel artifact with
  exact session/question params while other artifacts retain their surface path.
- Escalation test proves the same target reaches the existing surface resolver.
- `pnpm --filter @hachej/boring-workspace test -- WorkspaceAgentFront useWorkspaceShellCapabilitiesController`
- `pnpm --filter @hachej/boring-workspace typecheck`
- Browser proof: create a question in session A, switch to session B, open it
  from Inbox, answer it, and verify session A unblocks without changing
  unrelated Workbench panes.

**Review budget:** Inside one focused PR after Slice 1. Do not combine broad
artifact-preview work or general Inbox redesign.

## Test seams

- `plugins/ask-user/src/front/__tests__/askUserPlugin.test.tsx`
- `plugins/ask-user/src/front/primitives/__tests__/QuestionForm.test.tsx`
- `packages/workspace/src/app/front/__tests__/WorkspaceAgentFront.test.tsx`

- Existing ask-user E2E, if it can drive cross-session Inbox state reliably.

Avoid snapshotting duplicated form markup. Test the shared target, actions,
blocker transition, and routing outcome at public seams.

## Acceptance

1. A pending agent question is answerable inline in its originating chat.
2. The same pending question is openable from Inbox as a dedicated Workspace
   Questions pane, not the broad artifact Workbench.
3. Both entry points render the same question and use one answer/cancel state
   path; answering either resolves the same blocker exactly once.
4. Inbox routing preserves its exact session/question target even when another
   chat is active.
5. Explicit Workbench escalation retains the current resolver and
   `UiBridge.openSurface` behavior.
6. No new persistent view mode, left navigation, nested Dockview, or duplicate
   artifact renderer is introduced.

## Risks / open questions

- `toolCallId` must remain available from tool invocation through pending-store
  persistence and state publication; prove restart/hydration does not lose it.
- Inline display of arbitrary artifact types must reuse registered viewers or
  degrade to an explicit open action. Do not promise every viewer inline in v1.
- A question may have several artifacts. V1 should show a compact attachment
  list and one active target; cross-artifact comparison remains Workbench work.

## Next

Fable plan review accepted the two-slice direction after resolving the inline
identity, Inbox routing, and hidden-session close-policy details. Implement
Slice 1 in this isolated worktree, then review it before Slice 2.
