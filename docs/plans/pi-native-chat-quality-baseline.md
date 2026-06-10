# Pi-native Chat Quality Baseline Scenario

Status: baseline scenario for future `/goal` iteration.

This document defines the chat quality baseline for the agent playground after
the Pi-native rewrite. It is intentionally written as a time-based scenario,
not as a component wish list, because most current regressions come from state
changing over time: duplicated messages, stale tool states, composer controls
drifting, model menu order changing, and chat history reordering.

## How to use this baseline

Use this as the reference in future goals:

```text
/goal Make apps/agent-playground pass docs/plans/pi-native-chat-quality-baseline.md.
Use the old boring-ui chat implementation as the user-facing display reference
when this baseline leaves a visual detail ambiguous. Preserve Pi-native state
ownership: server Pi session state is canonical; the browser must not invent a
second transcript owner.
```

The first iteration should turn this scenario into deterministic tests. Later
iterations should fix the app until those tests and a manual browser pass agree.

Run the deterministic baseline with:

```bash
pnpm test:chat-baseline
```

Use focused slices while iterating:

```bash
pnpm test:chat-baseline -- --unit
pnpm test:chat-baseline -- --e2e
```

Use the package-scoped `@hachej/boring-agent` command only when you explicitly
want the agent-owned slice without the workspace plugin reload composition
coverage.

Use `pnpm test:bombadil:chat` after deterministic coverage is green to stress
the same invariants with generated interaction sequences.

Latest generated stress evidence:

- 2026-06-05: `pnpm --filter @hachej/boring-agent run test:bombadil:chat`
  completed the default 30s generated browser run without invariant
  violations. The run exercised model/thinking menu interaction, prompt
  submission, reloads after transcript creation, and continued post-reload
  composer/menu actions.
- 2026-06-06: `pnpm --filter @hachej/boring-agent run test:bombadil:chat`
  completed the default generated browser run without invariant violations
  after deterministic unit/e2e coverage was green. The run exercised repeated
  reloads, model/thinking menu interactions, composer focus/typing, and
  post-reload picker interactions while checking DOM-level transcript, tool,
  queue, busy-state, and ordering invariants.
- 2026-06-06: `pnpm --filter @hachej/boring-agent run test:bombadil:chat`
  completed cleanly after the deterministic no-flags baseline included the
  standalone playground smoke. The generated run hit repeated reloads, model
  and thinking picker changes, composer typing/submission, Escape, and
  post-reload interactions while continuing to check DOM-level transcript,
  tool-state, queue, busy-state, and ordering invariants.
- 2026-06-05: `pnpm test:chat-baseline -- --unit` passed from the repo root.
  This exercised the agent unit baseline, including the static playground
  showcase verifier, plus the focused workspace plugin reload composition
  checks.
- 2026-06-05: `pnpm --filter @hachej/boring-agent exec playwright test -c
  e2e/playwright.config.ts --workers=1 --retries=0
  e2e/pi-native-playground-showcase.spec.ts` passed, proving the real
  playground showcase tab renders the deterministic all-message fixture.
- 2026-06-05: `pnpm test:chat-baseline -- --e2e` passed from the repo root:
  34 deterministic Playwright tests in 8.1 minutes. This covered composer
  controls, history ordering, message streaming, queue/stop/Escape behavior,
  tool liveness, reasoning ordering, reload recovery, replay gaps, the real
  playground showcase tab, and property/randomized browser invariants.
- 2026-06-05: `pnpm test:bombadil:chat:nightly` completed its 5-minute
  generated browser run without invariant violations. The run exercised repeated
  reloads, model and thinking picker changes, composer submissions, stop/reset
  focused actions, and continued interaction after reloads.
- 2026-06-06: focused flicker and composer-race checks passed:
  `PiChatPanel.test.tsx --testNamePattern "working indicator"`,
  `pi-native-baseline-message-flow.spec.ts -g "working indicator"`,
  `prompt-input-upload.test.tsx --testNamePattern "provider-backed text"`, and
  `PiChatPanel.test.tsx --testNamePattern "new draft typed"`.
- 2026-06-06: `pnpm --filter @hachej/boring-agent exec playwright test -c
  e2e/playwright.config.ts --workers=1 --retries=0
  e2e/pi-native-baseline-message-flow.spec.ts -g "legacy browser transcript"`
  passed with a pre-app DOM observer proving stale legacy transcript text never
  rendered during Pi-native hydration.
- 2026-06-06: `pnpm --filter @hachej/boring-agent exec playwright test -c
  e2e/playwright.config.ts --workers=1 --retries=0
  e2e/pi-native-baseline-message-flow.spec.ts -g "failed tool state"` passed,
  proving a browser-level tool error transitions from running to failed in the
  same assistant row, clears the busy indicator, and exposes the error body when
  the tool group and nested tool row are opened.
- 2026-06-06: `pnpm --filter @hachej/boring-agent exec playwright test -c
  e2e/playwright.config.ts --workers=1 --retries=0
  e2e/pi-native-baseline-message-flow.spec.ts -g "replayed user starts"` passed,
  proving a hydrated user row and a later live `message-start` with the same
  `clientNonce` reconcile into one visible prompt row even if their ids differ.
- 2026-06-06: active-refresh ordering was added to the baseline after a live
  playground regression: `piChatSnapshot.test.ts`, `harnessPiChatService.test.ts`,
  and `pi-native-harness-baseline-message-flow.spec.ts -g "completed previous
  turns ordered"` now assert that a `/state` refresh while the agent is still
  working does not stamp the active turn id onto older transcript rows, and the
  browser keeps `u1,a1,u2,a2` while the second assistant is still running.
- 2026-06-06: `pnpm --filter @hachej/boring-agent exec playwright test -c
  e2e/playwright.config.ts --workers=1 --retries=0
  e2e/pi-native-baseline-composer-controls.spec.ts` passed, including the
  inline model/thinking picker slot baseline. This proves model/thinking menus
  share the slash-command picker position, are not Radix popover portals, keep
  dark-mode opaque surfaces, and do not let ArrowUp recall composer history
  while a picker is open.
- 2026-06-06: the focused composer-controls browser baseline now also covers
  multiline composer input growth: `Shift+Enter` inserts internal newlines,
  the composer rail grows for a three-row draft, the textarea itself expands
  without clipping before max height, and the text lane remains a flexible
  `min-width: 0` child so wrapped rows stay inside the composer. The same
  check now guards against the previous `!h-auto` override that could block
  JS autosize height in browsers without reliable `field-sizing-content`.
- 2026-06-06: focused failed-tool formatting checks passed after the tool card
  header was split into bounded title/status/chevron lanes and error output
  was kept in a wrapped, non-horizontal-scrolling destructive block:
  `pnpm --filter @hachej/boring-agent exec vitest run
  src/front/__tests__/toolRenderers.test.tsx
  src/front/__tests__/toolRenderers.pi.test.tsx` and
  `pnpm --filter @hachej/boring-agent exec playwright test -c
  e2e/playwright.config.ts --workers=1 --retries=0
  e2e/pi-native-baseline-message-flow.spec.ts --grep "shows a failed tool state"`.
- 2026-06-06: after the composer autosize and failed-tool formatting fixes,
  root `pnpm test:chat-baseline -- --unit` passed the agent baseline
  (34 Vitest files, 349 tests) plus the focused workspace plugin reload
  composition checks, and root `pnpm test:chat-baseline -- --e2e` passed
  41 deterministic Chromium tests in 9.2 minutes. The curated unit gate now
  includes `src/front/__tests__/toolRenderers.test.tsx`, and the curated e2e
  gate now includes `e2e/pi-native-chat-reload.spec.ts`, so failed-tool
  formatting regressions and active-reload/reconnect regressions are caught by
  the standard chat baseline instead of only by focused ad hoc commands.
- 2026-06-06: root `pnpm test:chat-baseline` passed end to end after
  promoting the playground source-alias and primitive tool-group layout checks:
  36 agent Vitest files / 357 tests, 41 deterministic Chromium tests in
  9.4 minutes, and the 2 focused workspace plugin reload composition tests.
  The default unit gate now includes
  `src/__tests__/agentPlaygroundSourceAlias.test.ts` and
  `src/front/primitives/__tests__/tool-call-group.test.tsx`, so the manual
  playground cannot silently serve stale `dist` for
  `@hachej/boring-agent/front`, and expanded failed-tool details stay bounded
  to the normal tool lane in the standard baseline.
