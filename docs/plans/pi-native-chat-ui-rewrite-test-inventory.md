# Pi-native Chat UI Rewrite — Regression Inventory and TDD Mapping

Status: implementation input for bead `boring-ui-v2-reorg-twdn`.

This document turns the existing chat/session/tool/workspace tests into a TDD map for the Pi-native chat rewrite. The old tests are behavior inventory and regression scars, not architecture to copy. Later beads should port or adapt the listed tests before writing replacement code.

For post-rewrite quality iteration, use `docs/plans/pi-native-chat-quality-baseline.md` as the scenario baseline. It defines the full over-time browser flow for message ordering, streaming, tool state, composer controls, model menu ordering, reload, and session history. This inventory maps old tests to new targets; the baseline defines what the resulting user-visible behavior must feel like.

## Classification key

- **port** — same user-visible behavior or protocol invariant; rewrite the test against the new Pi-native DTO/store/routes/components.
- **adapt** — same failure class, but expected behavior changes because the rewrite intentionally replaces AI SDK/projection/local queue semantics with Pi-native semantics.
- **delete-with-rationale** — test only locks old internals intentionally removed by the plan. Use this sparingly and keep the rationale explicit.

## Global TDD rules for downstream beads

1. Start each implementation bead by copying/adapting its listed regression tests into the new target test files.
2. Do not reintroduce `@ai-sdk/react/useChat`, AI SDK `UIMessageChunk`, browser-owned transcript cache, direct route calls from React components, or generic harness-pluggability to satisfy an old test.
3. Test logs should include session id, seq/cursor, connection state, and route names where useful, but must redact prompt bodies, token text, attachment contents, secrets, and sensitive host paths.
4. Active browser reload while an agent turn is running is a first-class acceptance criterion across server `/state`, event replay, `RemotePiSession`, session navigation, queue, workspace, and e2e tests. It is not a standalone implementation island.

## Old test/file → new target mapping

