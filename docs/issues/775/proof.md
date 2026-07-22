# #775 follow-up proof

## Contract covered

- Bare native Pi transcripts are admitted, listed, and loaded only when the direct/local composition grants the unscoped-native capability; scoped/hosted behavior remains unchanged.
- Native first-send is an explicit direct/local capability from server route composition through `WorkspaceAgentFront` and `PiChatPanel`; Vercel, hosted, and custom modes do not mount the native-prompt route or create browser-local chats.
- A first-send receipt includes `nativeSessionId` and `firstSendState`. `prompt_failed` is an explicit `accepted: false`, retryable `NATIVE_SESSION_START_PROMPT_FAILED` outcome: after response loss, its stored receipt settles the original optimistic nonce and adopts the native session ID, leaving the native pane idle and retryable. A native ID is adopted on persistence even when the prompt failed, so draft/error survive in that native pane and switching/deleting targets its only transcript. Same-key retry returns the identical stored receipt. A restart returns `NATIVE_SESSION_START_OUTCOME_UNKNOWN` with `details.firstSendState: "unknown"`.
- The direct/local route test uses the real Pi harness and `PiSessionStore`, proving one bare Pi JSONL with no `pi_session_file` wrapper when post-persistence model/resource/adapter setup fails. The CLI's two actual `WorkspaceAgentFront` mounts explicitly receive the direct/local capability.
- Rename remains available only after a direct native transcript has an assistant reply.

## Automated proof

- `pnpm --filter @hachej/boring-agent exec vitest run src/front/chat/pi/__tests__/remotePiSession.test.ts src/front/chat/session/__tests__/usePiSessions.test.tsx src/front/chat/__tests__/PiChatPanel.test.tsx src/server/http/routes/__tests__/piChat.test.ts src/server/pi-chat/__tests__/harnessPiChatService.test.ts src/server/harness/pi-coding-agent/__tests__/createHarness.test.ts src/server/harness/pi-coding-agent/__tests__/sessions.load.test.ts src/server/__tests__/createAgentApp.test.ts src/core/__tests__/piChatSessionService.test.ts src/shared/__tests__/session.test.ts` — pass: 10 files, 263 tests.
- `pnpm --filter @hachej/boring-workspace exec vitest run src/front/chrome/session-list/__tests__/SessionBrowser.test.tsx src/app/front/__tests__/WorkspaceAgentFront.test.tsx` — pass: 2 files, 80 tests.
- `pnpm --filter @hachej/boring-agent typecheck` — pass.
- `pnpm --filter @hachej/boring-agent run build` — pass.
- `pnpm --filter @hachej/boring-workspace typecheck` — pass (after the agent build refreshes its declaration artifacts).
- `pnpm lint:invariants` — pass.
- `git diff --check` — pass.

## Manual Pi CLI proof — pending

Not completed. Run the direct/local workspace playground test after this follow-up lands:

1. Start `workspace-playground` in direct or local mode and create **New chat**.
2. Send one prompt, wait for an assistant reply, and rename the chat.
3. Run `pi /resume`; verify exactly one entry with the renamed title and no Boring wrapper/`pi_session_file` transcript.

Residual risk: this manual Pi CLI/resume verification remains pending until the playground run.