- 2026-06-06: root `pnpm test:chat-baseline -- --e2e` passed with 42
  deterministic Chromium tests after adding
  `e2e/pi-native-standalone-playground-smoke.spec.ts`. The new smoke launches
  `apps/agent-playground/src/server/index.ts` on a dynamic strict port, opens
  the real standalone playground in dark mode, proves the debug region and
  source-backed composer load, asserts the idle rail is 56px, rejects stale
  fixed-height textarea classes, and verifies `Shift+Enter` grows the composer
  rail in the same path users hit at `:5183`.
- 2026-06-06: root `pnpm test:chat-baseline` passed with the standalone
  playground smoke included in the default no-flags gate: 36 agent Vitest files
  / 357 tests, 42 deterministic Chromium tests in 9.3 minutes, and the 2
  focused workspace plugin reload composition tests.
- 2026-06-06: `pnpm --filter @hachej/boring-agent run test:chat-baseline -- --unit`
  passed with 36 focused Vitest files, 361 tests, and no type errors. The
  matching package e2e gate passed with 43 deterministic Chromium tests in
  9.4 minutes. After tightening
  `e2e/pi-native-standalone-playground-smoke.spec.ts`, the focused standalone
  playground smoke also passed and now proves a normal first-row draft keeps
  the 56px composer rail before `Shift+Enter` grows it.
- 2026-06-06: root `pnpm test:chat-baseline -- --unit` passed the same 36-file
  / 361-test agent unit gate plus the 2 focused workspace plugin reload
  composition checks. `pnpm --filter @hachej/boring-agent run
  test:bombadil:chat` then completed the default generated browser run without
  invariant violations, exercising repeated reloads, composer focus, model and
  thinking picker actions, and continued post-reload interactions.
- 2026-06-06: root `pnpm test:chat-baseline` passed end to end with 36 agent
  Vitest files / 361 tests, 43 deterministic Chromium tests in 9.4 minutes, and
  the 2 focused workspace plugin reload composition checks. This is the default
  command documented above for future `/goal` chat-quality iterations.
- 2026-06-06: `pnpm --filter @hachej/boring-agent run typecheck` passed after
  the final baseline evidence update.
- 2026-06-06: after a manual `:5183` retest found first-row composer growth
  and non-neutral failed-tool group styling, focused verification passed for:
  live `http://100.68.199.114:5183/` composer metrics (`typed first row`
  stays at a 56px rail with computed `field-sizing: fixed`, then
  `Shift+Enter` grows to 79px), `pi-native-baseline-composer-controls.spec.ts`
  for keyboard-typed first-row stability, `pi-native-standalone-playground-smoke.spec.ts`
  for the real playground path, `pi-native-baseline-message-flow.spec.ts -g
  "failed tool state"` for neutral failed-tool group styling with a red state
  dot to the left of the label plus nested error output, the tool-group unit tests, and
  `pnpm --filter @hachej/boring-agent run typecheck`.
- 2026-06-06: `pnpm --filter @hachej/boring-agent run test:chat-baseline -- --unit`
  passed with 33 focused Vitest files and 332 tests, then
  `pnpm --filter @hachej/boring-agent run test:chat-baseline -- --e2e` passed
  with 39 deterministic Chromium tests in 8.8 minutes after the multiline
  composer coverage was added.
- 2026-06-06: `pnpm test:chat-baseline -- --unit` passed after fixing
  different-id late-final coalescing for terminal assistant tool rows. This
  protects the case where a provider emits a final assistant message without a
  turn id after the visible tool row has already settled or aborted.
- 2026-06-06: `pnpm --filter @hachej/boring-agent exec playwright test -c
  e2e/playwright.config.ts --workers=1 --retries=0
  e2e/pi-native-baseline-message-flow.spec.ts` passed after promoting aborted
  tool display to browser coverage. This proves aborted tool calls render as a
  distinct `Stopped command` state, not `Used command`, and that a different-id
  late final message with no turn id coalesces into the existing aborted
  assistant row without duplicating it or overwriting the aborted tool state.
- 2026-06-06: `pnpm --filter @hachej/boring-agent exec playwright test -c
  e2e/playwright.config.ts --workers=1 --retries=0
  e2e/pi-native-baseline-message-flow.spec.ts` passed after adding row-stability
  evidence for the same late-final aborted-tool case. The test marks the live
  assistant DOM row before the final provider message changes the canonical
  message id, then proves the marker survives on the final row so the UI updates
  in place instead of remounting and flickering.
- 2026-06-06: `pnpm --filter @hachej/boring-agent exec vitest run
  src/front/chat/pi/__tests__/piChatReducer.test.ts` passed after adding reducer
  coverage for a committed same-turn assistant tool row followed by a streaming
  final assistant start. This proves the reducer folds the committed tool row
  into the streaming final row before render, avoiding duplicate same-turn
  assistant siblings and React key collisions.
- 2026-06-06: `pnpm test:chat-baseline -- --unit` passed with 315 agent tests
  after extending the reducer row-stability coverage to repeated provider ids
  across turns. This proves same-turn coalescing removes only the exact current
  committed row by index and does not drop older same-id assistant history.
- 2026-06-06: `pnpm --filter @hachej/boring-agent exec vitest run
  src/front/chat/pi/__tests__/piChatReducer.test.ts` passed with 61 reducer
  tests after extending final-message coalescing to remove/replace exact
  committed indexes. This protects the different-id late-final path from
  dropping older same-id assistant history when provider message ids repeat
  across turns.
- 2026-06-06: the same 61-test reducer pass also covers same-id final messages
  after repeated provider ids. Final-message coalescing now prefers
  turn-matching/current rows and content-matching active streams before falling
  back to older same-id history, so late no-turn finals cannot steal a newer
  active assistant row.
- 2026-06-06: the same 61-test reducer pass also covers tool-result routing
  after repeated provider assistant ids. Tool results now resolve by
  `toolCallId` first and update the exact committed row index before falling
  back to provider message ids.
- 2026-06-06: reducer maintainability checkpoint: pure assistant part
  ordering, final-message part merging, tool-result part merging, and
  queue/outbox reconciliation were extracted into focused helper modules,
  bringing `piChatReducer.ts` below the 1k-line review threshold while
  preserving the 72-test reducer suite and 326-test unit baseline. The added
  reducer cases protect provider streams that emit live text under one part id
  and final consolidated text under another, arbitrary provider ids that
  collide with folded adjacent text, stale no-turn streaming rows, and repeated
  final message ids during split-final coalescing. They also cover hydrated
  active rows that receive live deltas after repeated provider ids and no-turn
  finals that must not hijack an unrelated active same-id row, terminal
  settlement of repeated-id streaming rows, and split-row snapshot hydration
  when adjacent text and final text reuse the same provider part id. Same-row
  final text replaces the covered live prefix without dropping earlier
  adjacent assistant text, even when provider text part ids collide or the
  active row was hydrated from `/state` before the final message arrived.
- 2026-06-06: final assistant-message reconciliation was extracted from
  `piChatReducer.ts` into `piChatAssistantCommit.ts`, dropping the reducer from
  990 to 736 lines while keeping the commit target selection, final text
  coalescing, terminal tool-state preservation, and pending-tool reconciliation
  in one pure module. `pnpm --filter @hachej/boring-agent run typecheck`,
  `pnpm --filter @hachej/boring-agent exec vitest run
  src/front/chat/pi/__tests__/piChatReducer.test.ts
  src/front/chat/pi/__tests__/piChatReducer.queue.test.ts`, and the focused
  browser baseline for fragmented text, running tool settlement, failed tools,
  and different-id late finals all passed after the extraction.
- 2026-06-06: command/runtime notice formatting now preserves multiline failure
  text and wraps long unbroken command output with stable
  `[data-boring-agent-part="runtime-notice"]` attrs. `ChatNotices.test.tsx`,
  the existing inline filename/message formatting test, tool output formatting
  tests, the persisted-hydration panel notice test, and
  `pi-native-error-scope.spec.ts` all passed after the notice update. The agent
  `test:chat-baseline -- --unit` allowlist now includes `ChatNotices.test.tsx`
  and passed with 331 tests.