| Old test source | New target test/file | Classification | What to preserve or intentionally change |
| --- | --- | --- | --- |
| `packages/agent/src/front/__tests__/ChatPanel.test.tsx` | `packages/agent/src/front/chat/components/__tests__/ChatPanel.test.tsx`, `MessageTimeline.test.tsx`, `ComposerBar.test.tsx`, `RuntimeNotices.test.tsx`, plus `packages/agent/src/front/chat/pi/__tests__/remotePiSession.integration.test.ts` where protocol behavior used to live in ChatPanel | adapt | Preserve visual/data-attr behavior, empty state, messages, reasoning, tool renderer override, runtime readiness notices, warmup/blocker cancellation, passive scroll behavior, initialDraft/auto-submit race guards, attachment visible-vs-server payload behavior, model/thinking controls, slash/skill command behavior, Escape stop/interrupt priority, busy indicators, chronological part ordering, and working live region. Move protocol/merge behavior out of component tests and into reducer/RemotePiSession tests. |
| `packages/agent/src/front/__tests__/ChatPanel.test.tsx` tests around `/clear calls setMessages with empty array` | no first-cut new test; optionally future viewport-filter test if `/clear` returns | delete-with-rationale | `/clear` is intentionally removed from first-cut slash commands. Do not add local-only canonical transcript mutation. First-cut tests should instead assert `/clear` is absent from slash help/command list. |
| `packages/agent/src/front/__tests__/ChatPanel.test.tsx` tests preferring AI SDK visible messages, Pi projected tails, pi-only fallback, and SDK/projection coalescing | `packages/agent/src/front/chat/pi/__tests__/piChatReducer.test.ts`, `selectors.test.ts`, and `MessageTimeline.test.tsx` | adapt | Preserve the regression classes: no duplicate assistant text, no empty placeholders before errors, no wrong tool grouping, stable ordering, no cross-session bleed. Delete the AI SDK-vs-Pi precedence assertion itself because the rewrite has one message owner and no split histories. |
| `packages/agent/src/front/hooks/__tests__/useAgentChat.test.ts` | `packages/agent/src/front/chat/pi/__tests__/remotePiSession.test.ts`, `piChatStream.test.ts`, `piChatReducer.test.ts`, `packages/agent/src/front/chat/session/__tests__/usePiSessions.test.ts` | adapt | Preserve reload/hydration race regressions, optimistic user placement, duplicate user prompt handling, throttled/coalesced streaming updates, active marker/status behavior, stale hydration ignored, and no assistant error-message creation for transport errors. Replace `/messages`, AI SDK transport, `useChat` shape, and client snapshot cache with `/state`, NDJSON `/events`, command receipts, and reducer/store expectations. |
| `packages/agent/src/front/hooks/__tests__/useAgentChat.test.ts` tests `calls useChat`, `DefaultChatTransport`, `passes transport instance`, `forwards onData callback` | no new test except negative grep in cutover/final acceptance | delete-with-rationale | These tests lock the old AI SDK transport architecture. New path must prove the opposite: React talks to `RemotePiSession`, not `useChat` or `DefaultChatTransport`. |
| `packages/agent/src/front/hooks/__tests__/useSessions.test.ts` | `packages/agent/src/front/chat/session/__tests__/usePiSessions.test.ts`, `activeSessionStorage.test.ts`, `SessionList.test.tsx`, route tests for Pi session list/delete | port/adapt | Preserve shape/loading, disabled fetch, requestHeaders forwarding, transient 503 retry, non-503 no retry, bounded retry budget, stale response version guard, create/delete/switch/reset behavior, scoped storage keys, optimistic removal/rollback, 404 delete success, pending-created overlay. Adapt ids/source of truth to Pi session ids and `boring-agent:v2:{storageScope}:activeSessionId`. |
| `packages/agent/src/front/pi/__tests__/piChatProjection.test.ts` | `packages/agent/src/front/chat/pi/__tests__/piChatReducer.test.ts`, `selectors.test.ts`, `packages/agent/src/server/pi-chat/__tests__/piChatHistory.test.ts`, `piChatEvents.test.ts`, `harnessPiChatService.realLoop.test.ts` | adapt | Preserve event-to-message regression classes: user text from message-start, assistant deltas/part ends, no duplicate text for non-zero part ids, fallback/final message replacement, tool-call/result attachment by id, structured readiness tool outputs, output-error marking, multiple assistant turns, unknown events ignored, no cross-session bleed, coalesced tiny deltas, repeated user turns preserved. Replace AI SDK data envelopes/projection merging with typed `PiChatEvent` reducer and server history mapping. The real-loop service test covers Pi's actual provider/tool/result event order for success, error, abort during tool execution, multiple tool calls, and fresh state hydration after a completed tool result so tool results do not detach after assistant `message_end`. |
| `packages/agent/src/front/pi/__tests__/piNativeFollowUpQueue.test.ts` | `packages/agent/src/front/chat/pi/__tests__/piChatReducer.queue.test.ts`, `RemotePiSession.queue.test.ts`, `packages/agent/src/server/pi-chat/__tests__/piFollowUps.test.ts`, `piChatRoutes.test.ts` | adapt/delete-with-rationale | Preserve queue regression coverage, but intentionally remove per-item delete. New behavior is TUI-style restore-all: client copies local queued text into composer first, then `POST /queue/clear`; Stop clears queue; Escape/interrupt does not. Delete old per-item delete assertion because first cut explicitly defers per-item queue delete. |
| `packages/agent/src/front/primitives/__tests__/tool-call-group.test.tsx` | `packages/agent/src/front/chat/components/__tests__/ToolCallGroup.adapter.test.tsx`, `packages/agent/src/front/__tests__/toolRenderers.test.tsx` | port/adapt | Preserve renderer metadata routing: explicit `rendererId` wins and tool-name fallback works. Adapt input type from AI SDK/tool UI part to neutral `ToolPart`/`BoringChatPart` adapter. |
| `packages/agent/src/front/__tests__/toolRenderers.test.tsx` | same file or `packages/agent/src/front/chat/components/__tests__/toolRenderers.pi.test.tsx` | port | Preserve shadcn filesystem renderer coverage, workspace/runtime readiness distinction, retryable runtime readiness status, `exec_ui` action/params summaries, completed/error badges, collapsed default body, unknown future kind, and input-streaming rendering. Feed neutral `ToolPart` instead of AI SDK part. |
| `packages/agent/src/server/http/routes/__tests__/chat.test.ts` | `packages/agent/src/server/http/routes/__tests__/piChat.test.ts`, `packages/agent/src/server/pi-chat/__tests__/piSessionService.test.ts`, `piChatReplayBuffer.test.ts` | adapt | Preserve validation, telemetry safety, optional model/thinking payload handling, abort signal behavior, active-turn concurrency guard, turn reservation before runtime resolution, stale cancel not aborting newer turn, ordered streaming, resume cursor behavior, follow-up idempotency/retryable conflict, full history retrieval. Replace SSE and `/api/v1/agent/chat` with NDJSON `/api/v1/agent/pi-chat/:sessionId/events`, `/state`, `/prompt`, `/followup`, `/queue/clear`, `/interrupt`, `/stop`. |
| `packages/agent/src/server/http/routes/__tests__/chat.test.ts` tests no active turn returns `204`, SSE data lines, cursor beyond buffer returns `416`, per-item follow-up DELETE | new route tests with different expected behavior | adapt/delete-with-rationale | NDJSON `/events` stays open while mounted and uses heartbeats, not idle `204`. Replay errors are `409 replay_gap` or `409 cursor_ahead`, not `416`. Per-item follow-up DELETE is intentionally removed; test `/queue/clear` after client-first restore instead. |
| `packages/agent/src/server/http/routes/__tests__/sessions.test.ts` | `packages/agent/src/server/http/routes/__tests__/piSessions.test.ts` or adapted existing sessions tests | port/adapt | Preserve CRUD roundtrip, delete twice semantics where compatible, default title, invalid id 400s, create/list/delete consistency. Adapt canonical record to Pi session id/metadata. Transcript export/analysis-session tests may remain on old endpoints if still supported outside Pi chat, but must not imply a Boring transcript sidecar for Pi chat. |
| `packages/agent/src/server/http/routes/__tests__/sessions.integration.test.ts` | same file adapted plus Pi session manager integration tests | port/adapt | Preserve real fetch integration: fresh list empty, POST creates title/default, malformed JSON 400, body-less DELETE works without Content-Type, delete 404 behavior, create/list/delete reflect store state, JSON content type, GET detail 404/existing. Adapt source of truth to Pi sessions and thin metadata only. |
| `packages/agent/src/server/http/__tests__/sessionChangesTracker.test.ts` | same file plus `packages/agent/src/server/pi-chat/__tests__/piChatEvents.fileChanged.test.ts` | port | Preserve `parseFileChangeChunk` and bounded per-session history. Add mapping from PiChatEvent `file-changed` to workspace invalidation path; ensure event storage remains bounded and safe. |
| `packages/agent/src/shared/__tests__/tool-ui.test.ts` | same file and `packages/agent/src/shared/chat/__tests__/piChatSchemas.test.ts` | port/adapt | Preserve accepting explicit metadata shape and rejecting malformed metadata without throwing. Add top-level metadata strip/ignore behavior before renderer resolution and safe fallback for unknown/malformed renderer ids. |
| `packages/workspace/src/front/chrome/chat/__tests__/ChatPanelHost.test.tsx` | same file adapted to new `@hachej/boring-agent/front` Pi-native ChatPanel contract | port/adapt | Preserve composition of workspace file-change bridge with caller callback, generic session-scoped composer blockers, generic composer stop event, blocker surface opening through workbench, and composed artifact opening. Replace AI SDK chunk/onData assumptions with PiChatEvent DTOs where applicable. |
| `packages/workspace/src/front/chrome/session-list/__tests__/SessionBrowser.test.tsx` | same file or agent-owned `packages/agent/src/front/chat/session/__tests__/SessionList.test.tsx` plus workspace composition test | port | Preserve grouping by recency, switch click behavior including same-row click, active row class, optional `onSwitch`, new-session button, delete without switch, and empty state. Adapt ownership so session CRUD/navigation lives in agent package and workspace composes/displays it. |
| `packages/workspace/src/__tests__/plugin-integration.test.tsx` | same file plus workspace/agent plugin renderer integration tests | port/adapt | Preserve WorkspaceProvider bootstrap, command palette command registration/execution, filesystem defaults/exclusion, existing children/capabilities/theme, plugin coexistence, core panel registration/order/source. Add/ensure plugin-provided `toolRenderers` contribution merges into ChatPanel prop path and does not create a parallel chat renderer registry. |
| `packages/agent/src/front/__tests__/ModelSelect.test.tsx` | same file or `packages/agent/src/front/chat/components/__tests__/ModelSelect.pi.test.tsx` | port/adapt | Preserve provider/model grouping, current value display, disabled/loading/error states, custom provider labels, and user-selection behavior. Adapt persistence keys and send payload assertions to Pi-native composer policy. |
| `packages/agent/src/front/slashCommands/__tests__/builtins.test.ts` | same file plus `packages/agent/src/front/chat/session/__tests__/composerPolicy.test.ts` | port/adapt/delete-with-rationale | Preserve parser/registry/suggestions behavior for `/reset`, `/reload`, `/help`, skill commands, and extra commands. Adapt busy policy so executable/app commands are blocked while streaming unless they expand to allowed normal text. Delete only first-cut `/clear` availability assertions because `/clear` is intentionally absent. |
| `packages/agent/src/front/primitives/__tests__/prompt-input-upload.test.tsx` | same file plus `packages/agent/src/front/chat/components/__tests__/ComposerBar.test.tsx` | port/adapt | Preserve paste/upload/screenshot attachment UX, visible chip behavior, upload error visuals, and prompt-input data attrs. Adapt send plumbing away from AI SDK file parts to Pi-native submit payload enrichment. |
| `packages/agent/src/front/bareToolRenderers/__tests__/renderers.test.tsx` | same file plus `packages/agent/src/front/chat/components/__tests__/ToolCallGroup.adapter.test.tsx` | port/adapt | Preserve bare/default renderer behavior for bash/read/write/edit/find/grep/ls, diff/code/path rendering, unknown tool fallback, status badges, and artifact/file-open affordances. Adapt input from AI SDK tool part to neutral `ToolPart`. |
| `packages/workspace/src/app/front/__tests__/WorkspaceAgentFront.test.tsx` | same file adapted to Pi-native ChatPanel/session/model route contract | port/adapt | Preserve app-shell wiring, API base/auth header forwarding, warmup/blocker propagation, default plugin composition, and session/chat host behavior. Replace AI SDK chunk mocks with Pi-native DTOs and `RemotePiSession`/route fakes. |
| `packages/workspace/src/front/agentPlugins/__tests__/registerAgentPlugin.test.tsx` | same file plus workspace plugin renderer integration tests | port/adapt | Preserve agent plugin registration, hot reload/replay behavior, same-revision re-import, lifecycle-event filtering, and app composition. Add plugin `toolRenderers` contribution path into ChatPanel props. |
| `packages/core/src/app/front/__tests__/CoreWorkspaceAgentFront.test.tsx` | same file if core app composition imports the default workspace/agent shell | port/adapt | Preserve core-composed app wiring and auth/header context propagation into workspace/agent routes. Keep core free of chat protocol ownership; it should compose and forward context only. |

