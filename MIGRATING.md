# Unreleased

- **`pi-app` is the batteries item; the core chat stays small (D-257).** No code change: `pi-app` (and `AgentWorkspace`) installs every optional chat item and viewer and passes them through `withChatPlugins`, so re-running `boring-ui-blocks add <registry>/pi-app.json` keeps every feature. `boring-ui-blocks update` reinstalls only the items an app has, so an app that installed `pi-chat` or `viewers` directly adds the new items it uses once; [registry/README.md](registry/README.md#from-one-item-to-small-items-d-257) maps each old file to its item, and the new `boring-ui-blocks help` lists them. `npm run check` now also refuses a `pi-chat` that declares an npm package outside its core set or grows past its file and line budget.
- **Viewers by kind, lazily (D-257).** `viewers` is split into `viewer-frame` (`ViewerFrame`, the menu, words, share, download, `viewers.css`) and one item per viewer: `viewer-markdown`, `viewer-html`, `viewer-image`, `viewer-pdf` (with `LocalFileViewer`) and `viewer-code` (SVG and CSV). Each ships a cheap kind module and a view that `pi-app` loads only when its artifact or file first opens (`React.lazy`, a spinner in the viewer bar meanwhile), so a page that never opens a PDF never downloads pdf.js. `pi-app` installs all six, so its pages are unchanged; the `viewers` item remains, deprecated and empty, and installs the six. Import paths move: `components/viewers/<file>` is now `components/viewer-frame/<file>` for the frame files, and `markdown-pane`, `html-pane`, `image-pane`, `pdf-pane`, `pdf-pages` and `local-file-viewer` move to their item's folder.
  - `ArtifactKind` gains `load?: () => import('./my-view')` (a module whose `default` is the view, given the same props as `renderer`), `label?` and `fallback?`. A host kind in `artifactKinds` may use `load` instead of `renderer`; `renderer` still works. A lazily loaded view is acknowledged to a waiting `present` once it has mounted, unchanged in meaning (D-256).
  - The domain kinds move out of their views: `createMaquetteKind`/`maquetteKind` from `maquette-viewer/maquette-kind`, `createDiagramKind`/`diagramKind` from `diagram-viewer/diagram-kind`, `createMockupKind`/`mockupKind` from `mockup-viewer/mockup-kind`, `createRecordsKind`/`recordsKind` from `record-viewer/records-kind`, `createLooksKind` from `looks-viewer/looks-kind` and `createBoardKind` from `board-viewer/board-kind`; their views are loaded lazily. `MaquetteViewer` takes an optional `publishMenu` (the panel's menu slot).
  - `ViewerOptions.kinds` is now the whole list the panel and the file viewer resolve through (default `viewerKinds` from `pi-app/viewer-kinds`); a host passing its own list spreads `viewerKinds` after its kinds. `withBuiltInKinds`, `resolveKind` and `csvRows` are removed from `artifact-panel`.
  - `viewers` on `AgentWorkspace` (`CustomViewers`) still works and is deprecated: prefer an artifact kind with `load`.

# Migrating to 0.4.12

- **Shared chat looks like WhatsApp.** Reinstall `shared-chat` with `pi-chat`, `pi-chat-voice` and `pi-chat-plugins` (it now depends on `separator`). No data change is required; what changes on screen: bubbles get a tail on the first of each group and tighter spacing; names and avatars show only in rooms of more than two, avatars only beside the last bubble of a group, agents as a sparkle glyph with no status dot (the state stays in the member list); the role line is gone (tap the name to see it); the time is inside each bubble (`sharedClock`) and each day starts with a pill (`sharedDay`) instead of the 15-minute timestamp rows; request cards are compact bubbles with text buttons (« Try · Later ») and no « since » line; the « jump to latest » row appears only when scrolled up and says « 3 new messages »; the list hugs the bottom. New optional data: `ChannelMessage.kind: 'system'` (a small centred notice, consecutive ones collapsed) and `Card.kind: 'pin'` (a pinned comment as a quoted bubble); the channel socket keeps both and reads an unknown kind as absent. Tests that looked for `[data-testid=time-separator]` now look for `day-separator`; `message-role` is the tap Popover, `request-card` sits in a `card-bubble`.
- **Composer slots.** `PiChat` takes `composerStart` (an app control at the left edge of the composer bar, before "+") and `voiceReplacesSend` (with `voiceMessage`, the microphone takes Send's place while there is nothing to send). `SharedChat` and `useSharedChatProps` default to `composerLayout="pill"` and `voiceReplacesSend`; pass your own values to keep the card composer. `VoiceMessageButtonProps` gains `primary`. `MessageText` takes optional `decoration`, `header` and `footer`.
- **Restored 0.4.10 shared chat on main.** The D-257 merge (#1821) had put back the pre-0.4.10 shared-chat files; this release carries the 0.4.10 behaviour (own primary bubbles, `roleLabel`, `actions`, `cardActions`) again. 0.4.11 consumers are unaffected.
- **Composer features are their own items (D-257).** `pi-chat` no longer ships Markdown, the slash and mention menus, the model/effort pickers, voice messages or the camera sheet, and no longer installs `marked`, `entities` or the kit's `voice-capture`. Without an item the feature is not offered (plain text, no menu, picker, microphone or camera); nothing crashes. `pi-app`, `pi-ambient`, `app-shell` and `shared-chat` install them all through `pi-chat-plugins`, so their pages are unchanged. A bare `PiChat` page adds the ones it uses:
  - Markdown: `npx boring-ui-blocks add <registry>/pi-chat-markdown.json`, then `renderText={markdownText}` (`RunCard` takes the same prop).
  - Slash commands: `npx boring-ui-blocks add <registry>/pi-chat-slash.json`, then `slash={{ ..., Picker: SlashPicker }}`.
  - @mentions: `npx boring-ui-blocks add <registry>/pi-chat-mentions.json`, then `mentions={{ ..., Picker: MentionPicker }}`.
  - Model and effort pickers: `npx boring-ui-blocks add <registry>/pi-chat-pickers.json`, then `model={{ ..., Picker: ModelEffortPicker }}`.
  - Voice messages: `npx boring-ui-blocks add <registry>/pi-chat-voice.json`, then `voiceMessage={{ transcribe, ...voiceMessagePlugin }}`.
  - Camera: `npx boring-ui-blocks add <registry>/pi-chat-attachments.json`, then `attachments={{ upload, Camera: CameraSheet }}`.
  - All of them: `npx boring-ui-blocks add <registry>/pi-chat-plugins.json`, then `<PiChat {...withChatPlugins(props)} />`. `Markdown` is now exported from `pi-chat-markdown`, the voice hooks from `pi-chat-voice`; `feedback` installs `pi-chat-voice` for `use-hold-to-record`.
- **Reply cards are their own items (D-257).** `pi-chat` no longer ships the question card, the approval card, the sub-agent and run cards or the artifact card and `artifact.ts`. Without an item a question or an approval shows a « Waiting for your answer » notice (`data-testid="answer-waiting"`, `role="status"`) with no answer UI, a sub-agent call is an ordinary tool step and no artifact card is offered (the `artifacts` prop alone no longer draws cards). `pi-app`, `pi-ambient`, `app-shell`, `shared-chat`, `documents` and every page that uses `withChatPlugins` get them all, unchanged. Import paths move: `components/pi-chat/artifact` is now `components/pi-artifacts/artifact` (kinds, `ArtifactDescriptor`, `artifactKey`, `typeLabel`…), and `QuestionCard`, `ApprovalCard`, `RunCard`/`parseRun`, `SubagentCard`/`DELEGATE_DETAILS_KIND` are no longer exported from `pi-chat`.
  - Questions: `npx boring-ui-blocks add <registry>/pi-chat-question.json`, then `cards={{ question: QuestionCard }}`.
  - Approvals: `npx boring-ui-blocks add <registry>/pi-chat-approval.json`, then `cards={{ approval: ApprovalCard }}`.
  - Sub-agents: `npx boring-ui-blocks add <registry>/pi-chat-subagent.json`, then `cards={{ subagent: subagentCard }}` (`RunCard` lives here too).
  - Artifacts: `npx boring-ui-blocks add <registry>/pi-artifacts.json`, then `artifacts={{ ...artifactCards, open, isOpen, kinds }}`.
  - All of them: `pi-chat-plugins` now installs the four; `withChatPlugins(props)` fills `cards` and the artifact card (a host's own `cards` entries win).

# Migrating to 0.4.11

- **Pick a look / pick a layout.** New opt-in `looks-viewer` block: `createLooksKind({ onPick, locale })` draws `*.looks.json` (looks@1: one `*.mockup.html` key screen in 2 to 6 shadcn themes, then layout variants in the chosen look) with `parseLooks` and `parseShadcnTheme` (shadcn theme variables only). `MockupViewer` gains optional `themeOverride` (shadcn `cssVars`: `{ theme, light, dark }`), `mode` and `title`; without them it renders as before. Update `mockup-viewer` with `looks-viewer`; pass the kind in `artifactKinds`. No stored-format change for existing files.

# Migrating to 0.4.10

- **Present acknowledgement for views that load (D-256).** An `ArtifactKind` may set `waitsForReady: true`: the panel then confirms a `present` of its file only after the renderer calls `onReady`, and refuses it with the reason when the renderer calls the new `onFailed(reason)` or throws (a throw now shows a short note instead of breaking the panel). Use it for a dashboard or any view that loads its data; kinds without it are confirmed when their file is read, as before. `createPresentAcks` gains `failed({ path, reason })` and `ViewerOptions` gains `onFailed`. Update the `pi-chat`, `pi-app` and `mockup-viewer` blocks together (the mock-up kind now declares `waitsForReady` instead of the panel special-casing its path). No agent API or stored-format change.
- **Shared chat — own bubbles, role lines, several card actions.** My own messages now use the theme's `primary` bubble with `primary-foreground` text instead of the grey one. Each author line adds the member's role (`Léa · member`, `Reminder agent · the app’s agent`) from `Member.role`, or the new optional `Member.roleLabel`; override the words with the `sharedRole` label. `Card.actions` (`{ id, label, variant?: 'primary' | 'secondary' }[]`) offers several choices, the first primary by default; the single `Card.action` still works, and `controller.action(card, actionId?)` sends the chosen id (new `cardActions(card)` helper). Request cards are outline Items, so their border follows `--border` and `--border-width`; the block no longer needs the shadcn `card`. Additive for hosts; re-run `boring-ui-blocks add shared-chat` (updates `pi-chat`'s `MessageText`, which gains an optional `variant`).
- **Chat plug points (D-257).** `PiChat` and `AmbientChat` take `renderText`, `cards` (`question`, `approval`) and `toolRenderers` (keyed by tool name, before the `renderTool` catch-all), and the `slash`, `mentions`, `model`, `effort`, `voiceMessage` and `attachments` configs may carry their own component (`Picker`, `Button`/`Bubble`, `Camera`). Additive: without them the built-in components render as before, so no migration is needed. Re-run `boring-ui-blocks add pi-chat` (updates `pi-ambient` too) to get the props.
- **One resource contract (D-258).** `createRevisionHandler` now serves a plain `createResourceClient` (read, conditional publish, lookup, rename, delete) without the `x-boring-workspace` binding header, through `createResourceHandler`; before, those calls got `403` (a page's viewers saved as `unknown` until the revision binding connected). A binding that is sent is still checked (`409`), and the listing and change feed still require it. Routes on `createResourceHandler` are unchanged. No API, block or stored-format change.
- **Delegate — child identity (D-254).** `createDelegateTool` (and `defineAgent` `delegates` entries) take `onChild(parent, child, tx)`, run inside the native commit that creates the child conversation: write the parent's user, workspace binding and permissions onto the child there. A throw aborts that commit, so no child exists. Optional; without it nothing changes.
- **Delegate — sub-agent card data (D-255).** A delegate call's `details` is now the exported `DelegateDetails` (`kind: 'boring.delegate'`, `version: 1`, `agent`, `conversationId`, `status`, `startedAt`, `durationMs`, `toolCalls`, `tokens`, `error?`), published live while the child runs; `details.conversationId` is unchanged. Update the `pi-chat` block: a delegate call now shows a `SubagentCard` (status, time, tool calls, tokens, child conversation id) instead of a plain tool step.
- **Add an extension to an existing conversation (D-253).** New `addExtension(conversation, extension, context)` in `@hachej/boring-agent/agents` appends one extension to a conversation's stored selection, so its next turn runs with it, without recreating it. The name is durable; the host installs the extension in the Harness registry at every open. Additive: no API or stored-format change.

# Migrating to 0.4.9

- **Hardening (D-248).** `githubSink` refuses `.`/`..` repository segments and an `apiUrl` that is not https (http only for localhost) before sending the token; reinstall `provider-setup` (non-http(s) `verificationUri` is plain text), `shared-chat` (`avatarUrl` loads only https, `data:image/`, `blob:` or same-origin paths) and `viewers` (`PdfPane` shows a `blob` only when typed `application/pdf`). `mockup-viewer` messages keep targetOrigin `'*'` (opaque-origin sandbox).
- **AWS Code Interpreter watch is confined (D-248).** `createCodeInterpreterEnv(...).watch` now refuses a path that escapes the user's folder through a symlink with `permission_denied`, like every other file method. No API or stored-format change.
- **Agent and execution hardening (D-248).** `createApprovalExtension` takes `unlisted: 'deny'` (with `allow`) to block tools no rule names (default unchanged); delegated children now inherit the parent's approval and sandbox extensions; `createConversationSocketHandler` refuses a cross-origin upgrade unless `allowedOrigins` lists it; the chat transport checks `allow('submit')` before `prepareInput` and answers unexpected errors with a fixed `source-unavailable` instead of the message; remote shell requests setting `LD_*`, `DYLD_*`, `BASH_ENV`, `ENV`, `NODE_OPTIONS`, `PYTHONSTARTUP`, `PERL5OPT` or `GIT_SSH*`/`GIT_ASKPASS`/`GIT_EXTERNAL_DIFF`/`GIT_PROXY_COMMAND` in `env` get 403 unless `allowLoaderEnv: true`; the Code Interpreter env's `openDirReader` reports workspace paths; mention and request-context wrappers neutralise every tag spelling in their text.
- **App shell — agent trigger (D-239).** The header's agent trigger now shows `AgentSpec.icon` and is named by `AgentSpec.label` when the agent sets them; without them it keeps the sparkles and « Open the assistant ». Update the `app-shell` block.
- **Invariants drift (D-249).** Docs only: the registry README now says every design group fails both static and browser checks, and packages never open a Harness (the host opens and closes it). No API, block or stored-format change.

# Migrating to 0.4.8

- **Viewers — Quiet Markdown editor (D-227, #1795).** The formatting bar appears on selection and a header Formatting toggle pins it; pass `formattingToolbar="pinned"` for the old always-visible bar.
- **Viewers — Fewer Markdown fallbacks (D-233):** front matter, HTML, footnotes, reference links, CRLF and alternate list/emphasis/heading spellings now open Formatted; untouched blocks keep their exact bytes; mixed line endings, bare CR and NUL still open as source.
- **Placed agent workspace (D-103).** New opt-in `placed-agent` registry block provides `PlacedAgentWorkspace`, `placement="tab+ambient"`, controlled `collapsed`/`onCollapsedChange`, and `usePlacedAgentState`. Install it with the matching kit and its `pi-app`, `pi-ambient` and `app-shell` dependencies. It reuses the conversation/controller: desktop collapse floats the chat; phones in an available app-shell layer use one 8rem peek above the tab bar, while phones outside a shell stay a page. Existing `AgentWorkspace` behavior and stored document formats are unchanged.
- **Faster release preparation (D-234).** Release tooling reuses exact-main green CI, prepares audited archives without another full suite, and waits for npm visibility once for all packages. Package-changing PRs now add their migration note here; `release:version` promotes these notes and refuses an empty section. Browser journeys get one logged retry; unit tests do not. No application API or stored-format migration.

# Migrating to 0.4.7

Upgrade the registry blocks with `npx boring-ui-blocks update --version 0.4.7` (`npx boring-ui-blocks check` first lists your edited copies), and bump the npm pins to `0.4.7`.
Stored formats remain compatible. Reinstall `feedback`, `app-shell`, `pi-app`, `pi-workspace`, `viewers` and `pi-chat` together: the feedback pin now uses `pi-chat`'s `use-hold-to-record`, and `feedback` gains `switch` as a registry dependency.

## Feedback

- **Comment mode (breaking, #1789).** `PointBar` is renamed `CommentBanner` and is shown on wide screens too (at the top, while hover targeting). Annuler and « Utiliser l'app » become an on/off « Commenter » switch (`feedback-comment-switch`); `feedback-point-cancel` and `feedback-point-use-app` are gone, and the count (`feedback-point-count`) is of notes that say something, absent at 0. The pin's Alt hint (`feedback-bubble-hint`) is gone, its label names the element in plain words (`plainElement`), and its mic is held to record: on release the transcript is appended and the note saved. Labels `altHint`, `pointHint`, `pointCancel`, `pointUseApp`, `pointUsing` and `pointBar` are removed; `commentMode`, `commentSwitch`, `commentTap`, `commentClick`, `commentPaused`, `commentSent` and `element` are added. New hooks: `useCommenting(session)` and `useSendEachNote(session, send)`. Journeys that tapped Annuler should tap `feedback-point-done` (with no note it ends comment mode with nothing).
- The annotate toggle and pin controls keep 44px targets on desktop too.

## Chat

- **Sent page comments as cards (D-207, #1788).** A user message carrying a page-comments report renders a compact localized Card instead of the raw report. No migration step.
- **Inline images and full-screen viewer (D-214, #1791).** Messages show image thumbnails, and `AgentWorkspace` replaces its ImagePane dialog with `ImageViewer` (pinch, double-tap, swipe to dismiss, 48px controls). `onOpenImage(image, gallery?)` gains the optional message gallery. Reinstall `pi-chat` and `pi-app` together.

## Layout

- **Host panels and opening width in `AgentWorkspace` (#1789).** `barPanels` (`WorkspaceBarPanel { id, label, icon, content(close) }`) adds the host's own panels to the bar after Library; `panelWidth` sets the side panel's opening width (a fraction of the workspace when at most 1, else pixels; `ArtifactWorkspace`'s `defaultWidth` accepts the same). Both optional.
- **`ViewerFrame` `mainControl` (#1789).** A control that stays in the header at every width (`<testId>-main`) while `controls` fold into « … » on a phone. Optional.

## Agent

- **SheetJS is host-installed (D-225, #1792).** `xlsx` is now an optional peer of `@hachej/boring-agent`; hosts that read spreadsheets run `npm i https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`. Without it `read_spreadsheet` returns a refusal; PDF reading is unchanged.
- **OptChat compactor cache (D-210, #1794).** Model summary requests reuse the last turn view as their prefix (compactor cache ≥95% in fictional replays, not live-provider qualification); `stats().compactor.requests` lists usage for the last 256 responses. Forgetting a message clears all summaries once shared-prefix summaries exist. No migration step; downgrading needs a deliberate summary invalidation.

## Files

- **Conditional rename and delete (D-226, #1793).** Workspace publication now accepts conditional delete changes. Publishing remote/revision clients additionally expose rename/delete with locator-valued paths, expectedRevision and operationId; generic handlers opt in with renamer/deleter, while revision handlers use their workspace provider's capabilities. Handle additive rename/delete history sources and rename capability metadata; reconcile uncertain operations by their original ID. No tree controls or recursive folder operations are included.

# Migrating to 0.4.6

Upgrade the registry blocks with `npx boring-ui-blocks update --version 0.4.6` (`npx boring-ui-blocks check` first lists your edited copies), and bump the npm pins to `0.4.6`.
Existing APIs and stored formats remain compatible. No block gains an install dependency; the chat changes arrive when you reinstall `pi-chat` and `app-shell` together.

## Chat

- **Conversation files open (D-176, D-192, #1786).** Every row in a conversation's Files menu now opens: workspace paths in the file viewer, native images in a preview. `AgentWorkspace` supplies an image preview by default; `chat.onOpenImage`, `chat.onOpenFile` and `chat.mentions.open` still override it. Rows with no opener are hidden instead of shown disabled. An upload returning both `image` and `path` is still sent as the native image only, so it appears once in the message and once in the menu. On desktop the menu is the shadcn `DropdownMenu` (arrow keys, Enter, Escape); phones keep the Drawer with 48px rows. Journeys that clicked a disabled row or waited for the old popover should use the existing `conversation-files`, `conversation-files-list` and `conversation-file` test IDs.
- **Calmer artifact card (D-180, #1784).** The chat artifact card has a tinted icon, a muted type and version line and a single chevron instead of an “Open” label. Built-in type names follow the chat's labels (English and French); host kind labels still win. Accessible names and `aria-pressed` are unchanged; update journeys that matched the visible “Open”/“Ouvrir” text.
- **Stable OptChat prefix (D-160, #1781).** OptChat folds in batches at durable checkpoints, so consecutive requests share their prompt prefix and keep the provider cache warm. New optional `foldHighWater` / `foldLowWater` (defaults 1.25 / 0.75); equal values keep the former strict fitting. Fold state is stored in the native `boring.memory.optchat.fold` conversation document. No migration step.

## Viewers

- **Read-only ArtifactViewer (D-194, #1785).** New entry `@hachej/boring-ui-kit/artifact-viewer` exports `ArtifactViewer({ name, mimeType, content?, url?, className?, renderPdf? })` for Markdown, HTML, PDF, images and text, without ResourceClient, tiptap or the agent. Markdown and HTML are sanitized with the same passive-HTML allowlist as the HTML preview and shown in a sandboxed iframe. Existing viewers are unchanged.

# Migrating to 0.4.5

Upgrade the registry blocks with `npx boring-ui-blocks update --version 0.4.5` (`npx boring-ui-blocks check` first lists your edited copies), and bump the npm pins to `0.4.5`.
Existing APIs and stored formats remain compatible. Floating windows and retained voice messages are opt-in; the chat queue's quieter presentation arrives when you reinstall the blocks.

## Consumer dependencies

Re-add the installed items to install their new files and dependencies. If you copied blocks by hand, install these yourself:

- The optional `windows` block needs `utils`, shadcn `button`, `card`, `badge`, `drawer` and `dropdown-menu`, React/React DOM and `lucide-react@^1.51.0`. It installs no theme; add `theme.json` only if the host has no shadcn tokens.
- Reinstall `pi-chat` and `app-shell` together for retained voice messages, and `shared-chat` if installed. Use the matching kit for the new `/voice-capture` entry. No transcription service or audio storage is installed: the host supplies both. Reinstall `utils` with `app-shell` for the extracted shared `useDraggable` hook.

## Chat and floating windows

- **Floating utilities (D-79, #1780).** Install `windows` and wrap host-owned utilities in `WindowLayer`, with `FloatingWindow({ id, title, children, defaultOpen?, defaultRect? })` and `WindowLauncher windows={[{ id, title }]}`. `useWindow(id)` exposes open, close and minimize after registration. Desktop windows drag, resize and stack; below 641px the front window uses a full-screen Drawer. `storageKey` and `persist="session" | "local"` on the layer remember rectangles and open/minimized/closed state, not content or task state. The default is session storage. Keep durable content and drafts in host controllers, especially across phone/desktop changes. Existing app-shell dock/float behavior is unchanged. See [Floating windows](registry/README.md#floating-windows-windows).
- **Retained voice messages (D-111, #1776).** `PiChat` (also through `AmbientChat`) adds `voiceMessage={{ transcribe, maxMs?, upload? }}`. Hold to record; release uploads audio and transcribes in parallel, then sends one native text entry containing the `@uploads/voice-…` path and transcript, without sending or clearing the existing composer draft. Supply `transcribe(blob, signal)` and `attachments.upload`, or override with `voiceMessage.upload`; upload exactly one file, preserve its `voice-` filename prefix and recorded audio MIME, and return an `uploads/voice-…` path. Capture defaults to five minutes; reaching the cap does not send before release. Failed/empty transcription sends nothing automatically; local rows offer retry, explicit audio-only send or discard. Discard does not delete an uploaded file, and uncertain native admission uses reconciliation rather than a new send. In the app shell, opt in with `AgentSpec.voice.send: 'message'`; existing `auto` and default `draft` remain text-only. See [Voice messages](registry/README.md#voice-messages-in-pi-chat).
- **Voice playback and custom hosts.** Reserved voice uploads render audio bubbles; other audio remains a file card. Provide stored audio MIME and base64 bytes through `mentions.preview`, or an authorized HTTP(S) URL through the new `mentions.audioUrl(path, signal)`, fetched only on Play. Permit Blob URLs or the signed-URL origin in the host's media CSP. A custom `timeline.render(context)` enabling voice must place `context.pendingVoice` in its transcript; the copied shared-chat timeline already does. Compatible custom controllers must preserve the native immutable draft/request identities used for admission and reconciliation. New `@hachej/boring-ui-kit/voice-capture` exports `createVoiceCapture` independently of React, files and Pi; the existing feedback capture API re-exports it unchanged. Physical-phone capture/playback still need consumer qualification.
- **Quieter queue (D-174, #1782).** `PiChat` and `AmbientChat` use a compact queue strip with single-line previews, icon-only Steer and remove actions, and Edit under “…”; steering uses an icon and screen-reader status instead of a visible badge. The composer's Queue action is also icon-only, retaining its accessible name and title. Desktop Enter still queues, and withdrawal/steering/edit semantics are unchanged. No new prop or install dependency. Update journeys that locate actions by visible text to use accessible names or the existing test IDs. See [Queue controls](registry/README.md#panel-pi-workspace-history-and-queue-pi-chat).

## Agent skills and CI

- **Skill companion files (D-146, #1779).** Self-evolving agents now discover both flat `.agent/skills/<name>.md` and immediate `.agent/skills/<name>/SKILL.md` definitions. Only the folder's `SKILL.md` defines a skill; other Markdown and deeper files are companions. `load_skill` appends the source folder so relative references can be read on demand with Pi's native `read`, through the same workspace provider. Scanning/loading does not read companions or grant additional access. Existing flat skills still work; host-given `{ name, description, body }` skills have no source folder and return their bodies unchanged. No new host setting or tool. See [Self-evolution](packages/agent/README.md#self-evolution).
- **Faster CI (D-153, #1778).** Verification, registered evidence, isolated consumers and scripted journeys are split across CI jobs instead of repeated serially. The normal `npm test` still runs the full suite; proof deferrals remain unchanged. CI/test tooling only: no application install or migration step.

# Migrating to 0.4.4

Upgrade the registry blocks with `npx boring-ui-blocks update --version 0.4.4` (`npx boring-ui-blocks check` first lists your edited copies), and bump the npm pins to `0.4.4`.
Most additions are opt-in; shared-chat consumers must apply the import and channel RPC changes below. App-shell launch links are enabled by default, and OptChat's concurrency and retry defaults change.

## Consumer dependencies

Re-add the installed items to install their new dependencies. If you copied blocks by hand, install these yourself:

- `pi-chat` now needs shadcn `tooltip` and `zod@^4.6.5`.
- `pi-app` now installs `record-viewer`, which needs the theme item, shadcn `table`, `badge`, `item`, `button`, `alert` and `empty`, React and `lucide-react@^1.51.0`.
- The optional `agent-target` block installs `app-shell` and `pi-chat`, shadcn `button`, `card`, `message` and `bubble`, matching kit/feedback packages, React/React DOM and Pi Durable `~1.2.0`. Use the 0.4.4 kit with the copied block: it needs the new `NativeChatController.submissionStatus` capability. It installs no theme; hosts without shadcn tokens must add `theme.json`.
- The optional `highlights` block installs `markdown-editor`, shadcn `button`, `textarea`, `label`, `item` and `dropdown-menu`, matching kit/files packages and React/React DOM.
- The optional `requests-board` block needs `utils`, shadcn `badge`, `button`, `input`, `toggle-group`, `item`, `empty`, `textarea` and `card`, and React. Add `theme.json` only if the host has no shadcn tokens.
- `@hachej/boring-agent/documents` uses the agent package's new regular dependencies, pinned `unpdf@1.9.1` and the official SheetJS `xlsx@0.20.3` HTTPS tarball (not npm's old `xlsx@0.18.5`). They load lazily in the selected reader; no OCR provider or credentials are installed. License notices ship with the agent package.

## Chat and app shell

- **Photo (D-59).** On touch devices, the `pi-chat` attachment menu offers Take a photo when attachments and image types are allowed. The in-page camera sends a JPEG scaled to at most 1600px through the existing picked-file path; permission refusal, unavailable devices or an insecure page offer the phone's file-input camera instead. Reinstall `pi-chat` and `app-shell` so the new camera overlay and layer handling arrive together. No new prop or automatic camera access.
- **Natural presentation (D-60).** `pi-chat` and `pi-ambient` add the opt-in `presentation="natural"` prop and the labels `preparing` and `sendUnavailable` (EN and FR). Without the prop, defaults are unchanged. Natural presentation hides technical trace rows and raw error details, not required questions, approvals or artifacts; it changes no stored history. See [Natural presentation](registry/README.md#natural-presentation-in-pi-chat).
- **Staged chat (D-72).** `PiChat` and `AmbientChat` add `hideLine`, `displayLimit`, `historicalMessageActions`, `unread` and `replyError`; `renderEntry` cards may return `{ inline: true, content, status }` for inline stage cards and the existing single natural status. `hideLine` filters assistant display/copy/actions, not transport or storage, and delays incomplete live lines until newline or settlement. `displayLimit` is a positive initial display-row limit (default 60); an explicit limit uses Show earlier, not automatic intersection paging. Historical actions remain off by default and must be reauthorized by the host; unread state is also host-owned. `ReplyRef.durationMs` now sums the merged reply's model rounds, not just its last round; it is not end-to-end latency. `createNativeChatController({ restoreOnError: true })` optionally restores an unanswered question before later typing only after an observed native model/run error with no answer text; it never resubmits or treats disconnection/cancellation as proof of failure. See the [staged-chat recipe](examples/staged-chat/README.md) for the exact seams and evidence requirements.
- **Phone dictation (D-107).** The app-shell push-to-talk button no longer moves composer focus or raises the keyboard under the finger. The sheet holds its viewport/inset while recording; a browser pointer cancellation keeps audio like a release, while sliding off still cancels. Reinstall `app-shell`; voice options and the host transcription callback are unchanged. Physical-phone keyboard qualification remains consumer work.
- **Point and dictate (D-108).** Install `agent-target` and mount `AgentTargetMode` inside the existing agent layer provider. Mark approved JSON with `data-agent-target`; the nearest marked ancestor is captured, capped at 1,024 UTF-8 bytes, before recording. Supply `enabled`, `transcribe` and `onSettled({ target, reply, ok })`; the callback is where the host can refetch data. Context is sent as a visible `<target>` block with the spoken words, not hidden context; an answered submission is not proof of a domain mutation. `useAgentLayer().agent` exposes the existing app controller, and `app-shell` exports `useDictation` for the shared start/finish/cancel lifecycle. Closing the bar does not abort admitted native work. See the [marking guide](docs/guides/agent-target.md).
- **Agent launch links (D-109).** `/?agent=coach&open=full&input=text` opens the existing assistant; `agent` is another assistant alias and `improve` selects the product manager. The shell consumes `agent`, `open` and `input` once on mount without losing other URL/history state. Voice opens full but never records automatically. This is enabled by default; pass `AppShell agentLink={false}` to disable both opening and URL cleanup. `agentLink` and `parseAgentLink` are exported from `app-shell/index.ts`; manifests and real home-screen launch testing remain host-owned.
- **Hover rail (D-75).** `AppShell rail="hover"` reveals wide-screen sidebar labels on pointer hover or keyboard focus without resizing the page. Leave, focus leaving or Escape collapses it; touch and phone tabs are unchanged. Default `rail="icon"` preserves the previous sidebar behavior.

## Viewers and document marks

- **Browser-only files (D-74).** The `viewers` item exports `LocalFileViewer({ name, blob, onClose?, ... })` for a browser File/Blob, without a resource locator, upload or agent. It previews images, PDFs and literal UTF-8 text; HTML never runs and unsupported bytes retain Download. Files live only in memory and are lost on reload. Use a host `panels` entry, not a fabricated saved artifact descriptor. See [Open a browser-only file](registry/README.md#open-a-browser-only-file).
- **Typed records (D-77).** `AgentWorkspace` opens `*.records.json` (`records@1`) by default; app `artifactKinds` still win. The new `record-viewer` exports `RecordTable`, `RecordList`, `RecordsViewer` and `createRecordsKind({ locale, onAction })`, with grouping, typed values, host status badges and responsive phone lists. Invalid files show exact raw text with a note. Action metadata never executes by itself; absent host callbacks disable buttons. See [Typed records](registry/README.md#typed-records-record-viewer).
- **Anchored highlights (D-78).** Install `highlights` for `<Highlights controller={controller} resource={{ client, identity }} locator={locator} />`, or supply a borrowed `store`/display-only `marks`. The default store uses the document's same workspace client and conditionally writes `<doc>.marks.json` only after a mutation, not on open. Stale writes conflict; missing/ambiguous quotes stay unplaced rather than being guessed. New kit subpaths `/markdown-quote` and `/mark-store` expose pure anchors and the sidecar store. `MarkdownEditor` adds `highlights`, `onQuoteSelection` and `onHighlightActivate`; decorations never dirty Markdown. See [Document marks](packages/ui/README.md#document-marks).
- **Requests board (D-141).** Install `requests-board` for `RequestsBoard` with host-fed `views`, compact/full `mode`, `locale`/`labels` and intent callbacks `onOpenAll`, `onOpen`, `onAnswer`, `onDecide` and `onTry`. Bump `changeToken` with fresh views for move announcements. Missing callbacks disable their controls; `canApproveRelease` only controls presentation, never authorizes a release. No Pi controller, polling, endpoint wiring or optimistic settlement is added. See [Requests board](registry/README.md#requests-board-requests-board).

## Agent memory and document readers

- **OptChat (D-131).** The existing opt-in `/memory/optchat` extension aligns with the pinned uniichat algorithm. New options: `compactBytes` (32,000-byte independent compactor view), `notes` (seeded once per conversation) and `workOf(message)` (host-classified work reports). Default `jobs` rises from 8 to 64; set it explicitly to retain the previous concurrency cap. Failed summaries retry with exponential backoff from `retryMs` to 60 seconds, and `nap` now waits through retries; `dispose()` stops local waits, not Pi tasks. New `forgetMessage(conversationId, messageIndex)` tombstones the zero-based current model-context message and invalidates dependent summaries; it does not erase the native transcript, provider logs or backups. It is not the existing cache-only `forget(id)`. Hosts authorize forgetting and include `stats().compactor.usage` in budgets; no provider cache-hit guarantee is added. See [OptChat memory](packages/agent/README.md#optchat-memory).
- **Document readers (D-138).** Import `documentTools({ readBytes, ocr?, images? })`, `sniff` and `readStored` from `@hachej/boring-agent/documents`. Install the returned native `read_pdf` and `read_spreadsheet` tools explicitly; Pi's `read` and the existing `file-convert` alternative are unchanged. Bind `readBytes` to the authorized workspace/view and supply optional OCR as `ocr(bytes, pageNumbers)`. Extraction is bounded and untrusted; input size, parser resources, stable revisions and replayed OCR cost remain host policy. See [Shared document readers](packages/agent/README.md#shared-document-readers).

## Shared conversations

- Shared UI is now the optional `shared-chat` registry item, depending on `pi-chat` but not `pi-app`. Regular `pi-chat` installs no shared files or imports. Move `useSharedChat` imports from `pi-chat`/`pi-app` to `components/shared-chat/shared-chat`; pass `shared.workspaceProps` to AgentWorkspace or `shared.chatProps` to PiChat. Merge additional chat options into those props. Reinstall the items and remove obsolete `pi-chat/shared.tsx` and `pi-chat/use-shared-chat.ts` copies. See [Regular chat or shared chat](registry/README.md#regular-chat-or-shared-chat).
- Channel data stays exclusively at the existing `@hachej/boring-ui-kit/shared-chat` entry, now implemented in its own folder. The package root was already lean. Neutral `ChatController`/`ChatSnapshot` types now live at `/native-chat`, with compatibility type re-exports from `/shared-chat`; concrete native controller APIs are unchanged. PiChat exposes generic transcript, composer and catalog seams rather than reading shared metadata.
- The default channel source follows the platform app host: pass the app URL, not `/spaces/<id>`. Bootstrap is `POST _channel/me` → `{ space, me }`; all HTTP operations use `POST _channel/<op>`. The former REST defaults and `me` override are removed; function overrides remain. See the [RPC bodies and retry rules](registry/README.md#shared-conversations).
- Shared people and agents now use left-aligned muted bubbles, a muted group name and a bottom-left avatar beside the last item, including a final card. Agents use a Bot fallback rather than an Agent badge. Sent mentions show an avatar and name without `@`. Localized time separators precede the first message and gaps over fifteen minutes. The demo exposes PM and Data; PM owns its work trace and card, while internal delegation stays host-owned. Agent IDs now select a stable standard chart token for their Bot icon and AA-qualified name/mention text. Unsafe palette text uses foreground. Missing standard chart defaults/bindings were restored to the theme; no bespoke token or colour override field was added. Mentions still list host-exposed agents first. Reply on an agent message or card sets `replyTo` in the existing composer and renders a clickable parent quote after sending. No new thread panel or host routing policy.
- `ChannelMessage.via?: string` displays personal-agent attribution after the person's name through the optional item's `sharedVia` label. It keeps the person author and own-user bubble, with no Agent badge or agent avatar state. The host sets it for hub MCP posts; the browser send shape is unchanged.
- Shared data adds optional `Card.state`, `ChannelMessage.steps` and the indexed `step` event. `Step` and `channelAvatarStates` are exported. Avatar indicators reflect the latest card; the optional host trace reuses Trace primitives for live and collapsed steps. The host strips `detail` outside Admin; the renderer shows whatever arrives.
- Shared EN/FR label overrides move out of PiChat labels into `useSharedChat(source, { labels })` or `SharedChat.participantLabels`. Shared visuals, host policy boundaries, source shapes and idempotent `clientId` requirements are unchanged.

# Migrating to 0.4.3

0.4.3 is non-breaking for existing files and props: older `*.maquette.json` files read unchanged, and a page that passes none of the new props renders as before.
Upgrade the registry blocks with `npx boring-ui-blocks update --version 0.4.3` (`npx boring-ui-blocks check` first lists your edited copies), and bump the npm pins to `0.4.3`.

## Consumer dependencies

Re-add the installed items to install their new dependencies. If you copied blocks by hand, install these yourself:

- `maquette-viewer` now needs `diagram-viewer` and the shadcn `toggle` and `tooltip` components. `pi-app` now installs both `diagram-viewer` and `mockup-viewer`.
- `diagram-viewer` needs the theme item, shadcn `alert` and `badge`, React and `lucide-react`.
- `mockup-viewer` needs `viewers`, shadcn `badge`, `toggle` and `tooltip`, plus React, `lucide-react`, `zod@^4.6.5` and the pinned `tailwindcss@4.3.3` compiler.
- `file-tree` now needs shadcn `progress`.
- The optional `board-viewer` block needs `maquette-viewer`, `mockup-viewer`, `pi-chat`, shadcn `button`, `alert`, `card` and `tooltip`, plus the matching kit/files packages, React, `lucide-react@1.51.0` and `tldraw@5.5.2`.
- For the optional self-hosted canvas asset recipe, install `@tldraw/assets@5.5.2`, matching `tldraw`. This is not a new mandatory package peer.

## Viewers and comments

- `maquette-viewer` no longer draws a second "…" menu inside the `pi-app` artifact panel: its guided tours and "How it works" join the panel header's menu (`MaquetteMenuContext`; standalone use keeps its own menu). The selected case in "How it works" uses the default button variant.

- Video blob pointers open in the panel and Library with native controls and Download; MP4, WebM, MOV, M4V and Ogg video extensions are recognised. Direct workspace videos without a streaming URL keep the cannot-preview state and are never buffered.

- New `board-viewer` block: `createBoardKind({ client, identity, assetUrls, licenseKey })` renders `*.board.json` in the artifact panel. It lazily projects maquette screens, sandboxed HTML mock-ups, goto arrows and notes through `CanvasProjection` from `@hachej/boring-ui-kit/canvas-editor`. Saves contain only `board@1`, conditional on the shown revision. Pinned versions and phones are read-only. Install the block and pass the kind in `artifactKinds`; hosts supply their asset URLs and license key. The parser/planner exports remain available. See [registry/README.md](registry/README.md#board-format-board-viewer).

- `CanvasEditor` now loads `tldraw/tldraw.css` itself, lazily with the canvas, so a host may stop importing it globally. Self-hosting tldraw's fonts, icons and translations is a host recipe ([UI guide](packages/ui/README.md#optional-react-canvas-editor), `examples/canvas-assets`); hosts that already pass a complete `assetUrls` map need no change.

- `pi-app` now renders `*.mockup.html` with the built-in `mockup-viewer` item. Re-add `pi-app` to install its dependency and pinned Tailwind compiler. `mockupKind` and `createMockupKind` are exported. Other HTML stays passive unless the host opts in. See the registry README for sandbox CSP requirements. `usePointComments` adds `pick`, `picking` and `reposition` for host-owned frame proxies; existing maquette comments are unchanged. `ArtifactKindViewProps.onReady` lets the asynchronous mock-up report its actual load before a presentation acknowledgement.

- Large files (blob pointers): new `@hachej/boring-files/blob` (`parseBlobPointer`, `withBlobPointers`, `checkBlobBase`, `BLOB_POINTER_MEDIA_TYPE`, …)
  and `FileEntry.blob`. `AgentWorkspace` takes `resources.blobBase` (default `/_files/`, same-origin path only; also allowed beside a `revisionProvider`)
  and an optional `resources.uploadBlob`; `Documents` takes `blobBase`. Pointer files (`*.blob.json`) now list and open as the files they stand for.
  The `file-tree` item needs the shadcn `progress` component. See [registry/README.md](registry/README.md#large-files-blob-pointers).
- `uploads.maxBytes` now also caps Library uploads (refused with `attachmentTooLarge`, or sent to `resources.uploadBlob` when given), not only chat attachments.
- `sniffMediaType` also names HEIC/HEIF, zip office documents and UTF-8 text (`text/plain`, a weak answer); new `SNIFF_BYTES` (8 KB) and
  `delimitedTextType`. `@hachej/boring-agent/file-types` `SNIFF_BYTES` is now that 8 KB (was 16), and sniffed `text/plain` never overrides a name.
- Built-in diagram viewer: the `pi-app` artifact panel draws `*.diagram.json` files (format v1: `nodes`, `edges`, optional `groups`, `path` and
  `note`) with the new `diagram-viewer` item. `diagramKind` / `createDiagramKind({ locale })` rename or translate it ("Diagram", « Diagramme »);
  an app kind for those files in `artifactKinds` still wins. `DiagramView` and `parseDiagram` are exported for other viewers.
- Maquette "How it works" is drawn by `DiagramView`. A maquette's `workflow` may also be a relative `*.diagram.json` path, read through the
  new optional `read` of kind renderers (`ArtifactKindViewProps.read`, passed by the artifact panel). Selectors changed: `[data-testid=maquette-diagram]`
  is `[data-testid=diagram]`, `[data-testid=maquette-legend]` is `[data-testid=diagram-legend]`, states are `g[data-node]`; a case `path` now
  highlights only the arrows between its consecutive states. The `maquette-diagram.tsx` file is gone.
- Comment pins on mock-ups: `AgentWorkspace comments` (or `createMaquetteKind({ comments })`) takes the `feedback` item's new
  `usePointComments(session)`; the maquette viewer then shows a comment icon that enters point mode on its screen. Each block is marked
  `data-feedback-id="maquette:<path>#screen=<id>&block=<id>"` (blocks may carry an optional `id`), so the note sent with the next message names
  the maquette, screen and block; the screen is a `data-feedback-visible` region. `SessionNote.feedbackId` (`@hachej/boring-feedback/ui`) is new.
  Without a session nothing shows. See [registry/README.md](registry/README.md#diagram-viewer-diagram-viewer).
- Kinds everywhere: a file opened from the Library, the file tree or a link resolves its artifact kind by path with the same function as the chat card
  and the panel (`resolveKind`): the app's `artifactKinds` first, then the built-in maquette and diagram kinds. `*.maquette.json` and `*.diagram.json`
  now open in their viewers there (they showed raw JSON); an app kind for them still wins. `FileViewer` shows such files in the artifact panel
  (`data-kind="artifact"`), and `ArtifactPanel` takes an optional `headerStart` (a back button).
- Fixed app title: `AgentWorkspace layout="embedded" title="My app"` keeps the app's name in the bar; the conversation title follows it in muted text
  (left to History on a phone). Without `title` the bar shows the conversation title as before. `WorkspaceBar` takes `subtitle` for the same.
- No live feed: a host route that serves no `?op=changes` should answer **501**; `RevisionProvider.changes` then ends with an `invalid` `RevisionError`
  at once (the views keep their own refresh). **400** ends it the same way and keeps working. See [registry/README.md](registry/README.md).
- `boring-ui-blocks update` and `add` keep your exact dependency pins: the shadcn CLI's package manager saved `^<version>` over them; the command now
  restores the specifier of every dependency that was in `package.json` (and the lockfile's root entry) before it ran. Dependencies the CLI adds keep what it wrote.
- `ArtifactKindViewProps` (the props an app's artifact kind `renderer` receives) gains `revision`, the revision the panel shows (the one a conditional save is made against), and `pinned`, true when the panel shows a pinned historical version, read-only. Renderers that ignore them need no change.

# Migrating to 0.4.2

0.4.2 is non-breaking: no export, option or type was removed, and a page that sets none of the new props renders as before. Upgrade the registry
blocks with `npx boring-ui-blocks update --version 0.4.2` (`npx boring-ui-blocks check` first lists the copies you edited; see
[registry/README.md](registry/README.md#updating-installed-blocks)), and bump the npm pins to `0.4.2`.

**New shadcn components to install.** `pi-app` now also needs `popover` and `tooltip`, and the new `maquette-viewer` item needs `alert`, `badge`,
`bubble`, `button`, `card`, `empty`, `input`, `item`, `label`, `native-select`, `separator`, `table`, `dialog`, `dropdown-menu` and `popover`
(plus `lucide-react`). `boring-ui-blocks update` and `shadcn add` install them with the items; install them yourself if you copied blocks by hand.

- `AgentWorkspace layout="embedded"` and `WorkspaceBar`: no left column at any width and one compact top bar (title, History, Library, New, then
  `chat.headerActions` and `controls`); History and Library are popovers on a wide workspace and sheets on a phone. Pages that approximated it with
  `history="popover"`, `sessions={false}` and their own Library wiring can drop those. `app-shell`'s screen header has a slot for an embedded
  page's controls (`utils/screen-header-slot.ts`, shipped in the `utils` item), so inside an app-shell screen the bar's buttons join the shell's header.
  See [registry/README.md](registry/README.md#whole-agent-app-pi-app-agentworkspace).
- Read-only Library: `resources` alone is enough when the endpoint is a `createRevisionHandler` route (it then also serves the viewers' reads).
- Built-in maquette viewer: the `pi-app` artifact panel draws `*.maquette.json` files (a PM agent's mock-ups, format v1) with the new
  `maquette-viewer` item instead of showing their JSON. Nothing to change; an app kind for those files in `artifactKinds` still wins.
  `maquetteKind` / `createMaquetteKind({ locale })` are exported to rename or translate it, and kind renderers also receive the page's URL
  `fragment`. See [registry/README.md](registry/README.md#maquette-viewer-maquette-viewer).
- Viewer header (Markdown editor and every viewer): the save status is a dot in the default shadcn roles (primary saved, muted-foreground unsaved
  or saving, destructive for a refused, conflicting or unconfirmed save); its words are the tooltip and the screen-reader label, and only a destructive
  status also shows its words. The Rich/Source switch is an outlined icon-only segmented `ToggleGroup`. The "Aa" pin-formatting-toolbar button is
  removed: `formattingToolbar` (default `pinned`) decides. Selectors: `[data-testid=<id>-status]` keeps its `role=status` and text content, now in
  `[data-testid=<id>-status-text]`; `ViewerToggleOption` adds `reason`.
- The `ask_user` question card is built from stock shadcn components only (a default `Card` while it asks, then a default `Item` recap). Props,
  behaviour and the answer sent to the agent are unchanged. Tests or journeys reading the old markup should select `[data-testid=question-answer]`
  (one per answer of a form, a skipped one with `data-skipped="true"`) instead of the "Your answer:" text or the `Badge`.

# Migrating to 0.4.1

0.4.1 is non-breaking: no export, option or type was removed. Upgrade the registry blocks with
`npx boring-ui-blocks update --version 0.4.1` (it reinstalls every installed block at that version; `npx boring-ui-blocks check` first lists the
copies you edited; see [registry/README.md](registry/README.md#updating-installed-blocks)), and bump the npm pins to `0.4.1`.

**Behaviour change.** `ask_user` now lets the person answer in their own words by default, also when options are given. Pass
`allowFreeText: false` for an options-only question.

New opt-ins (nothing changes until you use them):

- `ask_user` `questions`: several questions in one form, each may be skipped; the feedback-request result reports `skipped`.
- Artifact kinds, a `belowComposer` slot, a standalone `QuestionCard`, conversations in the app-shell chat layer, `RunCard` and a CSV viewer (kit).
- `@hachej/boring-agent/agents` `createDelegateTool` and `@hachej/boring-agent/schedule`: agent delegation and schedule helpers.
- `createConversationSocketHandler` and `createRemoteChat({ transport: 'websocket' })`: hibernatable WebSocket chat transport.
- `boring-ui-blocks` (shipped with `@hachej/boring-ui-kit`): `check`, `update`, `add` and `manifest`. Recommended in CI: `npx boring-ui-blocks check --design src`
  (blocks against the installed kit, plus the BORING-UI-1 design profile on your own code; `--manifest <path>` and `--json` are optional).
  Exit codes: `0` all checks pass, `1` rule violations, `2` usage or configuration error. Contract: [registry/README.md](registry/README.md#updating-installed-blocks).
- `PiChat` `keyboardInset` prop: pass `false` to opt out of the phone keyboard inset (the agent layer does, so the transcript stays visible in the phone drawer at half height).

# Migrating to 0.4.0

0.4.0 changes how the copied registry blocks relate to your shadcn setup. The rule is
[BORING-UI-1](INVARIANTS.md#boring-ui-1--shadcn-first-blocks-carry-no-visual-value) and the details are in
[registry/README.md](registry/README.md); this section lists only what you must change.

- **Base UI only.** Blocks support the shadcn Base UI styles (`base-nova` / `base-*`). Radix style support is removed.
- **Blocks use your shadcn components.** They compose the host's own `@/components/ui/*` and carry no visual values. Restyle through theme tokens, not by editing block files.
- **Removed recipes.** `registry/drawer` and `registry/dropdown-menu` no longer exist: use your own shadcn `drawer` and `dropdown-menu`.
- **`ActionMenu`** is now `useMenuPortal` + `ActionMenuContent` (`registry/button/actions.tsx`).
- **App shell sheet.** `sheet.tsx` is now `app-sheet.tsx` plus `use-exclusive-sheet.ts`.
- **Transcript.** It uses `@shadcn/react` `MessageScroller`; `use-stick-to-bottom` is removed.
- **New prop.** `AgentWorkspace` takes `history="column" | "popover"` (default `column`).

Upgrade: bump the npm pins to `0.4.0`, then re-run
`npx shadcn add <0.4.0 item URLs> --overwrite` for every installed item
(`https://cdn.jsdelivr.net/npm/@hachej/boring-ui-kit@0.4.0/r/<item>.json`) and review the diff.

## native-chat and remote-chat

Apps that use only `@hachej/boring-ui-kit/native-chat` and `@hachej/boring-ui-kit/remote-chat`: no export, option or type changed since 0.3.2 (diff of `packages/ui/src/native-chat.ts` and `remote-chat.ts`). Two behaviour fixes:

- `createNativeChatController`: loading older history now returns the earlier entries together with those already loaded, instead of replacing them with the page just fetched.
- `createRemoteChat`: the `entries` call forwards the query's `maxEntryId`, `minEntryId` and `order` to the endpoint as search parameters (a server that ignores them behaves as before).

`endpoint` still resolves relative to the page (`new URL(endpoint, location.href)`). The kit adds no auth headers: the only header it sets is `content-type` on POST; the host adds credentials in the `fetch` option.

## Apps that copied blocks

Re-copy with `npx shadcn add <0.4.0 URL> --overwrite`, then re-apply your local edits. Since 0.3.2 (`git diff --name-status v0.3.2 v0.4.0 -- registry/pi-chat registry/app-shell`):

- `app-shell/`: `sheet.tsx` removed; `app-sheet.tsx` and `use-exclusive-sheet.ts` added. Every other file there is modified.
- `pi-chat/`: `conversation-files.tsx` added; nothing removed or renamed. All other files are modified.

New dependencies the host must have (installed by the items' bare shadcn registry dependencies, in your style): `pi-chat` adds `trace`, `message`, `message-scroller`, `bubble`, `attachment`, `badge`, `alert`, `checkbox`, `table`, `card`, `spinner`, `collapsible`, `drawer`, `button`, `toggle`, `dropdown-menu`, `empty`, `input`, `input-group`, `popover`, `scroll-area`, `separator`, `sidebar`, `item`, `avatar`; npm `@base-ui/react`, `@shadcn/react`, with `use-stick-to-bottom` dropped. `app-shell` adds `button`, `switch`, `badge`, `card`, `separator`.

# Breaking migration to the native Pi library

This candidate replaces the implementation in `hachej/boring-ui` with the v4
library. Its proposed npm version is `0.2.0`, a breaking pre-1.0 update after `0.1.111`.
The architecture name "v4" is independent of the npm version. Five packages are in the
publish set; boring-browser and boring-testing stay private. Publication still awaits
owner authorization ([release ruling](docs/implementation/NPM-RELEASE.md#release-ruling-owner-2026-10-10)).

## Package identities

| Development identity | Release candidate identity |
| --- | --- |
| `@boring/agent` | `@hachej/boring-agent` |
| `@boring/ui` | `@hachej/boring-ui-kit` |
| `@boring/files` | `@hachej/boring-files` |
| `@boring/execution` | `@hachej/boring-execution` |
| `@boring/browser` | `@hachej/boring-browser` |
| `@boring/feedback` | `@hachej/boring-feedback` |
| `@boring/testing` | `@hachej/boring-testing` |

Neither the old agent API nor the UI kit API is compatible with this candidate.
The old private `@hachej/boring-browser` plugin also has a different API from the
new optional native agent worker. Do not upgrade applications by changing only
their dependency versions.

The old core, workspace, CLI, plugin CLI, Pi skills/reference package, Bash, sandbox and plugin
packages have no package-level compatibility replacement in this tree. Existing
published versions remain untouched. Host applications retain identity, storage,
policy and deployment responsibilities. Native Pi supplies execution; optional
workspace adapters and copied shadcn recipes replace selected capabilities, not
the old imports or persisted data formats.

## Application migration

1. Keep the existing application and its dependency lock until its own migration
   branch passes its acceptance tests. This repository change migrates no app.
2. Choose the optional entries documented in the [library guide](README.md).
   Borrow a host-owned native Harness and keep its direct APIs. Do not pass old
   AgentHost or workspace objects as though they were compatible native objects.
3. Implement host authorization and resource publication against the new
   [contracts](docs/contracts/CONTRACTS.md). Review working files separately from
   conditional authoritative writes, and preserve expected revisions and receipts.
4. Port UI composition using the [UI guide](packages/ui/README.md) and
   [registry guide](registry/README.md). Install the new recipe sources explicitly;
   existing copied recipes do not update when an npm dependency changes.
5. Qualify existing data and task history separately. No automatic conversion of
   old sessions, databases, grants or plugins is supplied. Preserve backups and
   old application builds before any separately approved cutover.

## Source and ownership

The target base is `62eaa783257c7126dcdfe798cd09b83cf9633de8` in
`hachej/boring-ui`. Git history retains the previous implementation and its owner
documents. The user explicitly requested the replacement and breaking release.
The v4 owner documents now govern this implementation; previous frozen
AgentHost, plugin and pnpm architecture instructions describe the old generation.

The imported candidate combines v4 PR54 at
`5c2cc6be92cc91f692599ad86461896384449954` with v4 main through
`af55e2a87cd5d1183eb7807acb26db6f5a29f56e`. Local integration source is
`59defc4c55a5488956a34eff659898c57ddc2d72`. Main's AWS/Cloudflare workspace,
question-card streaming and ignored-file checks are included. Uncommitted chat
continuity work is excluded. Evidence for predecessor commits does not qualify
this renamed and combined candidate.

The previous automatic pnpm publishing workflow is removed. The replacement
uses npm workspaces and [release preflight](docs/implementation/NPM-RELEASE.md).
It includes synchronized version preparation and a maintainer-dispatched npm
workflow that publishes the exact qualified tarballs through trusted publishing.
Merges and tags do not trigger publication. Publication is gated by the owner checklist in docs/implementation/NPM-RELEASE.md.
No GitHub release, npm publication, deployment or consumer modification is part
of this PR. The [partial checkpoint](docs/implementation/PARTIAL.md) and all
eleven global proof deferrals remain. A version change does not discharge them.

## Agent file reading, mentions and conversation previews

Removed from `@hachej/boring-agent`, with their replacements:

| Removed | Use instead |
| --- | --- |
| `createConvertedTextTool` (`/file-convert`) and the `read_converted_text` tool | `createConvertingRead({ convert, cache })`, an extension that wraps Pi's own `read`: install it in `extensions` before `createFileGuard`, and tell the model to use `read` for every file. |
| `ConvertedTextToolOptions.pageSize` (characters per page) | none: converted text pages like Pi's read (`offset` is a 1-based line, `limit` a line count, 2000 lines or 50 KB per page; a line above 50 KB is split into 50 KB segments that each count as a line). |
| `fileSystemMentionReader(fs, context, { root })` (`/mentions`) | `workspaceMentionReader(files, access)`, which reads the person's view through the workspace provider. A host without a provider writes its own `MentionReader`. |

Behaviour changes:

- The file guard refuses `read` (not only `write` and `edit`) when the workspace cannot be resolved, the provider refuses access, the path or a link leads outside the root, or the path does not exist (Pi's fallback spellings are never tried). An `edit` of a missing path is refused too.
- Archives and other binary files answer `unsupported` and are never sent to `convert`; a converter receives the media type the file's signature names when it has one.
- A managed conversation's `lastMessage` preview, derived when a conversation is adopted, is the last visible text message of the newest entry (it was the first message of that entry). Titles are unchanged: the first user message, now found with an ascending scan.
- New exports: `@hachej/boring-agent/file-types` (the one table of text, archive and binary kinds, and the media types), and from `@hachej/boring-agent/file-guard`, `confinedEnv` (Pi's `ExecutionEnv` re-checked per operation) and `workspaceRelative`.
- Removed exports: `extensionOf` and `sniffedMediaType` from `@hachej/boring-agent/file-types`. Import `extensionOf` and `sniffMediaType` from `@hachej/boring-files/file-types` instead.