- 2026-06-06: live `PiTimelineMessage` rendering now has direct unit baseline
  coverage for assistant part order (`reasoning -> tools -> notice -> text`),
  grouped streaming reasoning, collapsed thoughts click-to-open behavior,
  grouped tool state handoff, and multiline notice wrapping. The agent
  `test:chat-baseline -- --unit` allowlist includes
  `PiTimelineMessage.test.tsx` and passed with 332 tests.
- 2026-06-06: the real browser scripted-harness reasoning baseline
  `pi-native-harness-reasoning-parts.spec.ts` passed with both tests, including
  the collapsed message-level `thoughts` click path and the invariant that
  opening thoughts does not change assistant message id, status, or part order.
- 2026-06-06: the failed-tool browser baseline now proves the visible failed
  tool group expands, the nested tool card expands, and the command error body
  is rendered as a wrapped preformatted block (`whitespace-pre-wrap`,
  `break-words`, `[overflow-wrap:anywhere]`). The focused failed-tool e2e and
  the harness tool-liveness e2e both passed after this assertion was added.

The deterministic runner uses curated allowlists and fails if any referenced
test file is missing. The root `scripts/run-chat-baseline.mjs` owns
cross-package baseline slices, while `packages/agent/scripts/run-chat-baseline.mjs`
owns agent-only unit/e2e slices. Update the relevant runner whenever
chat-baseline-owned tests are added, renamed, or moved.

## References

- Current playground: `apps/agent-playground`, normally served at
  `http://localhost:5184`.
- Current Pi-native e2e harness:
  `packages/agent/e2e/pi-native-chat.spec.ts`,
  `packages/agent/e2e/pi-native-chat-reload.spec.ts`, and
  `packages/agent/e2e/pi-native-mock.ts`.
- Current chat components:
  `packages/agent/src/front/chat/PiChatPanel.tsx`,
  `packages/agent/src/front/chat/components/MessageTimeline.tsx`,
  `packages/agent/src/front/chat/components/ComposerBar.tsx`, and
  `packages/agent/src/front/chatPanelComposerControls.tsx`.
- Old boring-ui display reference:
  `/home/ubuntu/projects/boring-ui/src/front/shared/components/chat` and
  `/home/ubuntu/projects/boring-ui/src/front/__tests__/e2e/canonical-chat-parity.spec.ts`.

If old boring-ui and Pi-native semantics disagree, use this rule:

- Display polish, ordering, affordance labels, and interaction smoothness follow
  old boring-ui unless this document says otherwise.
- Transcript ownership, reload recovery, follow-up queue state, and active turn
  state follow Pi-native server snapshots/events.

## Non-negotiable quality invariants

1. The visible transcript has one owner: the selected Pi session state plus
   accepted events. There is no merge of multiple transcript arrays.
2. Every displayed message has a stable id. A message id may update in place;
   it may not appear twice in the same transcript.
3. User messages, assistant messages, reasoning parts, tool parts, notices, and
   queued follow-ups render in chronological event order.
4. Streaming text appends to one assistant text part. It does not create repeated
   assistant cards or repeat prior deltas.
5. Tool calls transition in place through pending/running/result/error states.
   A completed tool is not left visually stuck as "used", "running", or
   "streaming".
6. Composer controls reflect actual state: submit/stop, model select, and
   thinking level do not contradict the active turn state. Reasoning visibility
   is controlled by the message-level thoughts affordance and persisted
   storage, not by a persistent composer eye button.
7. Reloading during an active turn hydrates from `/state` before showing an empty
   chat. It must not duplicate, reorder, or drop committed messages.
8. Session history is sorted by session `updatedAt` descending, with stable
   tie-breaking. The active session appears exactly once.
9. UI commands emitted by chat are display-only unless dispatched through the
   workspace bridge. They must not create duplicate tool/message state.
10. Redacted test evidence may include ids, seq numbers, roles, statuses, and
    part types. It must not include prompt bodies, secrets, host paths outside
    the fixture, or raw tool output that could contain secrets.

## Incident coverage matrix

This matrix maps the last 20 days of reported regressions to the baseline
tests. It is the working checklist for `/goal` iteration.