## Active reload while agent runs — required coverage matrix

This bug is currently high-risk: browser reload while the agent is running can lose state because old chat state is split across AI SDK messages, Pi projection, local queue, and client/server snapshots. The rewrite must prove reload works from canonical Pi state.

| Coverage area | Target tests | Required assertions |
| --- | --- | --- |
| Server `/state` snapshot | `packages/agent/src/server/pi-chat/__tests__/piChatSnapshot.test.ts`, `packages/agent/src/server/http/routes/__tests__/piChat.test.ts` | While a turn is active, `/state` returns committed history, `status` running/submitted/streaming as appropriate, `activeTurnId`, queue previews, and `seq`. It must not return an empty message array just because browser cache is absent. |
| Event replay | `packages/agent/src/server/pi-chat/__tests__/piChatReplayBuffer.test.ts`, `packages/agent/src/front/chat/pi/__tests__/piChatStream.test.ts`, `packages/agent/src/front/chat/pi/__tests__/remotePiSession.test.ts` | Reload reconnects `/events?cursor=state.seq`; replayed events with higher seq apply exactly once. `replay_gap`/`cursor_ahead` and live seq gaps lead to `/state` rehydrate, not empty chat overwrite, and repeated recovery cycles preserve one canonical assistant message before later final events apply. |
| `RemotePiSession` lifecycle | `packages/agent/src/front/chat/pi/__tests__/remotePiSession.test.ts` | Remount/reload hydrates `/state` before empty-state render, opens `/events` from `state.seq`, aborts old stream/timers, ignores stale callbacks, and preserves connection/reconnecting notices. |
| Reducer/store | `packages/agent/src/front/chat/pi/__tests__/piChatReducer.test.ts` | Active-turn snapshot hydrates committed messages, queue, status, active turn, seq. Stale optimistic outbox entries are cleared only after comparison with server queue and with notice. |
| Session navigation | `packages/agent/src/front/chat/session/__tests__/usePiSessions.test.ts`, `SessionList.test.tsx` | Active session id survives reload when valid; invalid id falls back safely; a streamed/running session appears exactly once in the list. |
| Queue | `packages/agent/src/front/chat/pi/__tests__/piChatReducer.queue.test.ts`, `packages/agent/src/server/pi-chat/__tests__/piFollowUps.test.ts`, `packages/agent/src/server/pi-chat/__tests__/harnessPiChatService.realLoop.test.ts` | Accepted-but-unconsumed follow-ups visible in server queue remain visible after reload. Browser-only stale outbox not present in `/state.queue` is cleared with notice. Empty `queue-updated` events clear the queue preview but preserve optimistic follow-up placeholders until consumption, command rollback, or `/state` recovery provides stronger evidence. The real Pi provider/tool-loop service test asserts interrupt/Escape aborts the active turn, then continues exactly one queued follow-up as the next user turn with a following assistant completion. |
| Workspace | `packages/workspace/src/front/chrome/chat/__tests__/ChatPanelHost.test.tsx`, `packages/workspace/src/front/chrome/session-list/__tests__/SessionBrowser.test.tsx` | Workspace forwards scoped context/headers after reload, preserves blocker/artifact/file-change bridge wiring, and does not duplicate the active running session entry. |
| E2E/browser proof | `packages/agent/e2e/pi-native-chat-reload.spec.ts` for the package-level active-reload and replay-resume proof, `packages/agent/e2e/pi-native-replay-gap.spec.ts` for browser `/events` replay-gap, cursor-ahead, and mixed live-gap rehydrate/reconnect proof, `packages/agent/e2e/pi-native-error-scope.spec.ts` for turn-scoped stale/current stream error behavior, `packages/agent/e2e/pi-native-harness-queue-stop-reload.spec.ts` for harness-backed queue/reload/Stop/Escape proof, `packages/agent/e2e/pi-native-harness-tool-liveness.spec.ts` for slow scripted tool liveness and in-place settlement, `packages/agent/e2e/pi-native-harness-reasoning-parts.spec.ts` for multi-reasoning-part attachment and order, `packages/agent/e2e/pi-native-property-baseline.spec.ts` for repeated DOM invariant checks across a mixed scripted-harness interaction sequence, `packages/agent/e2e/pi-native-random-baseline.spec.ts` for seeded randomized valid-action exploration with observed action traces and surviving-message order checks, `packages/agent/e2e/bombadil/pi-native-chat.spec.ts` plus `pnpm --filter @hachej/boring-agent run test:bombadil:chat` for external Bombadil valid-action exploration, `packages/agent/e2e/pi-native-baseline-history.spec.ts` for history sorting/switch isolation and stale active-stream event isolation, `packages/agent/e2e/pi-native-baseline-composer-controls.spec.ts` for model order, prompt metadata, mid-stream disabled controls, and session-switch re-enable behavior, `packages/agent/e2e/pi-native-long-transcript-reload.spec.ts` for full-history reload/order proof, `packages/agent/e2e/pi-native-multi-session-cold-reload.spec.ts` for transient session-list 503 retry without active-session switch or auto-create; `apps/full-app/e2e/pi-native-chat.spec.ts` only if full app composition is required | Start a response, queue at least one follow-up if practical, reload page while active, assert committed history remains, active/reconnecting/streaming state visible, queue preview survives when server queue has it, replay-gap recovery rehydrates `/state` then reconnects without duplicating the assistant/tool state, cursor-ahead recovery rewinds to canonical `/state` and drops stale ahead-only text before later final text applies once, mixed replay-gap/cursor-ahead/live-seq-gap churn rehydrates repeatedly without duplicating the assistant or detaching tool state, stale old-turn error/end events do not settle or duplicate the active assistant, terminal current-turn errors settle the active assistant in place with one runtime notice, late non-error `agent-end` events do not mask terminal errors, final text arriving after reload/reconnect updates the existing assistant row exactly once without detaching prior tool state, a slow tool shows a live `Using` state and settles the same assistant tool group in place, multiple reasoning chunks stay grouped in one assistant before the live tool group and final text, selected model/thinking metadata reaches the next idle prompt, model/thinking controls freeze during streaming and re-enable after an idle session switch, Stop clears queued follow-ups before dispatch, Escape preserves and auto-posts the next queued follow-up as a user turn with an assistant completion after it, exactly one session-list entry exists, shared DOM invariants hold after every mixed interaction step, and randomized valid action sequences do not reorder surviving messages. Separately assert session history sort order, no transcript leakage while switching sessions, no stale old-session stream events after the selected session changes, no compacted-tail fallback when a long transcript reloads, and no selected-session loss or accidental auto-create during cold-runtime session-list retry. The tests must not use localStorage/IndexedDB transcript cache to pass. |

