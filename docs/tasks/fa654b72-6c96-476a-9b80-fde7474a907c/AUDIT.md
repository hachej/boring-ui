# D-1224 (One home for chat logic): phase 1 audit and plan

Read-only audit of origin/main at 61596aa44. No code changed. Paths are under `registry/` unless they start with `packages/`.
"Not checked" means I did not read it.

## Short answer

Most of the work is done. Transport, session, drafts, conversations, voice, notifications, artifact follow, run view rules
and the text grammar already live in the kit. About 14 small pieces are left; about 5 are real drift or real duplication.
A full "presentation only" end state is not worth chasing: the first 3 to 6 PRs capture nearly all the value.

## 1. Current state: logic still in registry items

Drift = copies that behave differently. Evidence is a read of the copies unless said otherwise.

| # | Piece | Where | Copies / drift | Kit home |
|---|---|---|---|---|
| A | Answer/decision submit state (`sent`, `sending`, `refusal`, mounted guard, catch to message) | `pi-chat-question/question-card.tsx:91-115`, `pi-chat-approval/approval-card.tsx:56-64` | 2 near-identical copies; only the label keys differ (`answerRefused`/`answerNotSent` vs `decisionRefused`/`decisionNotSent`). `inline-question`: not checked. | `chat-react` hook. **Done** (step 2, `useSubmitOutcome` in `chat-react-submit.ts`; both cards use it, label keys stay theirs; `inline-question` holds no submit state, it calls `onAnswer`). |
| B | Question argument parser `parseQuestion`, `formAnswer`, `splitFormAnswer`, `parseAnswer` | `pi-chat-question/question-card.tsx:29-80` | 1 copy, but the kit needs it: `packages/ui/src/run-notifications.ts:67` takes it as an injected `question` callback, passed from `pi-ambient/notifications.tsx:32,45`. `packages/ui/src/chat-view.ts:194` reads `arguments.question` a second way. Inverted dependency. | `chat-view`. **Done** (step 2): the four functions are in `chat-view.ts`, `question` of `RunNotificationOptions` is optional with the kit parser as default, `pi-ambient` no longer injects it, the item re-exports `parseQuestion`, `formAnswer`, `parseAnswer`; the option stays public until a boring-factory search says otherwise (none found for `parseQuestion`, `formAnswer`, `useRunNotifications`, `watchConversation`). |
| C | `<target>` block grammar (point-and-speak) | Builder `agent-target/agent-target.tsx:49-58,131`; parser `packages/ui/src/chat-view.ts:23-37`; strippers `packages/agent/src/conversations.ts:102-107`, `packages/agent/src/struggle.ts:59`; readers `pi-chat/history.tsx:36`, `pi-chat/queue.tsx:15` | 4 grammars. Builder escapes `<`, caps 1024 bytes, joins with `\n\n`. Kit parser requires `\n\n`, the cap and a JSON object. `conversations.ts` needs neither `\n\n` nor the cap and trims. `struggle.ts` is a lazy regex, no cap. One message can be a chip in the chat and plain text in a title. | `chat-view` |
| D | Workspace change feed hook | `documents/documents.tsx:50-62` (`useWorkspaceVersion`), `pi-app/agent-workspace.tsx:715-760` (`useChangeFeed`, `usePageShown`) | 2 copies, drifted. `documents` has no `since` resume, no 150 ms settle, no pause while hidden, no `live`. `agent-workspace` has all four. Files, not chat: adjacent. | `file-tree` or new subpath (Q2). **Done (D-1719):** `useWorkspaceChangeFeed` in `@hachej/boring-ui-kit/file-tree-view`; `documents` and `agent-workspace` both use it. |
| E | File-tree controller bound to a provider (create, refresh, dispose) | `documents/documents.tsx:64-80`, `pi-app/agent-workspace.tsx:~425-435`, `pi-app/use-revision-attachments.ts:38-46` | 3 copies, same shape. Refresh-timing drift not compared. Files, not chat: adjacent. | `file-tree` hook **Compared, not merged (D-1719):** refresh-on-change rules differ; see `docs/tasks/6dc26e1b-e627-436b-a825-9d2d0fc45a4e/NOTES.md`. |
| F | Attachment upload policy: `acceptsFile`, `imageData`, `attachmentPath`, `uploadRevisionAttachments` | `pi-app/revision-files.ts:6-60`, `pi-app/use-revision-attachments.ts` | 1 copy. A second accept-list parser with the same split/trim/lower: `pi-chat/composer.tsx:162` (`acceptsPhotos`). The kit session only calls `attachments.upload` (`packages/ui/src/chat-react-session.ts`). | `chat-react` |
| G | Recovered-step rule `gotPast`; file-change collection (write/edit to created/edited) | `pi-chat/message.tsx:389-395`, `~427-436` | 1 copy each. The kit already owns `derive`/`segments`. Covered by journey `test/ui/pi-chat-recovered-step.test.mjs`, no unit test. | `chat-view` |
| H | Controller remount on change plus "latest controller" ref | `pi-chat/pi-chat.tsx:182-187`, `pi-ambient/ambient.tsx:223-225` | 2 copies, drifted. PiChat also re-keys on the recorder hook and updates the ref in `useLayoutEffect`; Ambient assigns it during render, with a comment that children's effects must see the new one. PiChat can show a child effect the old controller. | `chat-react` hook |
| I | Submission observation (poll `submissionStatus`, read `pi.live` partial, settle) | `agent-target/agent-target.tsx:63-100` | 1 copy. Other readers of `pi.live` in the kit: `chat-view.ts:154`, `native-chat.ts:209,265`, `chat-artifacts.ts:79`. | `native-chat` |
| J | Draft handling in `talkAbout` (remove previous mention, append, set text) | `app-shell/agent-layer.tsx:368-385` | 1 copy; the rest of that function is layer open/focus and stays. | `chat-text` |
| K | Shared-chat model: `sharedItems` (15 min and same-day grouping, artifact dedupe, quotes), `memberName`/`agentKind`/`rawLike`, `showsAuthors`, `runHead`, `safeAvatarUrl` | `shared-chat/messages.tsx:58,369-414`, `shared-chat/names.ts` | 1 copy. The kit `shared-chat` subpath has none of these (grep). Pure functions; only a contract test (`test/contracts/shared-chat-member-mention.test.mjs`). | `shared-chat` |
| L | Recording cancel on Escape, blur, hidden | `pi-chat-voice/use-hold-to-record.ts:13-26`, `packages/ui/src/voice-attempt.ts:41-50` | 2 copies. Registry cancels everything and on unmount; kit cancels only `starting`/`recording`. Whether the split is intended: not verified. | `chat-react/voice` |
| M | `useCursorInOpened` (focus and replay of typed keys after New) | `pi-chat/session.tsx:141-156` | 1 copy, used by PiChat and Ambient. DOM focus. | `chat-react` |
| N | Image source resolve (`new URL(image.url, location.href)`), signed URL | `pi-chat/composer.tsx:23-40`, `pi-chat/message.tsx:~212` | 1 copy each. Not checked against the `chat-photo-links` journey. | leave |