| Incident cluster | Failure mode to prevent | Current baseline protection | Remaining gap |
| --- | --- | --- | --- |
| Reload hydration | A transient `503` or warmup response latches an empty chat until the user switches workspaces. | `usePiSessions` retry coverage, active reload e2e, and `pi-native-multi-session-cold-reload.spec.ts` assert hydrate/retry from `/state` before an empty transcript or accidental session switch can win. Hook coverage also asserts a transient cold-runtime `503` during refresh does not clear the current session list, active id, or error-free loading state while the retry is pending. The same cold-reload e2e now includes a real CLI-backed runtime case that seeds Pi sessions, forces two reload-time `/pi-chat/sessions` `503`s through the server route, and verifies the selected session neither switches nor auto-creates. | No known reload warmup gap; add provider/runtime variants if future warmup failures stop using retryable `503`. |
| Plugin hot reload | `/reload` shows a banner but does not reconnect/replay/re-import plugin frontend state. | T10, composer-controls e2e, `WorkspaceAgentFront.test.tsx`, and `registerAgentPlugin.test.tsx` assert one reload command/notice, no transcript duplication, workspace-owned reload callback injection, browser reload event dispatch, EventSource reconnect, and replayed same-revision front module re-import. The root `pnpm test:chat-baseline -- --unit` command includes the focused workspace plugin reload composition tests. | No known plugin-reload replay gap; add full app e2e only if production plugin asset serving diverges from the workspace Vite hot-reload path. |
| Long transcript persistence | Reload shows only compacted LLM tail because UI transcript came from the wrong owner. | Invariant 1, T8, Pi session load tests, and `pi-native-long-transcript-reload.spec.ts` assert the full visible transcript survives reload with stable ids and chronological order. | Add a real Pi JSONL restart fixture if the persisted Pi message format changes. |
| Duplicate reload messages | Reconstructed messages get fresh ids on each read and duplicate on hydration. | Stable id invariants, T2/T5/T8, reducer dedupe tests, baseline message-flow e2e, `remotePiSession.test.ts` repeated replay recovery, `pi-native-replay-gap.spec.ts`, and the Bombadil chat baseline assert one visible row per canonical id through reload/reconnect/gap/cursor-ahead churn, including a mixed browser sequence with `replay_gap`, `cursor_ahead`, and a live seq gap before final text. The browser message-flow baseline also asserts a hydrated user row and later live user `message-start` with the same `clientNonce` reconcile into one visible prompt row even when ids differ. The Bombadil action generator is reset-weighted toward reload/Escape/Stop while a transcript or queue exists, and asserts connected resets never empty an existing transcript or drop queued follow-ups across reload. The longer Bombadil run is promoted through `.github/workflows/chat-baseline-nightly.yml`. | No known duplicate-reload gap; add new deterministic fixtures if future provider stream formats expose a reset mode Bombadil cannot trigger through browser actions. |
| Chat history ordering | Session history appears in the wrong order or duplicates the active row. | T9, `SessionList` unit coverage, and `pi-native-baseline-history.spec.ts` assert `updatedAt` descending order, deterministic ties, one selected row, transcript isolation while switching sessions, live and reload-time active title/timestamp refresh moving the selected row without transcript reordering, and stale active-stream events ignored after switching away. The deterministic browser message-flow baseline now runs two submitted turns and asserts `u1,a1,u2,a2` order with stable first-turn text isolation; the harness-backed message-flow e2e separately asserts the completed first user/assistant pair keeps its ids/order/status while the second user and streaming assistant append after it, reloads mid-run, and keeps `u1,a1,u2,a2` while the second assistant is still running. Server snapshot tests assert the active turn id is applied only to live-mapped active message ids, not old snapshot rows. | No known history-ordering gap; mid-stream future-turn defaults are tracked under composer/model controls. |
| Duplicate assistant text | Streaming/final events append a second assistant text bubble or repeat text. | T5, message-flow e2e, `pi-native-chat.spec.ts`, `pi-native-chat-reload.spec.ts`, `pi-native-replay-gap.spec.ts`, `remotePiSession.test.ts` repeated replay recovery, and the Bombadil chat baseline assert one assistant row, one text part, and final text appearing once, including fragmented assistant text deltas, final text arriving only after browser reload/reconnect, browser replay-gap rehydrate, browser cursor-ahead canonical-state rehydrate, mixed browser reset churn, repeated `/state` rehydrate cycles, reset-weighted browser actions, and randomized valid actions. The browser matrix also asserts the unsupported Regenerate affordance is absent so Pi-native cannot resubmit the previous user prompt as a new turn and duplicate the final assistant text. The harness-backed message-flow e2e now also captures an over-time trace and asserts the same assistant id evolves from reasoning-only to reasoning+running-tool to reasoning+settled-tool+final-text without inserting a duplicate assistant row. The longer Bombadil run is promoted through `.github/workflows/chat-baseline-nightly.yml`. | Add a canonical regenerate/replace baseline only after the server/Pi session log exposes a real regenerate operation that replaces or versions the target assistant turn without browser-owned transcript surgery. |
| Tool state rendering | Tool cards remain in ambiguous "used/running" state, attach results to the wrong message, or expand into visually misaligned detail cards. | T4/T8, harness-backed service tests, `piChatHistory` tests, harness baseline e2e, `ToolCallGroup.adapter.test.tsx`, `tool-call-group.test.tsx`, `piChatReducer.test.ts`, `harnessPiChatService.realLoop.test.ts`, `pi-native-chat-reload.spec.ts`, `pi-native-replay-gap.spec.ts`, `pi-native-random-baseline.spec.ts`, and the Bombadil chat baseline assert tool-result events stay attached to the same assistant message, including Pi's real provider/tool/result event order, failed tool groups announced as `Failed` instead of `Used`, aborted tool groups announced as `Stopped` instead of `Used`, tool errors, abort during tool execution, multiple tool calls before final text, delayed tool results after assistant final text, fresh service state hydration after a completed tool result, browser reconnect before final assistant text, mixed replay/cursor/live-gap reset churn, reset-weighted browser actions, and seeded/random valid action sequences. The browser message-flow baseline now covers delayed success, delayed error, and abort followed by a different-id late final with no turn id: one running group becomes `settled`/`Used command`, `failed`/`Failed command`, or `aborted`/`Stopped command` in place, the busy indicator clears, the terminal tool state is not overwritten by stale late-final success payloads, and expanded failed-tool details stay capped to the normal tool-detail lane with wrapped error text. The harness-backed message-flow trace pins the browser display sequence to the old canonical-stream shape: user message, assistant reasoning, one running tool group, settled tool group, then final text. `pi-native-harness-tool-liveness.spec.ts` also asserts the visible group changes from `running`/`Using command` with elapsed `Running Ns` to `settled`/`Used command` on the same assistant row, with no stale elapsed/running label left behind. The longer Bombadil run is promoted through `.github/workflows/chat-baseline-nightly.yml`. | No known tool-state reset gap; add new deterministic fixtures if future provider stream formats expose a reset mode Bombadil cannot trigger through browser actions. |
| Long-running tools | A tool looks dead or endless when progress/status heartbeats are lost. | T4, `pi-native-harness-tool-liveness.spec.ts`, and harness heartbeat tests define pending/running/result transitions, hold a slow scripted tool in the live `Using command` state with an elapsed `Running Ns` hint, then assert the same assistant tool group settles in place as `Used command` with one final text part. T7 defines abort behavior. | Add richer progress text if Pi tools start emitting structured progress events. |
| Reasoning/thinking render | Reasoning chunks attach to the wrong message, the collapsed `thoughts` affordance cannot be opened, or the composer thinking control lies. | T1/T3/T5, panel tests, and `pi-native-harness-reasoning-parts.spec.ts` assert thinking selection, message-level reasoning affordance behavior, click-to-open collapsed thoughts in the real browser, persisted reasoning visibility, and multiple reasoning chunks grouped in one assistant before the running tool and final text. | Add randomized multi-reasoning timing cases to Bombadil if future provider streams interleave reasoning with tools differently. |
| Stream resume and errors | Mid-stream errors are not scoped to the active turn or resume loses cursor state. | T7/T8, route tests, `piChatReducer` turn-scope coverage, and `pi-native-error-scope.spec.ts` require scoped stop/abort, stale old-turn error suppression, active-turn terminal error settlement, late non-error `agent-end` non-masking, composer recovery after terminal active-turn errors, and `/events` reconnect from state seq. | Add retryable-provider error fixtures if Pi starts emitting recoverable `error` frames outside the auto-retry event pair. |
| Follow-up queue and stop | Stop clears queued prompts locally even when the server still owns them. | T6/T7, queue reducer tests, scripted selected-clear tests, e2e queue assertions, `pi-native-harness-queue-stop-reload.spec.ts`, and `harnessPiChatService.realLoop.test.ts` preserve server-owned queue order across reload and Stop. Queue reducer coverage also asserts an empty `queue-updated` event does not silently erase optimistic follow-ups before consumption, command rollback, or `/state` recovery provides stronger evidence. The real Pi provider/tool-loop coverage asserts Stop clears queued follow-ups, aborts the active tool turn, and does not auto-post cleared queued prompts after the abort. | No known Stop/queue ownership gap; add full browser real-provider coverage only if the packaged playground can run deterministic provider fixtures without the scripted harness. |
| Escape with queued follow-up | Pressing Escape while the agent is running must interrupt the active turn without dropping the queued next prompt. | T7, `pi-native-chat.spec.ts` in the curated e2e baseline, `pi-native-property-baseline.spec.ts`, and `pi-native-harness-queue-stop-reload.spec.ts` assert the browser sends interrupt rather than Stop, renders the auto-posted queued user turn, clears the queue preview, and shows the following assistant completion. `harnessPiChatService.realLoop.test.ts` separately proves the same interrupt path preserves and continues the queued follow-up through Pi's real provider/tool loop. | No known service-level Escape gap; add full browser real-provider coverage only if the packaged playground can run deterministic provider fixtures without the scripted harness. |
| Composer draft clearing | A sent prompt remains in the composer until the backend request completes, making the UI look unsent or allowing accidental duplicate sends. | T2, `PiChatPanel.test.tsx`, and `pi-native-baseline-message-flow.spec.ts` assert the composer clears immediately after valid local prompt acceptance while the remote prompt promise is still pending, and preserves/restores the draft only for blocked or failed submissions. The browser baseline uses a delayed prompt receipt to catch "clear only after backend completes" regressions and a simulated failed prompt route to prove no accepted prompt or phantom message is recorded. | No known browser draft-clear gap; add real-provider slow-submit coverage only if the packaged playground can run deterministic provider fixtures without the scripted harness. |
| Working indicator flicker | The busy indicator above the composer mounts/unmounts at send and finish, causing a visible flash or jump when a turn starts or settles. | `PiChatPanel.test.tsx` and `pi-native-baseline-message-flow.spec.ts` assert the `chat-working-slot` remains mounted across idle, streaming, and idle transitions, while the visible `chat-working` status is exposed only while busy. The browser baseline stamps the slot before submit and proves the same DOM node survives both turn-start and turn-finish transitions, settling to `max-height: 32px; opacity: 1` while running and `max-height: 0; opacity: 0` when idle. | Add screenshot coverage only if future flicker is caused by paint/color rather than slot remount/layout state. |
| Assistant row flicker | A coalesced final provider message changes the canonical assistant id and causes React to remount the visible row, producing a flash even though the transcript has no duplicate row. | `pi-native-baseline-message-flow.spec.ts` now marks the live assistant DOM row during an aborted tool turn, emits a different-id late final message with no turn id, and asserts the same DOM row marker survives after the row's displayed id updates from the live tool id to the final id. The production render key uses a disjoint assistant-turn namespace when present, while user/system rows and turn-distinct assistant rows keep role/id-scoped keys. Reducer coverage also proves a committed same-turn tool row is folded into a streaming final assistant row before render, so the timeline does not expose duplicate assistant siblings with the same turn key. Both streaming-start coalescing and final-message coalescing remove/replace only exact committed row indexes, preserving older same-id assistant history from prior turns. Same-id final coalescing prefers a turn-matching/current committed row before older same-id history, so old text cannot leak into the current assistant row when provider ids repeat. | Add broader row-marker coverage only if future provider streams introduce multiple visible assistant rows within one turn. |
| Composer/model controls | Model picker crashes, model order changes, or thinking button state regresses. | T1, composer-controls e2e, `ModelSelect` tests, and panel persisted-setting tests assert menu order, prompt metadata, disabled mid-stream controls, session-switch re-enable behavior, and persisted control state. | Add real Pi provider-loop coverage if future turns gain server-side model/thinking overrides beyond prompt metadata. |
| Composer control style parity | Model and thinking dropdown triggers drift into unrelated visual styles, sizes, or menu surfaces, making the composer feel inconsistent with the old chat reference. | `ModelSelect` tests assert the model and thinking triggers both use compact bordered selector styling, the model search row keeps its divider/padding, and the thinking menu uses the same command-style popover surface without active/open accent collisions. `pi-native-baseline-composer-controls.spec.ts` asserts the workspace-style 56px outer composer rail, transparent rail background, visible inset rail border, borderless inner input group, centered slash settings row, no fixed `!h-10`/`!max-h-10` textarea height, and vertical rail growth after `Shift+Enter` multiline drafts. | Add visual snapshots if future CSS token changes make class-level assertions too weak. |
| Playground composer surface parity | The standalone agent playground drifts from the workspace-host chat surface, so the composer looks correct in component tests but wrong at `apps/agent-playground`. | `agentPlaygroundDefaults.test.tsx` asserts the playground defaults to the workspace-like surface: light theme v2 default, no internal chat chrome, no debug drawer, no session sidebar, thinking control on, and diagnostic toggles still available. `agentPlaygroundSourceAlias.test.ts` locks the standalone playground server to source aliases for `@hachej/boring-agent/front`, styles, shared, and internal `@` imports so manual testing at `:5183` cannot keep using stale package `dist`. `pi-native-standalone-playground-smoke.spec.ts` launches `apps/agent-playground/src/server/index.ts` itself, then verifies dark-mode debug chrome, source-backed composer load, 56px idle rail, no stale fixed-height textarea classes, normal first-row typing without rail growth, and `Shift+Enter` rail growth. `pi-native-baseline-composer-controls.spec.ts` catches the concrete CSS rail drift seen between `:5183` and the workspace target, including the outer rail/inner input-group split, constrained slash settings row, and multiline growth in the chrome/dark playground branch. | Add screenshot diff thresholds if future drift is caused by paint/color rather than the current measurable rail and layout metrics. |
| Inline filename formatting | Backticked filenames such as `README.md` render as heavy bordered boxes that look like selected inputs instead of lightweight inline tokens. | T5 display polish and `MessageResponse` primitive coverage assert filename inline code renders as a quiet borderless chip, while fenced code blocks still route through the code-block primitive. | Add visual snapshot coverage only if markdown styling starts diverging by shell/theme. |
| Playground all-message showcase | The playground loses its hard-coded display fixture for quickly inspecting system/user/assistant/reasoning/tool/error/queued states without running a live agent. | `apps/agent-playground/src/Showcase.tsx` includes a static chat UX showcase using the production message, reasoning, and tool primitives with deterministic ids across running, settled, failed, aborted, queued, inline-code, fenced-code, file-chip, and notice examples. `agentPlaygroundShowcase.test.tsx` is included in `test:chat-baseline --unit` and pins message id/order, roles, statuses, running/settled/failed/aborted tool states, queued follow-up banner, notice, file chip, and inline filename formatting. `pi-native-playground-showcase.spec.ts` is included in `test:chat-baseline --e2e` and opens the real playground showcase tab with the same assertions plus a screenshot attachment. | Add focused visual-diff thresholds if showcase styling regressions become common. |
| Split-brain root cause | Browser snapshots, AI SDK projections, and Pi JSONL compete as transcript owners. | Invariant 1, preferred harness mock boundary, T0-T10, `pi-native-baseline-message-flow.spec.ts`, `piNativeCutover.test.ts`, `pi-native-property-baseline.spec.ts`, and `pi-native-random-baseline.spec.ts` all assume one canonical Pi/session log with deterministic ids/seq and stable surviving-message order across randomized actions. The message-flow baseline seeds the old `boring-ui:chat-sessions:v1` browser transcript cache and asserts Pi-native hydration renders only `/state` messages; the cutover invariant rejects `@ai-sdk/react`, `useChat(`, and the old browser transcript key in production chat source. | No known split-brain owner gap; keep this invariant updated if the production chat ownership boundary moves. |