## Per-downstream-bead TDD source map

| Bead | Test sources to port/adapt first | Initial target tests |
| --- | --- | --- |
| `boring-ui-v2-reorg-ltgn` — Shared Pi chat DTOs and shallow schemas | `packages/agent/src/shared/__tests__/tool-ui.test.ts`; invalid payload cases from `chat.test.ts` | `packages/agent/src/shared/chat/__tests__/piChatSchemas.test.ts`, extend `tool-ui.test.ts` |
| `boring-ui-v2-reorg-ftms` — NDJSON parser, heartbeat, reconnect, replay-gap tests | resume/cursor tests from `chat.test.ts`; batching/unknown event cases from `piChatProjection.test.ts` | `packages/agent/src/front/chat/pi/__tests__/piChatStream.test.ts`, `packages/agent/src/server/pi-chat/__tests__/piChatReplayBuffer.test.ts` |
| `boring-ui-v2-reorg-fejp` — Private PiAgentSessionAdapter seam | server harness/session characterization tests: `packages/agent/src/server/harness/pi-coding-agent/__tests__/sessions.load.test.ts`, `sessionMapping.conformance.test.ts` | `packages/agent/src/server/pi-chat/__tests__/PiAgentSessionAdapter.test.ts` |
| `boring-ui-v2-reorg-x0k4` — Server PiChatSnapshot/history mapping | `piChatProjection.test.ts`, `/messages` tests from `chat.test.ts`, active reload matrix | `packages/agent/src/server/pi-chat/__tests__/piChatSnapshot.test.ts`, `piChatHistory.test.ts` |
| `boring-ui-v2-reorg-1fgm` — Server Pi event mapping and bounded replay buffer | `piChatProjection.test.ts`, resume tests from `chat.test.ts`, `sessionChangesTracker.test.ts`, real Pi provider/tool-loop ordering | `packages/agent/src/server/pi-chat/__tests__/piChatEvents.test.ts`, `piChatReplayBuffer.test.ts`, `harnessPiChatService.realLoop.test.ts` |
| `boring-ui-v2-reorg-o0pi` — Thin `/api/v1/agent/pi-chat` routes and receipts | `chat.test.ts`, invalid body/model/thinking tests, follow-up tests | `packages/agent/src/server/http/routes/__tests__/piChat.test.ts` |
| `boring-ui-v2-reorg-jc4b` — Workspace-scoped Pi session identity/list/delete | `sessions.test.ts`, `sessions.integration.test.ts`, `useSessions.test.ts` storage/delete cases | `packages/agent/src/server/http/routes/__tests__/piSessions.test.ts`, `packages/agent/src/server/pi-chat/__tests__/piSessionIdentity.test.ts` |
| `boring-ui-v2-reorg-71vp` — Reducer/store/selectors | `piChatProjection.test.ts`, `piNativeFollowUpQueue.test.ts`, `useAgentChat.test.ts` hydration/optimistic/dedup tests, ChatPanel projection fallback tests | `packages/agent/src/front/chat/pi/__tests__/piChatReducer.test.ts`, `selectors.test.ts`, `piChatReducer.queue.test.ts` |
| `boring-ui-v2-reorg-k5cg` — RemotePiSession lifecycle/stream/commands | `useAgentChat.test.ts` hydration/reload/stream-throttle cases, route resume tests from `chat.test.ts` | `packages/agent/src/front/chat/pi/__tests__/remotePiSession.test.ts`, `useRemotePiSession.test.ts` |
| `boring-ui-v2-reorg-todv` — Pi/TUI queue and non-lossy Edit queued | `piNativeFollowUpQueue.test.ts`, follow-up section of `chat.test.ts`, queued submit cases in `ChatPanel.test.tsx` | `piChatReducer.queue.test.ts`, `remotePiSession.queue.test.ts`, `piFollowUps.test.ts`, `piChat.test.ts` `/followup` + `/queue/clear` cases |
| `boring-ui-v2-reorg-exy4` — Agent-owned session navigation/storage | `useSessions.test.ts`, `SessionBrowser.test.tsx`, session route tests | `packages/agent/src/front/chat/session/__tests__/usePiSessions.test.ts`, `activeSessionStorage.test.ts`, `SessionList.test.tsx` |
| `boring-ui-v2-reorg-w1ua` — Composer policy | ChatPanel tests for warmup/blocker, initialDraft/auto-submit, model/thinking, slash/skill, attachments; `ModelSelect.test.tsx`; `builtins.test.ts`; `prompt-input-upload.test.tsx` | `packages/agent/src/front/chat/components/__tests__/ComposerBar.test.tsx`, `packages/agent/src/front/chat/session/__tests__/composerPolicy.test.ts` |
| `boring-ui-v2-reorg-zh0c` — Tool renderer adapter/plugin metadata | `tool-call-group.test.tsx`, `toolRenderers.test.tsx`, `bareToolRenderers/__tests__/renderers.test.tsx`, `tool-ui.test.ts` | `ToolCallGroup.adapter.test.tsx`, `toolRenderers.pi.test.tsx`, shared metadata schema tests |
| `boring-ui-v2-reorg-nlob` — MessageTimeline/RuntimeNotices/ComposerBar | ChatPanel visual tests, busy indicators, data attrs, reasoning/tool order, runtime readiness notices | `MessageTimeline.test.tsx`, `RuntimeNotices.test.tsx`, `ComposerBar.test.tsx`, narrowed `ChatPanel.test.tsx` |
| `boring-ui-v2-reorg-zhxx` — New Pi-native ChatPanel sandbox | ChatPanel end-to-end-ish component tests; active reload matrix | `packages/agent/src/front/chat/components/__tests__/ChatPanel.pi.test.tsx`, sandbox smoke/e2e test |
| `boring-ui-v2-reorg-j0hs` — Workspace/agent boundary | `ChatPanelHost.test.tsx`, `SessionBrowser.test.tsx`, `plugin-integration.test.tsx`, `WorkspaceAgentFront.test.tsx`, `CoreWorkspaceAgentFront.test.tsx` | same workspace tests adapted to Pi DTOs and agent-owned session list |
| `boring-ui-v2-reorg-pq67` — Plugin reload/file-change/UI bridge | `ChatPanelHost.test.tsx`, `sessionChangesTracker.test.ts`, `registerAgentPlugin.test.tsx`, workspace plugin reload tests from current worktree/PR context if present | workspace plugin reload tests plus `piChatEvents.fileChanged.test.ts` |
| `boring-ui-v2-reorg-o4mz` — Perf/a11y/debug | streaming throttle tests from `useAgentChat.test.ts` and `piChatProjection.test.ts`; ChatPanel focus/busy/data-attr tests | debug metadata tests, a11y/focus tests, threshold logging tests |
| `boring-ui-v2-reorg-x3qh` — Browser/e2e proof matrix | all high-priority user-visible flows from ChatPanel/useSessions/chat route tests plus `packages/agent/e2e/m3b-chat.spec.ts`, `m3c-interrupt-queue.spec.ts`, `pi-projection-ui.spec.ts`, `tool-rendering.spec.ts` | `packages/agent/e2e/pi-native-chat-reload.spec.ts` and `packages/agent/e2e/pi-native-chat.spec.ts`; add `apps/full-app/e2e/pi-native-chat.spec.ts` only if app composition coverage is required |
| `boring-ui-v2-reorg-dnfg` — Public exports | tool renderer public seam tests; workspace import tests | package export map tests/build checks and workspace import smoke tests |
| `boring-ui-v2-reorg-5nz7` — Legacy cutover | all delete-with-rationale entries above | grep/invariant tests proving removed old path and no forbidden imports/contracts |
| `boring-ui-v2-reorg-17vb` — Final acceptance | full inventory | final grep/gate checklist and handoff evidence |

