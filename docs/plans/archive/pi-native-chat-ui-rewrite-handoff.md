# Pi-native chat UI rewrite handoff

Status: final acceptance sweep for `boring-ui-v2-reorg-17vb`.

## What shipped

- Browser chat now renders through `PiChatPanel` and `RemotePiSession`.
- Canonical state is `/api/v1/agent/pi-chat/:sessionId/state` plus NDJSON `/events?cursor=<seq>`.
- Session navigation uses `usePiSessions` and `boring-agent:v2:{storageScope}:activeSessionId`.
- Workspace composition defaults to `PiChatPanel`; workspace-owned side effects such as `/reload` stay injected from `WorkspaceAgentFront`.
- Legacy AI SDK front path was removed: old `ChatPanel`, `useAgentChat`, `useSessions`, projection/follow-up queue files, `/api/v1/agent/chat`, turn manager, stream buffer, and `@ai-sdk/react` dependency.

## Runtime shape

- `RemotePiSession` owns browser hydrate/reconnect/resync, generation guards, seq processing, and optimistic prompt/follow-up outbox.
- `HarnessPiChatService` adapts server routes to Pi sessions through a server-only `getPiSessionAdapter` seam on the Pi harness implementation.
- `piChatRoutes` expose:
  - `GET/POST /api/v1/agent/pi-chat/sessions`
  - `GET /api/v1/agent/pi-chat/:sessionId/state`
  - `GET /api/v1/agent/pi-chat/:sessionId/events?cursor=<seq>`
  - `POST /prompt`, `/followup`, `/queue/clear`, `/interrupt`, `/stop`
- Replay gaps/cursor-ahead failures are stable error-coded and force client `/state` resync.

## UX semantics preserved

- Prompt submit, queued follow-ups, edit queued, stop/interrupt, slash `/reload`, plugin reload notices, file-change invalidation, and UI-command display-only events are covered.
- Active reload proof: `packages/agent/e2e/pi-native-chat-reload.spec.ts` reloads during a streaming turn and verifies history, active status/connection metadata, queue preview, and exactly one session row survive without local transcript-cache ownership.

## Intentional removals

- No AI SDK `useChat` or `@ai-sdk/react` dependency.
- No browser-owned transcript cache as source of truth.
- No legacy `/api/v1/agent/chat/*`, client PUT snapshot route, stream buffer, or projection bridge.
- No runtime transport flag; playground/CLI/workspace paths use Pi-native chat.

## Deferred non-goals

Future work should be separate tasks:

- `/clear` as a viewport/filter feature, not transcript deletion.
- Regenerate/edit previous assistant turns.
- Full steering-message queue editor.
- Richer real-server active-stream prompt return behavior if Pi exposes a non-blocking prompt primitive.

## Verification evidence

- `pnpm typecheck` — passed.
- `pnpm lint` — passed.
- `pnpm --filter @hachej/boring-agent run test` — passed: 162 files, 1172 tests, 5 skipped.
- `pnpm --filter @hachej/boring-workspace run test src/app/front/__tests__/WorkspaceAgentFront.test.tsx` — passed: 27 tests.
- `CI=true pnpm --filter @hachej/boring-agent exec playwright test -c e2e/playwright.config.ts e2e/pi-native-chat.spec.ts e2e/pi-native-chat-reload.spec.ts` — passed: 2 tests.
- `pnpm lint:invariants` — passed.
- `git diff --check` — passed.
- Greps clean under source/app paths for: `/api/v1/agent/chat`, `useAgentChat`, `useChat`, `displayMessages`, `piChatProjection`, `piNativeFollowUpQueue`.

## Key commits

- `721dffd4` — browser/e2e proof matrix.
- `06d46cd0` — legacy AI SDK/projection/chat route deletion.