Current priority gaps:

No open deterministic baseline gaps are known from the incident matrix above.

## Baseline actors and selectors

The scenario uses these surfaces:

- Chat root: `[data-boring-agent-part="chat"]`
- Conversation: accessible name `Agent conversation`
- Message rows: `[data-boring-agent-part="message"]`
- Message text parts: `[data-boring-agent-part="message-text"]`
- Reasoning parts: `[data-boring-agent-part="message-reasoning"]`
- Tool groups: `[data-boring-agent-part="message-tools"]`
- Composer rail: `[data-boring-agent-part="composer-rail"]`
- Composer input: `[data-boring-agent-part="composer-input"]`
- Submit/stop button: `[data-boring-agent-part="composer-submit"]`
- Composer queue preview: `[data-boring-agent-part="composer-queue-preview"]`
- Model select: `[data-boring-agent-part="model-select"]`
- Thinking select: `[data-boring-agent-part="thinking-select"]`
- Session rows: `[data-boring-agent-part="session-row"]`

If an expected behavior cannot be asserted through these selectors, add a
stable data attribute before writing a brittle text-only test.

The standalone agent playground defaults to the workspace-like chat surface,
with the session sidebar hidden. Browser tests that assert
`[data-boring-agent-part="session-row"]` must opt in with `showSessions=1`.

## Scenario data

Use one deterministic mock session:

```ts
{
  sessionId: "baseline-main",
  title: "Baseline chat",
  seq: 0,
  status: "idle",
  messages: [],
  queue: { followUps: [] },
  followUpMode: "one-at-a-time"
}
```

Use deterministic model options in this exact server order:

```ts
[
  { provider: "anthropic", id: "claude-sonnet", label: "Claude Sonnet", available: true },
  { provider: "anthropic", id: "claude-opus", label: "Claude Opus", available: true },
  { provider: "openai", id: "gpt-main", label: "GPT Main", available: true },
  { provider: "openai", id: "gpt-fast", label: "GPT Fast", available: true }
]
```

The model menu baseline is not alphabetical sorting. It preserves the server's
order, grouped by provider in first-seen provider order. Search may filter
within that order but must not reshuffle items.

## Timeline

### T0: First load

Canonical state:

```ts
{
  seq: 0,
  status: "idle",
  messages: [],
  queue: { followUps: [] }
}
```

Expected UI:

- Chat root is connected or connecting, then connected.
- Conversation shows exactly one empty state.
- Legacy browser transcript caches or snapshots must not render even briefly
  while the Pi-native `/state` hydrate is pending.
- No message rows are rendered.
- Composer is enabled and focused or focusable.
- Submit is ready, not stop.
- Model select shows the server/default model label or "Pi default".
- Thinking select shows the persisted thinking level, defaulting to medium.
- No persistent composer thought/eye button is shown. Reasoning visibility is
  exposed when a reasoning part exists through the message-level thoughts row.
- Session history either has no rows or one empty active session, depending on
  shell policy. It must not show duplicate rows for the same session id.

Failure examples this catches:

- Empty-state and historical messages rendering together.
- Session row duplication on first hydrate.
- Composer starting in a stuck submitted/streaming state.

### T1: Configure composer

User actions:

1. Open the model menu.
2. Select `anthropic:claude-opus`.
3. Set thinking level to `medium`.
4. Preserve the default collapsed reasoning behavior until a reasoning part is
   rendered.

Expected UI/state:

- Model menu order remains:
  `Claude Sonnet`, `Claude Opus`, `GPT Main`, `GPT Fast`.
- The selected model is marked once.
- The trigger label changes to `Claude Opus`.
- Thinking trigger has selected state for `medium`.
- No chat message or composer-side thought button is created by changing
  controls.
- These settings persist across page reload for the same storage scope.

Failure examples this catches:

- Model menu re-sorting after selection.
- Duplicate selected model row when ids collide across providers.
- Thinking control showing stale visual state.
- Composer controls creating transcript artifacts.

### T2: Submit the first prompt

User action:

```text
baseline inspect workspace
```

Expected canonical transition:

```ts
// prompt receipt accepted
{
  status: "submitted" | "streaming",
  messages: [
    {
      id: "u1",
      role: "user",
      status: "done" | "pending",
      parts: [{ type: "text", id: "u1:t", text: "<redacted user prompt>" }]
    }
  ],
  queue: { followUps: [] }
}
```

Expected UI:

- Exactly one user message is visible for the submitted prompt.
- If `/state` already contains the submitted prompt and a later replay/live
  user `message-start` arrives with the same `clientNonce` but a different id,
  the row reconciles in place instead of rendering a duplicate prompt.
