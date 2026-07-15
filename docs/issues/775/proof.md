# #775 PR1 proof

## Contract covered

- New chat remains browser-local until its first prompt; no empty server session is created.
- The first prompt carries one in-tab idempotency key. A response-loss retry reuses that key and native Pi ID; a retry after service restart returns `NATIVE_SESSION_START_OUTCOME_UNKNOWN`.
- Native-first sessions use exactly one Pi JSONL, with no Boring wrapper or `pi_session_file` entry.
- Rename is available only for a direct native transcript after an assistant reply and uses Pi's `SessionManager.appendSessionInfo` API.
- Linked legacy wrapper behavior remains covered by the existing Pi-session tests.

## Automated proof

- `pnpm --filter @hachej/boring-agent exec vitest run src/front/chat/pi/__tests__/remotePiSession.test.ts src/front/chat/session/__tests__/usePiSessions.test.tsx src/server/http/routes/__tests__/piChat.test.ts src/server/pi-chat/__tests__/harnessPiChatService.test.ts src/server/harness/pi-coding-agent/__tests__/sessions.load.test.ts src/core/__tests__/piChatSessionService.test.ts src/shared/__tests__/session.test.ts` — pass (7 files, 127 tests).
- `pnpm --filter @hachej/boring-workspace exec vitest run src/front/chrome/session-list/__tests__/SessionBrowser.test.tsx` — pass (19 tests); verifies the native-assistant rename gate.
- `pnpm --filter @hachej/boring-agent typecheck`
- `pnpm --filter @hachej/boring-workspace typecheck`
- `pnpm lint:invariants`
- `git diff --check`

## Manual check

1. Open a workspace and select **New chat**. Before Send, confirm no server session or Pi JSONL is created.
2. Send one message, wait for the assistant reply, then rename it.
3. Run `pi /resume`; confirm one native transcript with the new title and no Boring wrapper.
