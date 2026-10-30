# One PM: the regular embedded agent workspace

`AppShell improve={{ agent: 'pm' }}` and `PmChat` compose the same existing `AgentWorkspace layout="embedded"`. Hosts supply tokens, identity, conversations and optional resources; Pi still owns execution. There is no PM-specific reply bubble, grabber or intermediate sheet.

## Sub-features

- `pm-panel-layout`: desktop chat docks beside the pointable app; phone chat fills the screen and gives way to the existing point strip. Closing preserves the borrowed controller's draft and the point session. `registry/pm-panel/pm-panel.tsx`.
- `pm-chat`: the same workspace in a host column; direct `ImproveSpec` accepts `conversations`, `conversationId`, `resources` and `artifactKinds`. Chat-only hosts need no dummy filesystem.
- `pm-member-thread`: regular pi-chat Markdown, native questions, progress and tool presentation, not a second PM thread renderer. Only sent point messages use `pointMessage`.
- `pm-one-line`: lazy authenticated `api/pm/agent`, `useConversations` over `api/pm/conversations`, native remote chat over `api/pm/chat`. Paths resolve against `document.baseURI`, including app/preview prefixes. `use-improve-agent.ts`.
- `pm-library`: read-only `resources` over the existing `api/pm/library` discovery/catalog/read endpoint and its file identity, as in Studio. The actual service lists `documents/`; `api/pm/resources` is a different, POST-only protocol. No new host route.
- `pm-history`: open/continue/new through existing `useConversations` and WorkspaceBar History. New is inside History, not a fourth top-bar icon.
- `pm-tasks-panel`: Tasks, History, Library, in that order. Tasks composes the existing `PmRequests` through WorkspaceBar `panels`, with the ship dot on Tasks. `tasks.header`, `.unread` and `.onOpenChange` let the host compose news and own exact-ID acknowledgement; panel state alone is not a durable receipt.
- `pm-one-line-tasks`: `_tasks/api?mine=1` and the existing host answer/withdraw calls feed requests. Outages are retryable, never an invented empty authoritative list. `pm-task-source.tsx`.
- `pm-request-from-tool`: the existing `tasks_create` result supplies a request card through pi-chat's `replyFooter`; live task-list records win when available.
- `pm-request-sent`: confirmation becomes preparation only after the host acknowledges it.
- `pm-request-withdraw`: requesters can withdraw eligible open requests through the host's existing operation; failure stays actionable.
- `pm-requests-finished`: open/needs-you requests first, finished requests under the collapsed Terminées fold, with outcome chips and no actions.
- `pm-request-list`: short display titles, one localized status, needs-you first, technical rows folded; details on tap.
- `pm-question-composer`: plain text answers the pending original native question; failure preserves the draft rather than queuing a second submission.
- `pm-action-retry`: answers/confirmation/acquisition are bounded; errors preserve input and offer retry.
- `pm-composer`: retain the shared `PmComposer`, `touch`/`desktop` presets, atomic point chips, IME handling and host-owned voice capture.
- `pm-strip`: retain idle/recording/select/navigate strip and Done/Terminer; the recorder owns pause and transcription. `pm-composer.tsx`.
- `pm-pins`: public feedback picker and policy-filtered PNG capture, numbered per-screen pins; meaningful native summary rows are distinct targets, not their shared named section. A failed pick is reported while pointing, not only in hidden review chrome. `use-pm-panel.ts`, `capture.ts`.
- `pm-review`: Done returns to the normal chat composer with editable atomic chips and voice/pick timing metadata. `point-state.ts`, `inline-point-input.tsx`.
- `pm-comment`: desktop clicks open existing `PointComment`; direct send includes that pin/image only, Add to message preserves it in the draft, Escape cancels an empty comment.
- `pm-send`: text/chips, one PNG per pick and `pm.points@1` observations travel through the existing native send-context seam. Cleanup follows native admission, including unknown-result reconciliation.
- `pm-task-mentions`: retain the existing task-mentions picker over host-authorized task records.
- `pm-mockups`: the workspace's existing default artifact kinds/viewers open presented files through `resources`. Standalone `pm-mockups` exports remain for the separately documented shared-room consumer, not a second PM workspace.
- `pm-back`: one shell history entry for the PM, another while pointing: Back returns to chat, then closes without leaving the app. No obsolete full→sheet step.
- `pm-open-signal`: existing `?agent=improve` opens on arrival and is consumed before Back entries. A same-origin parent may send `{ boring: 'pm-open' }`; other origins/sources are refused. No conversation selection, microphone or execution grant.

## How to get to it (user POV)

Account menu → Améliorer l'app. Use Tasks, History or Library. Type normally, or Montrer → touch/click a page element → speak or comment → Done → review/send. Desktop leaves the app alongside chat; phone shows the strip while pointing. A host column renders `PmChat` over the same conversation/resource contracts.

## Driving it with the browser and contract tests

Use `CHROMIUM=<binary>`; serialize heavy runs with the task's `flock`.

- `pm-panel-layout`, `pm-chat`, `pm-member-thread`, `pm-one-line`, `pm-library`, `pm-history`, `pm-tasks-panel`, `pm-back`, `pm-open-signal`: `node examples/pm-panel/journey.mjs`. The public one-line fixture exercises real native transport, creates/reopens conversations, opens each panel, and captures 1440/390 light/dark screenshots in two token themes. It rejects cross-origin/non-parent messages and checks local Back geometry.
- `pm-pins`, `pm-comment`, `pm-send`: `node examples/pm-panel/journey-annotate.mjs` and `PM_CASE=rows node examples/pm-panel/journey-annotate.mjs`. Both run through the actual AppShell picker/composer/native admission at desktop and phone widths; rich-card and native-summary fixtures are fail-first regressions.
- `pm-one-line-tasks`, `pm-request-from-tool`, `pm-request-sent`, `pm-request-withdraw`, `pm-requests-finished`, `pm-request-list`, `pm-action-retry`: `node --test test/contracts/pm-task-source.test.mjs test/contracts/pm-request-card.test.mjs test/contracts/pm-requests-finished.test.mjs` drives the public Tasks panel and original host adapter, including list outages, native tool-result fallback and failed confirmation.
- `pm-question-composer`: `node --test test/contracts/pm-panel-thread.test.mjs` drives both public workspace placements, standard Markdown and pending native-question retry without duplicate submission.
- `pm-composer`, `pm-strip`, `pm-review`, `pm-task-mentions`: `node --test test/contracts/pm-composer.test.mjs test/contracts/pm-point-state.test.mjs`, plus `node examples/pm-panel/journey-faults.mjs` for IME, transcription/admission races and controller replacement.
- `pm-mockups`: `node --test test/contracts/shared-room-mockups.test.mjs` qualifies the retained standalone compatibility exports. Workspace artifact/library behavior is driven by the existing pi-app journeys.

## Gotchas

The example server is fictional/local and uses scripted models. It is not Factory release/adoption proof or real-phone hardware qualification. The real PM service's Library is read-only and documents-only; no live change feed is promised. Direct chat-only hosts intentionally have no Library until they supply real resources. Host news acknowledgement, task-store authority, voice policy and application deployment remain outside the kit. Closing a viewer never cancels admitted agent work.