- The user message appears after any older messages and before assistant output.
- Composer clears the input after accepted submit.
- Composer clearing only clears the submitted text. A new draft typed while the
  submit receipt is still pending must survive receipt settlement and must not be
  overwritten by a delayed internal clear/restore.
- Submit control switches to stop/streaming state.
- The stable composer-near working slot is the busy visual. A second top
  progress strip/progressbar must not flash on turn start or finish.
- Model and thinking controls are disabled while their values are attached to
  the active turn, unless the UI explicitly supports changing future-turn
  defaults while busy.
- Session history shows the active session exactly once and updates its title or
  timestamp without reordering older messages in the transcript.

Failure examples this catches:

- Optimistic user message plus server user message both visible.
- Submitted text staying in composer after accept.
- Session history update causing transcript order changes.

### T3: Assistant starts with reasoning

Events:

```ts
[
  { type: "agent-start", seq: 1, turnId: "turn-1" },
  { type: "message-start", seq: 2, messageId: "a1", role: "assistant" },
  {
    type: "message-delta",
    seq: 3,
    messageId: "a1",
    partId: "r1",
    kind: "reasoning",
    delta: "Thinking about the workspace"
  }
]
```

Expected UI:

- Exactly one assistant message starts after `u1`.
- Reasoning appears inside that assistant message, not as a separate assistant
  row.
- If persisted reasoning visibility is on for the storage scope, reasoning
  content is visible as it streams.
- If reasoning visibility is off, the message-level thoughts control is visible
  and the content is collapsed, but the hidden content does not disturb message
  ordering.
- Clicking the collapsed thoughts control opens the reasoning content in the
  same assistant row, without changing the assistant message id or part order.
- The assistant message status is streaming.

Failure examples this catches:

- Reasoning appearing before the user prompt.
- A blank assistant card plus a separate reasoning card.
- Thought toggle changing message ids or row counts.

### T4: Tool call lifecycle

Events:

```ts
[
  {
    type: "tool-call",
    seq: 4,
    messageId: "a1",
    toolCallId: "tool-1",
    toolName: "bash",
    input: { command: "printf baseline" }
  },
  {
    type: "tool-result",
    seq: 5,
    messageId: "a1",
    toolCallId: "tool-1",
    output: "BASELINE_TOOL_OUTPUT"
  }
]
```

Expected UI:

- One tool card/group appears inside assistant message `a1`.
- The tool card initially shows pending/running state.
- The same tool card updates to completed/result state after `tool-result`.
- If `tool-result` carries `isError: true`, the same tool card updates to a
  failed/error state in place, the active turn does not remain busy, and the
  error text is visible after opening the tool disclosure.
- The tool input and output are shown in the renderer shape used by old
  boring-ui, adapted to the neutral Pi-native tool part.
- The card remains in chronological order after reasoning and before final text.
- No second tool card appears for the same `toolCallId`.
- The completed tool does not continue to show a spinner, "running", or
  ambiguous "used" state.

Failure examples this catches:

- Tool result appending as text in the wrong location.
- Tool card duplication across streaming updates.
- Tool state stuck after completion.

### T5: Assistant text streams and finalizes

Events:

```ts
[
  {
    type: "message-delta",
    seq: 6,
    messageId: "a1",
    partId: "t1",
    kind: "text",
    delta: "Workspace inspected."
  },
  {
    type: "message-delta",
    seq: 7,
    messageId: "a1",
    partId: "t1",
    kind: "text",
    delta: " Summary ready."
  },
  {
    type: "message-part-end",
    seq: 8,
    messageId: "a1",
    partId: "t1",
    kind: "text",
    text: "Workspace inspected. Summary ready."
  },
  { type: "message-end", seq: 9, messageId: "a1" },
  { type: "agent-end", seq: 10, turnId: "turn-1", status: "ok" }
]
```

Expected UI:

- Assistant message `a1` remains one row.
- Text deltas append to one text block.
- Final text is exactly `Workspace inspected. Summary ready.` once.
- Reasoning, tool, and text order remains `reasoning -> tool -> text`.
- Composer returns to ready state.
- Stop button disappears.
- Model and thinking controls are enabled again.

Failure examples this catches:

- Text delta repetition, such as `Workspace inspected.Workspace inspected.`
- Multiple assistant rows for one turn.
- Composer stuck in streaming after `agent-end`.

### T6: Queue follow-ups during a busy turn

Start a second prompt and keep the session streaming. While it is busy, submit:

```text
follow up one
follow up two
follow up three
```

Expected canonical state while busy:

```ts
{
  status: "streaming",
  queue: {
    followUps: [
      { id: "q1", kind: "followup", displayText: "follow up one" },
      { id: "q2", kind: "followup", displayText: "follow up two" },
      { id: "q3", kind: "followup", displayText: "follow up three" }
    ]
  }
}
```

Expected UI:

- The active assistant turn remains streaming.
- Queued follow-ups are visually distinct from committed user messages.
- Composer queue preview says `3 queued follow-ups`.
- Queue order is `follow up one`, `follow up two`, `follow up three`.
- If item-level delete is available, deleting the second queued item removes
  only `follow up two` and leaves `follow up one` then `follow up three`.
- `Edit queued` restores the remaining queued text into the composer in order
  and clears the server queue after the text has been restored locally.
- Queue operations do not duplicate committed transcript messages.

Failure examples this catches:

- Accepted follow-ups shown twice: once as pending messages and once in preview
  without clear distinction.
- Queue order changing after reload.
- Edit queued clearing the server queue before restoring text locally.

### T7: Stop or interrupt while busy

User action:

- Click the stop button or press Escape while an active turn is streaming.

Expected UI/state:

- Stop request is sent once for the active session.
- Composer returns to ready once the stop receipt or abort event is accepted.
- The active assistant message is left in a clear aborted/incomplete state, or
  finalized with an abort notice, but not duplicated.
- Escape/interrupt does not clear the queue. If queued follow-ups exist, the
  next queued follow-up is auto-posted as the next user turn after the current
  turn is aborted.
- Queued follow-ups are cleared only if the server stop response says they were
  cleared. If they remain in `/state.queue`, the UI must continue showing them.
- Escape must not send both interrupt and stop for the same state transition.

Failure examples this catches:

- Multiple stop requests from one Escape key press.
- Escape acting like Stop and dropping a queued next prompt.
- The queued follow-up remaining in preview after it was auto-posted.
- Queue preview disappearing locally while server state still contains queue
  items.
- Aborted assistant row reappearing as a new completed assistant row.

### T8: Reload during active streaming

Prepare state with:

```ts
{
  seq: 30,
  status: "streaming",
  messages: [
    { id: "u1", role: "user", status: "done", parts: [{ type: "text", id: "u1:t", text: "<redacted user prompt>" }] },
    {
      id: "a1",
      role: "assistant",
      status: "streaming",
      parts: [
        { type: "reasoning", id: "r1", text: "Thinking about the workspace", state: "done" },
        { type: "tool-call", id: "tool-1", toolName: "bash", state: "output-available", output: "BASELINE_TOOL_OUTPUT" },
        { type: "text", id: "t1", text: "Workspace inspected." }
      ]
    }
  ],
  queue: { followUps: [{ id: "q1", kind: "followup", displayText: "queued across reload" }] }
}
```

User action:

- Reload the browser tab.

Expected UI:

- The app hydrates from `/state` before rendering an empty transcript.
- Message order after reload is still `u1`, `a1`.
- Assistant parts after reload are still `reasoning`, `tool`, `text`.
- Queue preview still shows `queued across reload`.
- Chat root exposes the same active session id.
- Connection state is connecting/reconnecting briefly, then connected.
- Session history shows the active session exactly once.
- No localStorage or IndexedDB transcript cache is needed to pass.

Failure examples this catches:

- Empty chat flash becoming permanent.
- Tool card duplicated after replay.
- Session row duplicated after reload.
- Queued follow-up lost because only browser state knew about it.

### T9: Session history and switching

Prepare three sessions:

```ts
[
  { id: "s-new", updatedAt: "2026-06-04T12:03:00.000Z", title: "Newest" },
  { id: "baseline-main", updatedAt: "2026-06-04T12:02:00.000Z", title: "Baseline chat" },
  { id: "s-old", updatedAt: "2026-06-04T12:01:00.000Z", title: "Oldest" }
]
```