## Delete-with-rationale inventory

Only these old expectations are currently marked delete-with-rationale:

1. `ChatPanel.test.tsx` `/clear calls setMessages with empty array` and `slashCommands/__tests__/builtins.test.ts` assertions that `/clear` is available in first-cut slash help — delete because `/clear` is deliberately absent from first cut and local transcript mutation is forbidden.
2. `useAgentChat.test.ts` tests that assert `useChat`, `DefaultChatTransport`, AI SDK transport instance shape, or AI SDK `onData` plumbing — delete because new control path is `RemotePiSession` and NDJSON `/events`.
3. `piNativeFollowUpQueue.test.ts` per-item queued follow-up delete — delete because first cut uses TUI-style restore-all-to-composer plus `/queue/clear`; per-item delete is deferred.
4. `chat.test.ts` expectations for idle stream `204`, SSE data-line transport, cursor `416`, and per-item follow-up DELETE — delete/adapt because new protocol uses long-lived NDJSON heartbeats, `409 replay_gap`/`cursor_ahead`, and `/queue/clear`.

Everything else should be ported or adapted, not silently discarded.


## Per-bead anchors for `external_ref`

These headings provide stable anchors for bead `external_ref` values. The structured bead fields remain authoritative, but these anchors let future agents jump from a bead to the relevant inventory context without relying on non-existent plan fragments.