Read, thin adapters over kit hooks, nothing to move: `pi-chat/session.tsx` (`useChatSession`, `useTranscript`), `use-chat-draft.ts`,
`use-conversations.ts`, `use-remote-chat.ts`, `app-shell/use-dictation.ts`, `pi-ambient/notifications.tsx` (except B),
`shared-chat/use-shared-chat.tsx`, `pi-chat/rows.ts`. Not checked: `feedback/*` (point-and-speak recording; `feedback-session.tsx` is 497 lines),
`pi-chat-subagent/*` parsing against `packages/agent/src/delegate.ts`, `spaces/use-spaces.ts`, `pi-workspace/workspace.tsx`, `inline-question`.

## 2. Already done

Merged branches `feat/chat-view-rules` and `feat/chat-logic-kit*` (PRs #1870, #1880, #1884, #1886, #1888, #1890, #1893, #1894; I did not map each number to a commit):

- `dd7eebaeb` chat view rules (`chat-view`): `derive`, `segments`, `waitingPart`, `targetContent`, approval records (#1870).
- `1c136c031` text grammar (`chat-text`): pieces, mentions, slash, paste (#1880).
- `f46ded5df` shared chat hooks, `useRemoteChat`, `useConversations`, `useChatDraft`, `useChatPlacement` (`chat-react`).
- `af8af4572` run and background notifications (`run-notifications.ts`).
- `018b1bf2b` artifact versions, `useArtifactFollow`, present acknowledgements.
- `e8a911a2d` voice attempts, dictation, message preparation (`chat-react/voice`).
- `b95478d52` headless session: send/restore, queue, uploads, paste, pickers, a typed message answering a question.

Transport (`native-chat.ts`, `remote-chat.ts`, projected watch, first-view timeout) is kit-owned. No chat `fetch`, `WebSocket` or `EventSource` call
remains under `registry/` (grep). The only registry `fetch` uses are `pi-app/use-new-version.ts` (version poll) and `drawing-viewer` (font probe).

## 3. Ordered extraction PRs

Each is behaviour-preserving except where a drift is resolved (named). Every PR adds a fail-first test through the public entry (the rendered block
or the kit export), as AGENTS.md requires, and keeps old registry exports as re-exports (no export removed without a fresh consumer search).
Journeys: `npm run workspace-app:journey`, `npm run test:pi-chat-consumer`.

1. **`<target>` grammar once (C).** Add a builder and a strict stripper beside `targetContent` in `chat-view`; `agent-target`, `history.tsx`, `queue.tsx` use them.
   Pick the kit parser's strict rules and document them. Tests: extend `test/packages/ui-chat-view.test.mjs` (round trip, 1024 cap, missing `\n\n`) and
   `test/contracts/pi-chat-target-chip.test.mjs`. Risk: a message the server stripper accepted but the chip refuses now reads differently (Q1). Consumers: agent-target, pi-chat, app-shell.
2. **Workspace change feed once (D).** Move `useChangeFeed` to the kit; `documents` uses it. Resolves drift: Documents then pauses while hidden and resumes from `since`.
   Tests: unit with a fake `RevisionProvider.changes`; a Documents case in the viewers source test. Risk: low-medium (Documents reload becomes debounced 150 ms). Consumers: documents, pi-app. Depends on Q2.
3. **Submit-outcome hook (A) and question parser (B).** Both into the kit; the two cards and `notifications.tsx` use them and the injected `question` callback gets a default.
   Tests: `test/contracts/pi-chat-decided-approval.test.mjs`, `test/ui/pi-chat-question-send.test.mjs`, a new kit unit for malformed model arguments. Risk: low. Consumers: pi-chat-question, pi-chat-approval, pi-ambient. Keep the `parseQuestion` re-export.
4. **Controller remount hook (H).** `chat-react` hook used by PiChat and Ambient. Resolves the ref timing drift toward Ambient's (assigned in render).
   Tests: `test/ui/ambient-position.test.mjs`, `test/ui/pi-chat-new-chat-send.test.mjs`, a controller-swap unit. Risk: medium (focus and draft across a swap). Consumers: pi-chat, pi-ambient, app-shell.
5. **Attachment policy (F).** `acceptsFile`, `imageData`, `attachmentPath`, `uploadRevisionAttachments` into `chat-react`; `acceptsPhotos` reuses the token parser.
   Tests: new kit unit (accept lists, `maxBytes`, `inlineImages`), `test/ui/file-tree.impl.mjs`, `APP_ONLY=inline-images npm run workspace-app:journey`. Risk: low. Consumers: pi-app, examples.
6. **Shared-chat model (K).** Pure functions to the `shared-chat` subpath with unit tests (none today). Risk: low (labels passed in). Consumers: shared-chat.
7. **Observe submission (I) and recovered step (G).** Two separate small PRs. I needs poll and abort tests with a fake controller (150 ms poll preserved). Risk: medium for I, low for G.
8. **Optional, last: E, J, L, M.** A few dozen lines each, one reader each. Only if the "registry holds no logic" grep is a hard gate (Q3).

Order by value: 1 (three diverging parsers of user data), 2 (user-visible staleness), 3, 4, 5, 6, 7.

### Not worth moving

- N, `developerSwitch` (`pi-chat.tsx:163`, host policy by URL), `browser-notify.ts` (Notification API wrapper), persisted UI prefs (`placed-agent` `read`, `history-column` `useHistoryOpen`, `utils/persisted`), layer snap and Back state in `agent-layer.tsx`, ambient position and clamp.
- Duration and clock formatters: `ambient.tsx:51`, `config.ts:257 voiceClock`, `feedback-session.tsx:39`, `run-card.tsx:49` vs `subagent-card.tsx:58` (the two `span` drift: under 1 s gives "0 s" vs "0.4 s"), `relativeTime` in `history.tsx:38` vs `version-history.tsx:56`. They are display words; dedupe inside the registry if it matters, not into the kit.
- The scroll wiring `transcript.reset(); stick.scrollToBottom('instant')` in PiChat, Ambient and `shared-chat/timeline.tsx:64,67`: it needs the host's MessageScroller, so it cannot be headless.
- `nameOf` (`documents.tsx:47`, `file-viewer.tsx:36`) and `readText` vs `decodeText` (`use-saved.ts:5`, `file-kinds.ts:8`): not chat.

Recommendation: do PRs 1 to 3 (real drift), then 4 to 6 if capacity allows, and stop. Amending the done-criterion to "no duplicated or drifted chat logic across registry items" is honest and cheaper than "no logic at all".

## 4. Open questions for the owner

- Q1. `packages/agent` has only a type-only dependency on `ui` (ARCHITECTURE.json), so its two `<target>` strippers cannot import the kit grammar. Should the grammar move to `boring-files` (both depend on it), or stay duplicated with a contract test comparing them? For a block without `\n\n`, which wins: chip and title, or plain text?
- Q2. The change feed and tree binding (D, E) are files, not chat. Same task, a separate task, or leave? The kit root must stay free of files/Pi imports (AGENTS.md), so it would be a subpath.
- Q3. Is "registry items hold only presentation" a hard gate, or is "no duplicated or drifted logic" enough? That decides whether PR 8 and the "not worth moving" list are in scope.
- Q4. May the task close while `feedback/*` (point-and-speak recording) is unaudited? It is another surface with its own recorder.