Expected UI:

- Session history order is `Newest`, `Baseline chat`, `Oldest`.
- Active row is marked once.
- Switching to `s-old` replaces the visible transcript with `s-old` messages.
- Switching back to `baseline-main` restores the exact baseline transcript order.
- Creating a new chat does not mutate old session messages.
- If the active session title or `updatedAt` changes after hydration or after
  the active turn settles, the session row updates in place and still appears
  exactly once.
- A streaming session moving to the top because `updatedAt` changes must not
  reorder messages inside that session.

Failure examples this catches:

- Chat history list sorted oldest-first.
- Active session row duplicated after title or updatedAt changes.
- Assistant messages from a stale session leaking into the new active session.

### T10: Plugin reload and display-only UI commands

User action:

```text
/reload
```

Expected UI/state:

- `/reload` runs the injected reload command once.
- The user sees one plugin reload notice.
- No user transcript message is created for `/reload` unless the shell
  deliberately records slash commands as notices.
- A chat-emitted `ui-command` event is rendered as display-only evidence if the
  timeline supports it, but it does not dispatch workspace bridge commands by
  itself.
- Dispatch count for `boring:ui-command` remains zero unless the command went
  through `UiBridge.postCommand`.

Failure examples this catches:

- `/reload` both running a command and submitting to the model.
- Display-only UI command opening duplicate panels.
- Plugin reload notice duplicated after reconnect.

## Expected final transcript summary

After T0-T10, the baseline main session transcript should summarize as:

```ts
[
  {
    id: "u1",
    role: "user",
    status: "done",
    text: "<redacted user prompt>"
  },
  {
    id: "a1",
    role: "assistant",
    status: "done" | "streaming" | "aborted",
    parts: [
      { type: "reasoning", id: "r1" },
      { type: "tool-call", id: "tool-1", toolName: "bash", state: "output-available" },
      { type: "text", id: "t1", text: "Workspace inspected. Summary ready." }
    ]
  }
]
```

The exact assistant status depends on whether T7 stop/interrupt is executed
before or after T5 finalization. The row and part ids must stay stable either
way.

## Test decomposition

Do not put the whole baseline into one giant e2e test. Use one shared fixture
and split the scenario into focused tests:

1. `pi-native-baseline-message-flow.spec.ts`
   - Covers T0-T5.
   - Asserts message id uniqueness, role/order, reasoning/tool/text order,
     delayed running-to-settled tool state transition, fragmented streaming
     text de-duplication, delayed accepted-submit composer clearing, two-turn
     append/order stability, working indicator slot stability across turn
     start/finish, failed tool settlement, different-id late-final abort
     preservation, failed-submit draft restoration, and composer busy/ready state.
   - Direct live-row coverage in `PiTimelineMessage.test.tsx` pins the production
     renderer's reasoning/tool/notice/text order and collapsed thoughts toggle
     before browser-level timing tests run.
2. `pi-native-chat.spec.ts` and `pi-native-harness-queue-stop-reload.spec.ts`
   - Covers T6-T7.
   - Asserts queue order, preview, edit queued, stop/interrupt request count,
     queue persistence across reload, Stop clearing semantics, and Escape
     auto-posting the next queued follow-up.
3. `pi-native-chat-reload.spec.ts`, `pi-native-replay-gap.spec.ts`,
   `pi-native-long-transcript-reload.spec.ts`, and
   `pi-native-multi-session-cold-reload.spec.ts`
   - Covers T8.
   - Asserts `/state` hydrate, event cursor recovery, replay-gap/cursor-ahead
     recovery, no empty transcript overwrite, no duplicate rows/cards, long
     transcript survival, transient session-list `503` retry, and queue
     survival where the server still owns it.
4. `pi-native-baseline-history.spec.ts`
   - Covers T9.
   - Asserts session sorting by `updatedAt` descending, one active row, session
     switch isolation, active live/reload metadata refresh without duplicate
     selected rows, and transcript order after switching back or rehydrating.
   - `pi-native-harness-baseline-message-flow.spec.ts` also covers the
     user-reported active-refresh case where the page reloads while the second
     assistant turn is still running; old completed rows must not inherit the
     active turn id or fold into the running assistant row.
5. `pi-native-baseline-composer-controls.spec.ts`
   - Covers T1 and T10.
   - Asserts the workspace-style composer rail and slash settings row, model
     menu order, selected model stability, thinking select state, prompt
     model/thinking metadata, no persistent composer thought button, mid-stream
     model/thinking disabled state, session-switch re-enable behavior, slash
     reload behavior, multiline composer growth, no stale fixed-height
     textarea classes, and display-only UI command non-dispatch.
6. `pi-native-standalone-playground-smoke.spec.ts`
   - Covers the manual `apps/agent-playground` server path that is not covered
     by the CLI-hosted browser matrix.
   - Asserts the source-backed standalone server resolves front/shared/internal
     aliases, renders dark-mode debug chrome, preserves the 56px idle composer
     rail, rejects stale fixed-height textarea utilities, and grows the rail for
     a multiline `Shift+Enter` draft.
7. `harnessPiChatService.realLoop.test.ts`
   - Covers the real Pi model/provider loop for T4/T5/T7 at service level.
   - Asserts a fake provider can request real custom tools, Pi executes success
     and error cases, abort during tool execution settles the turn, multiple
     tool results attach to the same assistant message, interrupt preserves
     and posts the next queued follow-up after the aborted turn, a fresh
     service can hydrate the completed tool result after reload, and Pi
     continues to final text without duplicate tool-result events when not
     aborted.
7. `pi-native-harness-tool-liveness.spec.ts`
   - Uses the scripted Pi harness with
     `BORING_AGENT_E2E_SCRIPTED_PI_TOOL_DELAY_TICKS`.
   - Holds the tool card in the live running state long enough for browser
     assertions, then proves the same assistant message/tool group settles in
     place instead of duplicating or looking stuck.
8. `pi-native-harness-reasoning-parts.spec.ts`
   - Uses the scripted Pi harness with
     `BORING_AGENT_E2E_SCRIPTED_PI_REASONING_PARTS`.
   - Proves multiple reasoning chunks stay attached to one assistant message,
     are grouped in the thoughts affordance before the live tool group, and
     remain before final text after the assistant settles.
9. `pi-native-error-scope.spec.ts`
   - Covers T7/T8 stream error scoping.
  - Proves stale old-turn `error`/`agent-end` events consume their seq without
     mutating the active streaming assistant, while a terminal current-turn
     error settles the active assistant in place and a later non-error
     `agent-end` cannot mask the runtime error notice. Also proves the composer
     leaves Stop state, re-enables, and accepts a redacted follow-up prompt
     after the terminal error. Runtime notices are selected through stable
     `[data-boring-agent-part="runtime-notice"]` hooks.

Each e2e test should attach a redacted evidence object with:

```ts
{
  checkpoint: "T5",
  sessionId: "baseline-main",
  seq: 10,
  status: "idle",
  connection: "connected",
  messageSummary: [
    { id: "u1", role: "user", status: "done", partTypes: ["text"] },
    { id: "a1", role: "assistant", status: "done", partTypes: ["reasoning", "tool-call", "text"] }
  ],
  queueSummary: [],
  sessionRows: ["baseline-main"]
}
```

## Property-based interaction baseline with Bombadil

Bombadil is useful for this chat baseline, but it should be layered on top of
the deterministic Playwright specs above, not replace them.

Use Playwright for the canonical timeline:

- exact T0-T10 checkpoints;
- deterministic mock Pi session events;
- screenshot/trace artifacts for regressions;
- CI gating for known bugs.

Use Bombadil for property-based exploration:

- random but valid sequences of composer submits, queueing, stop, reload,
  model/thinking menu opens/selections, and waits;
- weird timing around streaming events and reloads;
- invariants that must hold in every observed browser state.

The first property probe lives in
`packages/agent/e2e/pi-native-property-baseline.spec.ts`, backed by the reusable
DOM extractor/invariant helpers in `packages/agent/e2e/helpers/chat-state.ts`.
It runs through the scripted harness and checks the initial invariants after a
mixed sequence of model-menu, thinking, streaming, queue, reload, Escape, Stop,
and final reload actions.