<a id="boring-ui-v2-reorg-twdn"></a>

### boring-ui-v2-reorg-twdn — Regression inventory and TDD mapping

Primary sources: all rows in this inventory, especially the delete-with-rationale inventory and active reload matrix.

<a id="boring-ui-v2-reorg-ltgn"></a>

### boring-ui-v2-reorg-ltgn — Shared Pi chat DTOs and shallow schemas

Primary sources: `tool-ui.test.ts`, invalid payload cases from `chat.test.ts`, and active reload schema requirements for `/state`.

<a id="boring-ui-v2-reorg-ftms"></a>

### boring-ui-v2-reorg-ftms — NDJSON parser, heartbeat, reconnect, and replay-gap tests

Primary sources: resume/cursor tests from `chat.test.ts`, projection unknown/coalescing cases, and active reload replay matrix.

<a id="boring-ui-v2-reorg-fejp"></a>

### boring-ui-v2-reorg-fejp — Private PiAgentSessionAdapter seam

Primary sources: `sessions.load.test.ts`, `sessionMapping.conformance.test.ts`, and Pi API characterization needs from the plan.

<a id="boring-ui-v2-reorg-x0k4"></a>

### boring-ui-v2-reorg-x0k4 — Server PiChatSnapshot/history mapping

Primary sources: `piChatProjection.test.ts`, `/messages` retrieval/hydration tests from `chat.test.ts`, and active reload `/state` matrix.

