# ask_user review fixes TODO

Track work requested after Gemini/Grok/Claude Opus review.

## Must fix before merge

- [x] Fix server/front ask-user plugin asymmetry
  - Decide/implement ask-user as symmetric opt-in or symmetric default with opt-out.
  - Prevent server exposing `ask_user` when front has no Questions provider/pane.
- [x] Remove ask-user constants from generic workspace server shell
  - Add generic plugin-owned preserved UI state keys.
  - Aggregate preserved keys from server plugins.
  - Stop importing `ASK_USER_UI_STATE_SLOTS` in `createWorkspaceAgentServer.ts`.
- [x] Dispose `AskUserStatePublisher`
  - Capture `start()` cleanup.
  - Run cleanup on Fastify/server close or plugin lifecycle close.

## Should fix if quick

- [ ] Remove `surfaceKind` from agent-side `ComposerBlocker`
  - Agent should render opaque actions only.
  - Workspace host keeps surface metadata in workspace blocker type.
- [ ] Stop polling `/api/v1/ui/state` every 500ms forever
  - Prefer SSE/invalidation, or reduce polling and refresh on relevant commands.
- [ ] Avoid mutating `request.meta` in `dispatchUiCommand`
  - Clone local request/meta before adding `closeWorkbenchOnDone`.

## Validation

- [x] Targeted ask-user/chat tests
- [x] Workspace typecheck
- [x] Agent typecheck
- [x] Push branch