The seeded randomized browser runner now lives in
`packages/agent/e2e/pi-native-random-baseline.spec.ts`. It uses the same
scripted harness and invariant helper, randomly chooses only valid actions from
the current DOM state, records the seed plus observed action trace for debugging,
and adds a stable-order check that surviving message ids never reorder across actions or reloads.

The external Bombadil baseline now lives in
`packages/agent/e2e/bombadil/pi-native-chat.spec.ts`, with a package runner at
`pnpm --filter @hachej/boring-agent run test:bombadil:chat` and a longer
nightly runner at `pnpm test:bombadil:chat:nightly`. The nightly runner is wired
through `.github/workflows/chat-baseline-nightly.yml`. It starts the deterministic
scripted Pi harness, drives the browser with valid chat actions, and checks the
same compact state shape from the DOM:

```ts
type ChatDomState = {
  connection: string | null
  sessionId: string | null
  messages: Array<{
    id: string | null
    role: string | null
    status: string | null
    waitingFollowUp: boolean
    partOrder: string[]
    text: string
  }>
  queueText: string
  modelLabels: string[]
  selectedModel: string
  thinkingLabel: string | null
  workingVisible: boolean
  submitLabel: string | null
  lastActionType: string | null
  sessionRows: Array<{ text: string; selected: boolean }>
  composerFocused: boolean
  composerValue: string
}
```

Bombadil properties:

1. **No duplicate message ids:** every non-null displayed message id is unique.
2. **No duplicate active session rows:** at most one session row is selected.
3. **Assistant part order is stable:** for a single assistant message, reasoning
   may precede tools, tools may precede text, and notice parts stay last.
4. **Final text is not repeated:** known fixture final strings such as
   `PI_NATIVE_ASSISTANT_DONE` appear at most once in the active assistant row.
5. **Busy state is coherent:** if the working indicator is visible, the composer
   submit is in stop state.
6. **Model menu order is stable:** when the deterministic model fixture is
   active, menu item order stays `Claude Sonnet`, `Claude Opus`, `GPT Main`,
   `GPT Fast`.
7. **Reset fixtures do not leak stale text:** known stale sentinel text from
   rehydrate/reset tests must never render.
8. **Connected resets never empty an existing transcript:** once a session has
   messages, reconnect/reload states may not settle back to connected with an
   empty transcript for the same session.
9. **Reload does not drop queued follow-ups:** a queued follow-up that survives
   into a reload must still be shown in the queue preview or appear as the
   posted user message after reconnect.
10. **Surviving message order is stable:** message ids that survive from one
    observed state to the next never reorder.
11. **Queued rows are visually distinct:** displayed `queue:*` message rows are
    marked as waiting follow-ups, and waiting rows stay user/pending rows.

Bombadil action generators:

- type one of a small redacted prompt corpus into the composer and submit;
- submit follow-ups while the turn is busy;
- press Escape/click stop while busy;
- reload;
- open model menu and select an available item;
- open thinking select and choose off/low/medium/high;
- wait.

Run shape:

```bash
CI=true pnpm --filter @hachej/boring-agent exec playwright test \
  -c e2e/playwright.config.ts \
  e2e/pi-native-random-baseline.spec.ts

PI_NATIVE_RANDOM_BASELINE_SEED=424242 PI_NATIVE_RANDOM_BASELINE_STEPS=20 \
  CI=true pnpm --filter @hachej/boring-agent exec playwright test \
  -c e2e/playwright.config.ts \
  e2e/pi-native-random-baseline.spec.ts

BOMBADIL_TIME_LIMIT=30s \
  pnpm --filter @hachej/boring-agent run test:bombadil:chat

BOMBADIL_OUTPUT_PATH=/tmp/boring-agent-bombadil-pi-native-chat-long \
  pnpm test:bombadil:chat:nightly
```

The Bombadil target uses the deterministic scripted Pi harness. Do not fuzz
against a real LLM backend as the baseline gate; real model timing/content
makes violations hard to reproduce and debug.

## Preferred mock boundary

The preferred baseline mock is harness-level, not browser-level.

Browser `fetch` mocking is still useful for fast UI assertions, but it skips the
server chain that most Pi-native bugs live in. For the real interaction
baseline, mock the LLM/model behavior inside the harness so these layers remain
real:

- `POST /api/v1/agent/pi-chat/:sessionId/prompt`
- `HarnessPiChatService`
- Pi session adapter/event mapping
- NDJSON `/events`
- `RemotePiSession`
- chat reducer/selectors
- React message/tool/composer renderers

There are two useful harness-level mocks:

1. **Scripted session adapter**
   - Implement a deterministic `PiAgentSessionAdapter`/`AgentHarness`
     returned by `harness.getPiSessionAdapter()`.
   - It emits Pi session events directly: user message, assistant reasoning,
     tool call, tool result, text deltas, queue updates, abort/end.
   - This is the right default for UI quality, reload, ordering, queue, and
     Bombadil property tests because it is simple and fully deterministic.
   - It does not prove the real Pi model loop executes tools.

2. **Scripted model/provider**
   - Register a fake provider/model in Pi's `ModelRegistry` or extension system.
   - The fake provider returns deterministic model streams that request real
     tools (`bash`, `read`, `write`, `edit`, `grep`, etc.).
   - Pi then runs the normal tool loop and the normal boring tool adapters.
   - This is the higher-fidelity test for "LLM chooses tool -> tool executes ->
     tool result becomes chat state -> UI renders it".
   - It should be used for a smaller set of integration scenarios because it is
     heavier and more coupled to Pi provider APIs.
   - The first focused proof is
     `packages/agent/src/server/pi-chat/__tests__/harnessPiChatService.realLoop.test.ts`.
     It uses a fake provider stream plus a real Pi `AgentSession` to catch Pi's
     actual event ordering around `toolcall_end`, assistant `message_end`, and
     `tool_execution_end`.

The baseline should use both levels:

- use the **scripted session adapter** for Bombadil fuzzing and the broad
  T0-T10 UI invariant matrix;
- use the **scripted model/provider** for a focused "real tool-loop" matrix:
  read/write/edit tool families and browser reconnect/replay after final text
  arrives.

Do not mock at the real network provider/LLM API boundary in CI with live
credentials. The baseline must be deterministic and safe to run without secrets.

## DOM probes to add to tests

Use helper probes instead of repeating loose text assertions:

```ts
async function readMessageSummary(page) {
  return page.locator('[data-boring-agent-part="message"]').evaluateAll((nodes) =>
    nodes.map((node) => ({
      id: node.getAttribute('data-boring-agent-message-id'),
      status: node.getAttribute('data-boring-agent-message-status'),
      text: node.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      reasoningCount: node.querySelectorAll('[data-boring-agent-part="message-reasoning"]').length,
      toolGroupCount: node.querySelectorAll('[data-boring-agent-part="message-tools"]').length,
      textPartCount: node.querySelectorAll('[data-boring-agent-part="message-text"]').length,
    }))
  )
}
```

Tests should then assert:

- `new Set(summary.map(m => m.id)).size === summary.length`
- expected role/order through surrounding component state or role-specific
  attributes if present;
- one assistant row contains reasoning, tool, and text parts;
- final text appears once;
- tool group count for `tool-1` is one before and after result;
- queue preview text order matches queue state.

If roles are not exposed on message rows, add
`data-boring-agent-message-role={message.role}`. This is a testability fix, not
a visual refactor.

## Iteration loop

For each bug cluster:

1. Reproduce with the closest baseline checkpoint.
2. Add the failing assertion to the focused baseline test.
3. Fix the smallest state owner or renderer issue.
4. Re-run the focused test.
5. Re-run the package-level chat tests:

```bash
pnpm --filter @hachej/boring-agent run test
CI=true pnpm --filter @hachej/boring-agent exec playwright test -c e2e/playwright.config.ts e2e/pi-native-chat*.spec.ts
```

Only after the focused baseline tests pass should a broader `pnpm typecheck`,
`pnpm lint`, and `pnpm test` run be treated as final evidence.

## Known bug mapping

| Reported problem | Baseline checkpoint |
| --- | --- |
| Duplicated messages | T2, T5, T8, T9 |
| Tool used/state wrong | T4, T8 |
| Thinking button in composer | T1, T5 |
| Model menu sorting | T1, T9 |
| Composer grows while typing first row | T0 |
| Message ordering in chat history | T8, T9 |
| Reload loses or duplicates state | T8 |
| Slash/plugin reload duplicates notices | T10 |

This mapping is the starting triage board for `/goal` work.