<a id="boring-ui-v2-reorg-1fgm"></a>

### boring-ui-v2-reorg-1fgm — Server Pi event mapping and bounded replay buffer

Primary sources: `piChatProjection.test.ts`, resume/replay tests from `chat.test.ts`, `sessionChangesTracker.test.ts`, real Pi provider/tool-loop ordering from `harnessPiChatService.realLoop.test.ts`, and active reload replay matrix.

<a id="boring-ui-v2-reorg-o0pi"></a>

### boring-ui-v2-reorg-o0pi — Thin Pi chat routes and receipts

Primary sources: `chat.test.ts`, invalid body/model/thinking/follow-up route tests, and active reload route-contract matrix.

<a id="boring-ui-v2-reorg-jc4b"></a>

### boring-ui-v2-reorg-jc4b — Workspace-scoped Pi session identity/list/delete

Primary sources: `sessions.test.ts`, `sessions.integration.test.ts`, `useSessions.test.ts`, and active reload session identity matrix.

<a id="boring-ui-v2-reorg-71vp"></a>

### boring-ui-v2-reorg-71vp — Reducer/store/selectors

Primary sources: `piChatProjection.test.ts`, `piNativeFollowUpQueue.test.ts`, `useAgentChat.test.ts`, ChatPanel projection fallback tests, and active reload reducer matrix.

<a id="boring-ui-v2-reorg-k5cg"></a>

### boring-ui-v2-reorg-k5cg — RemotePiSession lifecycle/stream/commands

Primary sources: `useAgentChat.test.ts`, route resume tests from `chat.test.ts`, stream parser tests, and active reload lifecycle matrix.

<a id="boring-ui-v2-reorg-todv"></a>

### boring-ui-v2-reorg-todv — Pi/TUI queue and non-lossy Edit queued

Primary sources: `piNativeFollowUpQueue.test.ts`, follow-up route tests from `chat.test.ts`, queued submit cases in `ChatPanel.test.tsx`, and active reload queue matrix.

<a id="boring-ui-v2-reorg-exy4"></a>

### boring-ui-v2-reorg-exy4 — Agent-owned session navigation/storage

Primary sources: `useSessions.test.ts`, `SessionBrowser.test.tsx`, server session route tests, and active reload session navigation matrix.

<a id="boring-ui-v2-reorg-w1ua"></a>

### boring-ui-v2-reorg-w1ua — Composer policy

Primary sources: ChatPanel composer tests, `ModelSelect.test.tsx`, `builtins.test.ts`, `prompt-input-upload.test.tsx`.

<a id="boring-ui-v2-reorg-zh0c"></a>

### boring-ui-v2-reorg-zh0c — Tool renderer adapter/plugin metadata

Primary sources: `tool-call-group.test.tsx`, `toolRenderers.test.tsx`, `bareToolRenderers/__tests__/renderers.test.tsx`, and `tool-ui.test.ts`.

<a id="boring-ui-v2-reorg-nlob"></a>

### boring-ui-v2-reorg-nlob — MessageTimeline, RuntimeNotices, ComposerBar

Primary sources: ChatPanel visual tests, busy indicators, data attrs, reasoning/tool order, runtime readiness notices, and prompt-input upload visual tests.

<a id="boring-ui-v2-reorg-zhxx"></a>

### boring-ui-v2-reorg-zhxx — New Pi-native ChatPanel sandbox

Primary sources: ChatPanel component/e2e-ish tests and active reload browser proof matrix.

<a id="boring-ui-v2-reorg-j0hs"></a>

### boring-ui-v2-reorg-j0hs — Workspace/agent boundary migration

Primary sources: `ChatPanelHost.test.tsx`, `SessionBrowser.test.tsx`, `plugin-integration.test.tsx`, `WorkspaceAgentFront.test.tsx`, `CoreWorkspaceAgentFront.test.tsx`, and active reload workspace matrix.

<a id="boring-ui-v2-reorg-pq67"></a>

### boring-ui-v2-reorg-pq67 — Plugin reload/file-change/UI bridge

Primary sources: `ChatPanelHost.test.tsx`, `sessionChangesTracker.test.ts`, `registerAgentPlugin.test.tsx`, and plugin reload tests from the reload-stale-session-plugin context.

<a id="boring-ui-v2-reorg-o4mz"></a>

### boring-ui-v2-reorg-o4mz — Performance, accessibility, safe debug

Primary sources: streaming throttle/coalescing tests from `useAgentChat.test.ts`/`piChatProjection.test.ts`, ChatPanel focus/busy/data-attr tests, and active reload debug evidence requirements.

<a id="boring-ui-v2-reorg-x3qh"></a>

### boring-ui-v2-reorg-x3qh — Browser/e2e proof matrix

Primary sources: package e2e tests `m3b-chat.spec.ts`, `m3c-interrupt-queue.spec.ts`, `pi-projection-ui.spec.ts`, `tool-rendering.spec.ts`; target new specs `packages/agent/e2e/pi-native-chat-reload.spec.ts` and `packages/agent/e2e/pi-native-chat.spec.ts`.

<a id="boring-ui-v2-reorg-dnfg"></a>

### boring-ui-v2-reorg-dnfg — Public exports and old AI-SDK-shaped type deprecation

Primary sources: tool renderer public seam tests, workspace import smoke tests, package export map checks.

<a id="boring-ui-v2-reorg-5nz7"></a>

### boring-ui-v2-reorg-5nz7 — Legacy AI SDK/projection/follow-up cutover

Primary sources: delete-with-rationale inventory and final grep/invariant checks.

<a id="boring-ui-v2-reorg-17vb"></a>

### boring-ui-v2-reorg-17vb — Final acceptance sweep and handoff

Primary sources: full inventory, active reload matrix, e2e evidence, and final grep/gate checklist.

## Lightweight validation checklist for this inventory

Before closing bead `boring-ui-v2-reorg-twdn`, verify:

```bash
rg "ChatPanel\.test\.tsx|useAgentChat\.test\.ts|useSessions\.test\.ts|piChatProjection\.test\.ts|piNativeFollowUpQueue\.test\.ts|tool-call-group\.test\.tsx|toolRenderers\.test\.tsx|chat\.test\.ts|sessions\.test\.ts|sessions\.integration\.test\.ts|sessionChangesTracker\.test\.ts|tool-ui\.test\.ts|ChatPanelHost\.test\.tsx|SessionBrowser\.test\.tsx|plugin-integration\.test\.tsx|ModelSelect\.test\.tsx|builtins\.test\.ts|prompt-input-upload\.test\.tsx|bareToolRenderers/__tests__/renderers\.test\.tsx|WorkspaceAgentFront\.test\.tsx|registerAgentPlugin\.test\.tsx|CoreWorkspaceAgentFront\.test\.tsx" docs/plans/pi-native-chat-ui-rewrite-test-inventory.md
rg "Active reload|active reload|reload while" docs/plans/pi-native-chat-ui-rewrite-test-inventory.md
br show boring-ui-v2-reorg-twdn | rg "IN_PROGRESS|in_progress"
```
