# Viewer source recipes

The `markdown-editor` and `html-viewer` items copy thin React wrappers and scoped CSS into a host application. They preserve concrete controller props and borrow the host's controller. Unmounting a wrapper leaves its controller alive.

| Item | Public renderer | Controller |
| --- | --- | --- |
| `markdown-editor` | `@hachej/boring-ui-kit/markdown-editor` | `MarkdownController` from `@hachej/boring-ui-kit/markdown` |
| `html-viewer` | `@hachej/boring-ui-kit/html-viewer` | `HtmlController` from `@hachej/boring-ui-kit/html` |
| `pi-chat` | copied source in `components/pi-chat/` | `NativeChatController` from `@hachej/boring-ui-kit/native-chat` |
| `pi-ambient` | copied source in `components/pi-ambient/` | the same `NativeChatController` as `pi-chat` |
| `pi-workspace` | copied source in `components/pi-workspace/` | none: layout driven by props |
| `pi-app` | copied source in `components/pi-app/` | the `NativeChatController` of `useRemoteChat`; viewers over one resource client |
| `provider-setup` | copied source in `components/provider-setup/` | none: props and callbacks only |
| `theme` | the shadcn tokens (light, dark) and their `@theme inline` bindings, merged into the host's CSS | none |
| `utils`, `button` | `cn`/`copyText` and the one shared `Button`/`IconButton`, in `components/utils/` and `components/button/` | none |

## Blocks: what to install

`pi-chat` is the chat and nothing else. `pi-ambient` and `pi-workspace` are optional blocks over it; install only what the page needs. A block imports its dependency by the installed sibling folder (`../pi-chat/rows`, `../utils/utils`, `../button/button`), so there is one copy of each helper, and `scripts/check-registry-blocks.mjs` (in `npm run check`) fails if `pi-chat` imports a block, `pi-workspace` imports `pi-ambient`, a source file is not listed in its item, a file's type or target is off, two items ship the same file name, or any import cycle exists in a block or a package's sources (type-only and lazy imports count; it prints the cycle's path).

Item and file types follow the shadcn schema: the multi-file chat items are `registry:block`, the viewer wrappers and component sets `registry:component`, the shared button `registry:ui`, the shared helpers `registry:lib`, the tokens `registry:theme`. Within an item a `.tsx` file is `registry:component` (`registry:ui` for the button), a `use*.ts` file (and `pi-ambient/browser-notify.ts`) is `registry:hook`, and any other `.ts` file is `registry:lib`. Every file has the target `components/<item>/<file>`, so the installed folders mirror `registry/` (the Markdown and HTML wrappers land in `components/markdown-editor/markdown-editor.tsx` and `components/html-viewer/html-viewer.tsx`, the preview banner in `components/feedback-preview/`).

| Block | Install | Pick it when |
| --- | --- | --- |
| `pi-chat` | `npx shadcn@4.21.1 add <registry>/pi-chat.json` | you lay out the page yourself and only need the conversation (`PiChat`) |
| `pi-ambient` | `... add <registry>/pi-ambient.json` (also installs `pi-chat` and `pi-workspace`) | an agent sits beside an existing site: `AmbientChat` bar and `AgentNotifications` toasts |
| `pi-workspace` | `... add <registry>/pi-workspace.json` (also installs `pi-chat`) | the page is the chat plus a resizable artifact panel (`ArtifactWorkspace`); add `viewers` for the panel contents and `pi-ambient` for float-when-narrow |
| `pi-app` | `... add <registry>/pi-app.json` (also installs `pi-chat`, `pi-workspace` and `viewers`) | the page is a whole agent app: sessions, chat and artifact viewers in one `AgentWorkspace` (see [below](#whole-agent-app-pi-app-agentworkspace)) |

Every Tailwind item depends on `theme` (`pi-chat`, `viewers`, `provider-setup` and `button` directly, the blocks over `pi-chat` through it), imports `cn` from `utils` and, when it renders buttons, `Button` from `button`; the CLI installs each once. Checked by hand with the pinned CLI over HTTP and the namespace mapped: `pi-chat` creates 26 files (its 24, `button/button.tsx`, `utils/utils.ts`), `pi-workspace` adds `workspace.tsx` (27), `pi-ambient` its three files and `workspace.tsx` (30), `viewers` 12; each also merges the theme tokens into the CSS file, keeping tokens the host already defines.

`<registry>` is wherever `public/r/` is served. `pi-ambient` and `pi-workspace` name their dependencies as `@boring-ui/pi-chat` and `@boring-ui/pi-workspace`, so map the namespace once in the app's `components.json`: `"registries": { "@boring-ui": "<registry>/{name}.json" }` (a bare name would resolve against shadcn's own registry and fail). `pi-ambient` needs `pi-workspace` because the ambient window opens artifacts in the same panel layout; `pi-workspace` never needs `pi-ambient` (the host chooses to render `AmbientChat` when the chat floats). Examples: [`examples/studio`](../examples/studio/README.md) assembles every block; [`examples/ambient`](../examples/ambient/README.md) uses `pi-chat` and `pi-ambient` only.

## Artifact cards in `pi-chat`

Pass `artifacts={{ open, isOpen?, detect? }}` to `PiChat` and a tool result whose JSON text carries a valid `boring.artifact` descriptor (the result of `present`) becomes a card outside the activity block: icon, title, type, a real button calling `open` (and the version number for a descriptor that has one; a presented file's descriptor points at the file and has none). A running `present` shows an opening card, a failed call shows none, and presenting one file several times in a turn shows its last version once. The host owns the panel; `collectArtifacts(view, detect)` lists the versions a conversation produced. The copied `artifact.ts` repeats the descriptor validator of `@hachej/boring-agent/artifacts` because a registry item cannot import it; a source test keeps them equal. The item is also usable in a narrow container: touch targets of at least 40px on small or coarse-pointer screens, 16px composer text, Enter inserts a newline on touch devices, and pickers and menus open as a bottom sheet or full-width popover.

## Approval cards in `pi-chat`

Pass `actions.answer` to `PiChat`. A call to a tool wrapped with `requireApproval` from `@hachej/boring-agent/approval` shows an Approve / Deny card while it waits: the wrapper publishes a one-line summary under `APPROVAL_DETAILS` in the call's details, which is how `derive` recognizes it (no list of tool names); the person's click goes through `actions.answer`, the same operation as `ask_user` questions. The card shows the summary as the headline and folds the raw arguments under an "Arguments" disclosure. A denied call (a result starting `Denied by the person.`) shows as denied, any other result as approved, and the call stays a step of the activity block. Without `actions.answer` the card is read-only.

## `provider-setup`

`ProviderSetup` is a Tailwind popover for model access. It never fetches: the host passes `providers` (`{ id, name, models, auth: ('api_key' | 'oauth')[], configured, needsGateway?, loginLabel? }`, whichever providers the host registered), the current `value` (`{ provider, modelId, gateway? }`) and callbacks. `onSave({ provider, modelId, gateway, apiKey? })` may reject with an Error to show its message; `onLogin(providerId)` starts a device-code sign-in whose progress the host passes back as `loginState` (`idle | starting | pending { userCode, verificationUri } | done | failed { message }`). The API key field is masked and shows "saved" when `configured`; a provider with `needsGateway` shows a note and the optional gateway field. Put it in the `controls` slot of `PiChat`; `trigger`, `side`, `align`, `showGateway` and `defaultOpen` adjust it. `@hachej/boring-browser/models` produces the provider list (`catalog()`), and its `createModelAccessHandler` serves the item's routes from a worker (`GET`/`PUT <prefix>`, `POST <prefix>/login`) for one conversation, whose native model is the value. `needsGateway` and the gateway field are for hosts that route some providers through their own proxy; the handler leaves that to the host.

## Feedback cards in `pi-chat`

`feedbackRenderTool({ onShowFeedback, onHideFeedback })` is a `renderTool` for `PiChat` or `AmbientChat` (memoize it) that turns results of the opt-in `feedback` tool of `@hachej/boring-feedback/agent` into cards: a `list` result shows each report with its element lines (fallback and `source`) and placements (and says when the store is unprotected), a `show` result is an offer for one element line, and a refused `show` says why. The cards are `inline` chat cards, so they stay in the transcript in expert mode. The tool never reveals anything: hovering or focusing an element line calls the host's `onShowFeedback({ id, anchor, note, intent: 'hover' })` and leaving it `onHideFeedback()`; a click sends `intent: 'click'`, so the host may let the person choose among ambiguous candidates. Only a chat mounted in the subject's application page can give the callback (it resolves and reveals against the live page), and the card shows the outcome it returns inline (`applied`, `stale`, `unavailable` or `denied` with its reason; a throw is `unavailable`). Without the callback the lines are plain text and an offer says `unavailable`: open the application page.

`Composer`, `PiChat` and `AmbientChat` take an optional `feedback` prop (`ComposerFeedback`: `start`, `active`, `pending`, `chip`, `attach`, `sent`; the `feedback` item's `useComposerFeedback(session)` returns it). It adds one Feedback button beside the "+" menu and the pending feedback's chip; Send then calls `attach(text)` for the text to send with the feedback attached (a refusal sends nothing and is shown) and `sent()` once the message is accepted. Without the prop the composer renders exactly as before. An `@<root><id>.md` mention of a report in a sent message renders as a feedback chip. The card imports `FEEDBACK_ID` from `@hachej/boring-feedback/format` directly instead of copying the validator, so the item depends on `@hachej/boring-feedback`.

## Panel (`pi-workspace`), History and queue (`pi-chat`)

`ArtifactWorkspace` (`pi-workspace/workspace.tsx`) lays out the chat with a right-hand panel: it slides in at full height, the divider resizes it (pointer and arrow keys, width kept for the session), the panel can go full screen (Escape leaves) and below `sheetBelow` it is a full-screen sheet. Opt in with `floatBelow={320}` and the chat can float: dragging the divider until the chat is narrower than that shows a dimmed "Release to float the chat" hint, releasing floats it, Alt+Left on the divider or "Float chat" in the viewer "…" menu (pi-app's `AgentWorkspace` turns `api.floatChat` into one of the `ViewerWindow.actions`, see [host actions](#labels-icons-and-host-actions)) does the same, and the panel takes the full width. `chat` is then a function `({ floating, dock }) => node`: return the docked `PiChat` or, while floating, `<AmbientChat controller={same} onDock={dock} defaultState="expanded" />` with the same props. Both use one controller, so transcript, queue, draft and the single watch stream carry over (`PiChat`/`AmbientChat` only borrow it). Dock returns the chat at the last width above the threshold; the floating state is remembered for the session, closing the panel docks, and the phone sheet ignores it. Off by default. It owns layout only; what is open is the host's, and the viewer inside uses `ViewerFrame`, which shows an Enter/Exit full screen button when wrapped in `ViewerWindowProvider` (viewers item). It is its own block (`pi-workspace`) because it is self-contained and driven by props; the studio uses it for artifacts and workspace files. Pass `conversations={{ items, activeId, onSelect, onNew }}` to `PiChat` and the header History button opens a searchable list of past conversations (the earlier records of the open one stay reachable from its footer). A message sent while the agent works waits in the queue, where each message offers Steer now, edit and remove (steer and edit need `actions.withdraw`); the composer has no mode toggle. Enter empties the composer at once; a message sent while the previous one is still being confirmed shows as a "Sending" row (the controller's `outbox`) until it is submitted, and a refused message comes back into the composer above what was typed since.

`@` mentions name workspace files; a path with whitespace or a quote is written quoted (`@"docs/Meeting notes.md"`, with `\"` and `\\` escaped), and bare paths keep their form. `mentionToken(path)` writes the text, `pieces` and `mentionedPaths` (the agent package, which must match it) read it back, and the composer chip and `removeMention` treat the quoted form as one token. A bare mention ends at whitespace, so the composer never inserts a bare path that contains a space.

## Whole agent app (`pi-app`: `AgentWorkspace`)

`AgentWorkspace` (`pi-app/agent-workspace.tsx`) is one page: the sessions pane on the left (`sessions.tsx` over `pi-chat`'s `ConversationList`: search, New, rename, archive with the Archived filter, delete; the header toggle hides it, remembered for the session; the toggle stays mounted in the workspace over the chat header, so it keeps working while a switched chat connects and its header is replaced; below `drawerBelow` it is a drawer with a backdrop, closed by Escape or a choice), `PiChat` in the center (its History then pages the open conversation's earlier records, `historyList={false}`, and replies keep Fork), and on the right the `ArtifactWorkspace` panel with the artifact viewer (`artifact-panel.tsx`: follow the latest or pin a version from the file's history, read-only; Markdown, HTML, SVG, code), the file viewer (`file-viewer.tsx`: Markdown and HTML editable, image, PDF, text) and the host's own views. New artifacts of the open conversation open the panel unless the person closed it in this turn (not on a phone, where the panel is a full-screen sheet). Every prop is data or a callback: `controller`, `conversationId`, `chat` (the other `PiChat` props), `conversations`, `resources` `{ endpoint, fetch, identity, history?, locate? }`, `viewers` (host viewers by type or kind, for example a tldraw canvas), `interactive`, `share`, `opened`/`onOpenedChange` (controlled; `{ kind: 'artifact' | 'file' | <host kind> }`), `panels`, `fileBack`, `floatingChat`, `controls`, `chatTop`, `sheetBelow`, `drawerBelow`, `floatBelow`, `storageKey`. Hooks: `useConversations({ endpoint, fetch, activeId, onSelect, onChange? })` (the sessions list over the conversations handler, polled), `useRemoteChat({ conversationId, endpoint, fetch, identity })` (one controller per conversation over the chat transport) and `useSaved` (a resource's saved text, never replacing unsaved edits).

Chat attachments are saved under `uploads/` and reference-only by default: the message carries each file's `@path` and the agent reads it with its file tools, so no base64 rides along in every later turn. `uploads={{ inlineImages, maxBytes, accept }}` opts back into a native image per png/jpeg/gif/webp (`inlineImages`), refuses larger files before upload with a visible reason (`maxBytes`, labelled by `attachmentTooLarge`), and sets the picker's `accept`. Saved names contain no whitespace, since a mention ends at a space.

The host mounts these handlers, each behind its own authentication (one composition, as in [`examples/workspace-app/server.mjs`](../examples/workspace-app/server.mjs), about 100 lines with the agent):

| Route the props name | Handler |
| --- | --- |
| conversations (`useConversations` `endpoint`) | `createConversationsHandler({ conversations: createConversations({ harness, context }), authenticate })` of `@hachej/boring-agent/conversations`; `authenticate` returns `{ owner, start }` |
| chat (`useRemoteChat` `endpoint(id)`) | `createChatTransportHandler({ authenticate })` of `@hachej/boring-agent/chat-transport`, opening the conversation with `conversations.open(owner, id)` |
| `resources.endpoint` | `createResourceHandler({ authenticate, reader: files, publisher: files.publication, lookup: files.reconciliation })` of `@hachej/boring-files/remote` over the workspace provider |
| `resources.history` (optional: the version menu) | `GET ?path=` returning `{ saves: files.saves(path) }` |

`examples/workspace-app` is that page and server only (`npm run workspace-app`; `npm run workspace-app:journey` drives it with the scripted model: the list, search, switching, an artifact on the right, collapse right after a switch (the toggle is the same button across it), and the phone drawer and sheet at 390px; then `?configured`, the same page rebranded through the props below, with every host action clicked, by keyboard too, and at 390px).

### Labels, icons and host actions

Every block takes its words as one typed, partial `labels` object over its exported defaults (strings, or functions where a value goes in, for example `noMatch(query)`), its icons as a partial `icons` map (any component taking `className`; every lucide icon fits), and host actions as `BlockAction` lists: `{ id, label, icon?, onSelect, placement?: 'header' | 'menu', disabled? }`. A `header` action is a button beside the block's own (icon only when it has an icon, the label as its name and tooltip), a `menu` action an item of the "…" menu (arrow keys, Enter, Escape); its test id is `<surface>-<id>`. No i18n framework: an app that translates passes one object per language. `BlockAction`, `BlockActions` and the shared `ActionMenu` live in the `button` item (`button/actions.tsx`).

| Block | `labels` / `icons` defaults | Actions |
| --- | --- | --- |
| `pi-chat` `PiChat` | `defaultChatLabels`, `defaultChatIcons` (`pi-chat/labels.ts`): title, placeholder, Send/Stop/Queue, History, notices, empty and loading states, the conversation list, queue, cards, activity; icons `agent`, `send`, `stop`, `history`, `newChat`, `add`, `attach`, `queue`, `jumpToLatest`, `reconnect`, `fork`; `avatar` (a node) before the title | `headerActions` (`chat-action-<id>`), `messageActions(reply)` under each settled reply (`reply-action-<id>`), `conversations.rowActions(item)` on each conversation row (`conversation-action-<id>`; a row action without an icon goes in the row's "…" menu) |
| `pi-ambient` `AmbientChat` | `defaultAmbientLabels` (the chat's, the toasts' `defaultNotificationLabels` and its own: `title`, `placeholder`, `working(seconds)`, Minimise, Dock, …), `defaultAmbientIcons` | `headerActions` in the floating bar before Dock (`ambient-action-<id>`), `messageActions` |
| `pi-app` `AgentWorkspace` | `defaultAppLabels`, `defaultAppIcons` (`pi-app/app-labels.ts`: sessions pane, artifact panel, file viewer, and the viewers' below); the chat's go in `chat.labels` / `chat.icons` | `panelActions` (a list, or a function of what is open) on every viewer bar in the panel (`<viewer testId>-<id>`, `artifact-<id>` for an artifact), after the built-in "Float chat" (`float-chat`); `chat.headerActions`, `chat.messageActions`, `conversations.rowActions` |
| `viewers` `ViewerFrame` and panes | `defaultViewerLabels`, `defaultViewerIcons` (`viewers/viewer-window.ts`), through `ViewerWindowProvider` `{ labels, icons }` for every viewer below or one frame's `labels` / `icons` | `ViewerWindowProvider` `{ actions }` and `ViewerFrame` `actions` (`<testId>-<id>`) |

```tsx
<AgentWorkspace {...props}
  labels={{ sessionsTitle: 'Projects', newChat: 'Start', floatChat: 'Pop out chat' }}
  panelActions={[{ id: 'pin', label: 'Pin to board', icon: PinIcon, onSelect: pin }]}
  conversations={{ ...conversations, rowActions: item => [{ id: 'star', label: `Star ${item.title}`, icon: StarIcon, onSelect: () => star(item.id) }] }}
  chat={{ labels: { title: 'Fernhill writer', placeholder: 'Ask Fernhill anything…', send: 'Ask' }, icons: { send: SparkIcon }, avatar: <img src={logo} alt="" />,
    headerActions: [{ id: 'export', label: 'Export chat', icon: DownloadIcon, onSelect: exportChat }, { id: 'report', label: 'Report a problem', placement: 'menu', onSelect: report }],
    messageActions: reply => [{ id: 'quote', label: 'Quote this reply', onSelect: () => quote(reply.text) }] }}
  floatingChat={(chatProps, dock) => <AmbientChat {...chatProps} onDock={dock} defaultState="expanded"
    headerActions={[{ id: 'handoff', label: 'Hand off to a person', onSelect: handOff }]} />} />
``` The studio and the Cloudflare recipe use the same block. `npm run test:app-registry-consumer` installs `pi-app` with the pinned CLI over HTTP (the namespace mapped to a local registry), type-checks the copied closure and a consumer page strictly and bundles it for the browser.

A tab left open keeps running the JavaScript it loaded, so after a deploy it can drift from the server. `useNewVersion({ current, url = '/version.json', everyMs = 60000 })` (`pi-app/use-new-version.ts`) returns `true` once the served build differs from `current`, the build id the host bakes into its own bundle (`undefined`, empty or `'dev'` never checks). It polls on the interval and again when the tab becomes visible, and stops once it is stale. The host serves `version.json` as `{ "build": "<id>" }` next to its bundle. `NewVersionNotice` (`pi-app/new-version-notice.tsx`) is the polite status line with a Reload button (`location.reload()`, so unsaved work in the page is lost): render it while the hook is true, as `{stale && <NewVersionNotice />}`. Its words are `newVersion` and `reload` in `app-labels.ts` and `app-labels-fr.ts`.

## Install into a new app (tested with a fresh outside app)

Nothing is published, so a consumer needs a package source for the private `@hachej/boring-*` packages. The first pass at A46 used the steps below in a Vite, React 19 and Tailwind v4 app created by the pinned CLI (`npx shadcn@4.21.1 init -t vite -b radix -p nova -n app -y --no-monorepo`).

1. In this repository: `npm ci && npm run build && npm run registry:build`, then `npm pack ./packages/ui ./packages/files ./packages/agent --pack-destination <dir>`.
2. Serve the tarballs as an npm registry for the `@boring` scope (a ten-line static registry that returns a packument with `dist.tarball`, `dist.integrity` and the package's own manifest is enough) and put `@boring:registry=http://127.0.0.1:<port>/` in the app's `.npmrc`. This is required because every item lists `@hachej/boring-ui-kit@0.0.0` as a dependency and the CLI runs `npm install` for it. `file:` tarball specs in `package.json` do not help: the CLI still installs `@hachej/boring-ui-kit@0.0.0` by name.
3. Serve `public/r/` over HTTP and run `npx shadcn@4.21.1 add http://127.0.0.1:<port>/r/pi-chat.json http://127.0.0.1:<port>/r/viewers.json http://127.0.0.1:<port>/r/markdown-editor.json -y`. Files land in `src/components/pi-chat/`, `src/components/viewers/`, `src/components/button/`, `src/components/utils/` and `src/components/markdown-editor/markdown-editor.tsx` (map the `@boring-ui` namespace first, see above); scoped CSS is merged into the app's CSS file. Re-running with `-o` is idempotent.
4. Install the server side with exact pins: `@hachej/boring-agent`, `@hachej/boring-files`, `react@19.3.0`, `react-dom@19.3.0`, `@earendil-works/pi-durable@1.0.1`, `@earendil-works/pi-ai@1.0.1` and `@earendil-works/chord@1.0.1`. Node 22.19 or newer runs a TypeScript server with `node server/main.ts` (SQLite resources use `node:sqlite`).
5. The shadcn Vite template's `npm run typecheck` is `tsc --noEmit` over a solution file with `"files": []` and checks nothing. Use `tsc -p tsconfig.app.json --noEmit`; the installed source passes the template's `strict`, `noUnusedLocals` and `noUnusedParameters`.

## Build and install

Run `npm run registry:build` with the pinned shadcn 4.21.1 development dependency. The command generates the registry index and the item JSON files under `public/r/` from `registry.json`. The source contract test rebuilds the item and compares its contents.

With the exact package dependencies available through the host's package distribution, run the standard CLI in an existing React application with a valid `components.json`:

```sh
npx shadcn@4.21.1 add /absolute/path/to/public/r/markdown-editor.json
npx shadcn@4.21.1 add /absolute/path/to/public/r/html-viewer.json
```

Version 0.0.0 identifies the local library candidate. This repository does not publish or host the package or registry endpoint. The command above requires that distribution setup before a normal npm install can succeed.

Create a controller through `@hachej/boring-ui-kit/markdown` with the host's resource client and identity. Pass it as `controller` to the copied `MarkdownEditor`. The host owns authentication, publication policy and controller teardown. The wrapper forwards the editor's title, mode, placeholder, className and `onMountedTools` props. The installed recipe repeats mounted selection/navigation tests before and after restyling; see the [mounted command guide](../packages/ui/README.md#mounted-markdown-commands).



## Styling

Each item scopes every selector to its root, `.boring-markdown-recipe[data-boring="markdown-editor"]` or `.boring-html-recipe[data-boring="html-viewer"]`. The item adds no reset, fonts, root theme or executable plugin. These rules are unlayered. CSS variables and sufficiently specific consumer rules are the tested customization paths; Tailwind utility precedence is not promised. Edit the copied wrapper or override its class. Proposal additions/removals accept `--boring-editor-diff-add-background`, `--boring-editor-diff-add-foreground`, `--boring-editor-diff-remove-background` and `--boring-editor-diff-remove-foreground`; the installed fixture checks those overrides. Local `--boring-editor-*`, `--boring-chat-*` or `--boring-html-*` variables override host tokens such as `--background`, `--foreground`, `--border`, `--ring` and `--radius`.

## Controlled local qualification

```sh
npm run build
npm_config_cache=/absolute/path/to/writable/npm-cache npm run test:registry-consumer
TMPDIR=/tmp npm_config_cache=/absolute/path/to/writable/npm-cache npm run test:html-registry-consumer
```

The cache must contain the pinned dependency archives from `package-lock.json`. The recipe uses disposable package installations and the actual shadcn CLI. Its ignored local fixture replaces direct dependency locators with cached tarball paths. It checks original registry archive integrity, embedded package names and versions, and installed versions. Boring archives come from the current public package output and only the item's declared Boring dependencies are packed. Markdown declares its files peer explicitly. Only fixture dependency strings change; committed source pins and generated item contents remain intact.

The fixture selects an empty base color in `components.json` so the host owns its theme and the CLI does not download a color preset. It drives the copied Markdown wrapper through real React, Tiptap and SQLite operations. Chat uses a real native Harness, a fictional streaming provider and native ToolTask execution. Each recipe edits the installed class and style and repeats the checks. Strict declarations and a browser bundle check physical dependency isolation.

DOM checks do not qualify browser geometry, keyboard behavior or accessibility. This local tarball installation does not qualify hosted registry discovery or npm metadata resolution. Run the chat consumer outside any ancestor application node_modules. Some upstream public declarations probe ancestor paths explicitly; the strict physical isolation guard rejects them. Canvas and agent installation recipes remain separate roadmap work; the consumer task-list recipe is described below. A20 and A46 remain partial.

## HTML source and preview

Pass a host-created `HtmlController` to the copied `HtmlViewer`. Source edits and exact saves use the resource client. The preview reconstructs passive formatting with no source attributes or external resources. Source viewing and saving remain available when parsing, Trusted Types or size limits refuse the preview. See the [UI guide](../packages/ui/README.md#optional-html-source-and-preview) for the exact contract.

The HTML installation fixture repeats public controller/renderer behavior through the copied wrapper, checks scoped host colors and restyling, and builds the controller and wrapper together. Its DOM environment does not qualify native template inertness, iframe isolation, CSP, Trusted Types or network behavior. Actual browser qualification remains required.

## Pi chat (Tailwind)

`pi-chat` is the chat product, not a wrapper (the ambient bar and the workspace layout are the separate blocks above): owned, editable Tailwind source under `registry/pi-chat/`. `PiChat({ controller, labels, icons, mode, actions, ... })` subscribes to the headless `NativeChatController` from `@hachej/boring-ui-kit` and renders the native Pi view directly. There is one message model (the Pi view) and no AI SDK: types come from `@earendil-works/pi-durable` and `@earendil-works/pi-ai` as type imports only. The files install into `components/pi-chat/` so they never overwrite a host's own `button` or `utils`.

| Part | File |
| --- | --- |
| Component, scrolling, send/stop/connection state, history paging | `pi-chat.tsx` |
| View to display rows (tool calls paired with results, expert mode, live generation, merged turns) | `rows.ts` |
| Messages, interrupted and failed states, copy response | `message.tsx` |
| Safe Markdown with code block cards | `markdown.tsx`, `code-block.tsx` |
| One activity block per assistant turn (Chain of Thought rail: current step while running, summary after, reasoning and tool rows on expand), tool cards, shimmer | `activity.tsx`, `tool.tsx`, `shimmer.tsx` |
| Composer (auto-growing, Enter/Shift+Enter, IME safe, one Send/Stop button, steer or queue while busy, image chips) | `composer.tsx` |
| Optional composer features: `/` menu (v2 picker port), `@` file picker, model and effort pickers, shared keyboard hook, option types and token helpers | `slash-menu.tsx`, `mention-menu.tsx`, `pickers.tsx`, `picker-keyboard.ts`, `config.ts` |
| Queue read from the view's `pi.inbox` document | `queue.tsx` |
| Human-in-the-loop `ask_user` card | `question-card.tsx` |
| Feedback card: `feedback` list results and offers with hoverable element lines, report mentions | `feedback-card.tsx` |
| Empty state, read-only history (the shared `Button` and `cn` come from the `button` and `utils` items) | `empty-state.tsx`, `history.tsx` |
| Shared chat behaviour for every surface (send, queue actions, uploads, pickers, rows, paged transcript), send/stop notices | `session.tsx`, `notice.tsx` |

Pass `actions={{ answer, withdraw }}` with the matching functions from `createRemoteChat()` (feature-detect them: a transport without them leaves question cards and queued messages read-only). `answer(callId, answer)` resolves to `{ kind: 'answered' }` or a refusal that the card shows inline.
A question or approval card is `data-state="writing"` while the model is still generating its call (options may be partial and nothing can be answered), then `pending` while it waits on the person.

Each turn's tool calls and reasoning are folded into one activity block (after Vercel AI Elements' Chain of Thought). Collapsed it is one fixed-height line: the current step while the turn runs ("Reading notes/consultation.md", "Thinking") with a step counter, then "Used read ×3 · working_git" with a check. Failures open the block; a stopped turn says so. Rows stay in the DOM, hidden, and each expands to its arguments and result (`expert` mode shows no details for successful steps). Text the model writes between steps splits the turn into one block per uninterrupted run of steps; an `ask_user` question stays a visible card outside the block.

Composer features are switched on by props, and each is absent without its prop (no menu, button or key trigger): `slash={{ commands, skills }}` (`/` at the start of the message: a searchable menu with source chips; a command runs `run({ setText, text })`, a skill inserts a `/skill-name ` token), `mentions={{ search }}` (`@` picker, composer chips, styled mentions in sent messages; the mention is plain text for the model), `attachments={{ accept, upload }}` (attach, paste and drop; a returned `path` becomes an `@path` mention, a returned `image` a native image attachment; progress and failure chips), `model={{ options, change }}` and `effort={{ options, change }}` (compact pickers showing the view's `pi.agent` model and thinking level; disabled while a change is in flight; a rejected `change` shows its message inline). With `createRemoteChat()` use `remote.configure` inside `change` and throw on a refusal. The studio wires these per demo (`examples/studio/demos/index.mjs`).

The tokens (`--background`, `--foreground`, `--muted`, `--border`, `--ring`, `--primary`, `--destructive`, `--radius` and the `--color-*`/`--radius-*` bindings) are the `theme` item; see [Theme and Tailwind](#theme-and-tailwind). The item's `css` adds only `@layer base` rules scoped to `.pi-chat`, the shimmer and caret rules and their keyframes; it needs no preflight.

Markdown output stays inert: raw HTML is text, images are alt text and only plain `http(s)` links render. `test/contracts/pi-chat-source.test.mjs` compiles the source and checks that, plus the row model. The studio (`examples/studio`) renders this item and the studio scenarios (`examples/studio/scenarios/chat-basics.mjs` and the others) drive it in a real browser. Local tarball installation of the chat blocks through the shadcn CLI is not covered by `test:registry-consumer`; `test:app-registry-consumer` installs `pi-app` and with it `pi-chat`, `pi-workspace` and `viewers` (see [pi-app](#whole-agent-app-pi-app-agentworkspace)).

## Theme and Tailwind

The `theme` item (`registry:theme`) is the one source of the shadcn tokens: `cssVars.light`, `cssVars.dark` and the Tailwind v4 bindings in `cssVars.theme`. Every Tailwind item depends on it, so `shadcn add` merges the tokens into the app's CSS file (light on `:root`, dark on `.dark`, bindings in `@theme inline`) and keeps any token the host already defines; the host's theme wins. The examples compile the same values: `themeCss()` in `examples/studio/tailwind.mjs` renders the item (dark under `prefers-color-scheme`), and `scripts/check-registry-blocks.mjs` plus `test/contracts/registry-source.test.mjs` keep the item complete.

A consumer needs only Tailwind v4's standard build, nothing from this repository:

1. Tailwind v4 through its Vite plugin (`@tailwindcss/vite`, already set up by `shadcn init -t vite`) or its CLI (`npx @tailwindcss/cli -i src/index.css -o dist/app.css`).
2. `src/index.css` starts with `@import "tailwindcss";` and holds the tokens the CLI merged in.
3. Sources: Tailwind's automatic detection scans the project, which includes the installed `src/components/` folders. When the components live outside the scanned base (a monorepo package, a folder in `.gitignore`), add `@source "../path/to/components";` after the import.
4. Dark mode is the `.dark` class (`@custom-variant dark (&:is(.dark *))`, added by the CLI). For the system setting instead, put the `.dark` tokens under `@media (prefers-color-scheme: dark) { :root { ... } }` as the studio does.

`examples/studio/tailwind.mjs` is this repository's library-API build for the examples (no CLI, no PostCSS, only the theme and utilities layers because preflight would restyle the viewer panels); it is not part of an installation.

## Ambient agent (`pi-ambient`: `AmbientChat`, `AgentNotifications`)

The `pi-ambient` block (`pi-ambient/ambient.tsx`, `notifications.tsx`, `browser-notify.ts`; contrast-variant CSS) installs an agent that sits beside an existing website instead of owning the page (see `docs/architecture/WEBSITE-INTEGRATION.md`). `AmbientChat` is a compact floating bar docked at the bottom right; the host page stays fully usable under it. It is driven by the same `NativeChatController` and the same building blocks as `PiChat` (one `useChatSession` hook in `session.tsx` owns sending, queue Steer/edit/remove, uploads, pickers and rows for both), so `slash`, `mentions`, `attachments`, `model`, `effort`, `conversations`, `actions` and `artifacts` are the same config objects.

```tsx
import { AmbientChat, createNotificationStore, watchConversation } from '@/components/pi-ambient/ambient';

const store = createNotificationStore();            // optional: share it to feed toasts for background tasks
<AmbientChat
  controller={controller}                           // from createNativeChatController(...)
  actions={{ answer, withdraw }}                    // from createRemoteChat()
  labels={{ title: 'Console assistant', placeholder: 'Ask the console' }}  // every word, over defaultAmbientLabels
  headerActions={[{ id: 'help', label: 'Help', icon: LifeBuoyIcon, onSelect: openHelp }]}  // buttons in the bar
  conversations={{ items, activeId, onSelect, onNew }}  // the title's ⌄ switches conversations or tasks
  notifications={store}
  tools={<MyVoiceButton />}                         // host slot in the composer row (a mic belongs here, see below)
  onOpenFull={id => openFullChat(id)}               // adds "Open in full chat" to replies
  artifactPanel={(artifact, api) => <MyViewer artifact={artifact} {...api} />}  // artifact cards open inside the window (see below)
  artifacts={{ open: showInMyViewer }}              // used instead when artifactTarget="host"
/>
// A conversation the host keeps connected in the background (a task, a subagent):
const stop = watchConversation(otherController, store, { conversationId: 'task-7', title: 'Nightly export' });
```

States: `bar` (title row with minimise, a spinner while working and a check when done, ⌄ and a drag grip; queued prompts as a tab tucked behind the composer; the composer row, which is the same `Composer` as `PiChat`'s in its one-row layout: paperclip, `/` and `@` menus typed in the input, which reads "Working for 40s" while the agent runs and "Do anything" when idle, model and effort pickers as icons (the brain for effort), host slots and one round Send/Stop button), `expanded` (the same window grown upward in place: the shared transcript with Markdown replies, the activity block, answerable `ask_user` cards, artifact cards, and per reply copy, optional feedback, "open in full chat" and the time; height follows the content up to 70% of the viewport, then scrolls) and `minimized` (a pill with the spinner, the title and an unread dot). Click the title or a toast to expand, minimise to step back down (bar, then pill), Escape returns from the window to the bar. `state` and `onStateChange` control it; `defaultState` starts it. The window stays alive while the host switches conversation.

Placement: offsets from the bottom right corner, shared by the bar, the window and the pill, remembered for the browser session under `storageKey`. The grip (in the header and at the left of the pill) drags it; the whole pill drags too once the pointer moves 4px, so a plain click still restores it. With the grip focused, arrow keys move it (Shift for bigger steps) and Home returns it to the default corner. The position is clamped to the viewport on every render (also when the window is resized or grows), so the agent UI can never be off screen. On a phone (below 640px) the bar and the pill are docked at the bottom with no dragging, and the window is a full-height sheet. `variant="contrast"` (default) is a dark window on any page: the item's css re-binds the shadcn tokens on `.pi-chat.pi-ambient[data-variant="contrast"]`, so every reused part follows. `variant="surface"` uses the host's tokens, light or dark.

Artifacts: with `artifactPanel` (a render function the host writes with the viewer registry, see `examples/ambient/artifact-panel.jsx`), clicking an artifact card opens it inside the window. The window widens (up to 72rem, at most the viewport) into the chat on the left and the panel on the right, using `ArtifactWorkspace` (draggable divider, width remembered, full screen that covers the viewport, a full-screen sheet on a phone). The panel gets `{ fullscreen, onFullscreenChange, close, versions, follow, select }` for the viewer bar and the version history; it reads through the host's own resource client. Escape steps back: full screen, then the artifact, then the window. `artifactTarget="host"` calls `artifacts.open` instead, for hosts with their own viewer.

`AgentNotifications` is a polite live region of toasts (status icon, title, a one-line summary of the final reply, close). `AmbientChat` feeds its store when its own run finishes, fails (toast kind `error`) or waits for an answer (`input`, never auto-dismissed, taken back when answered); a toast is not raised while the window is open on that conversation. A host pushes events for anything else with `store.push({ kind, title, summary, conversationId })`, or lets `watchConversation` do it. `autoDismissMs` (default 8000, 0 keeps them), `maxToasts`, hover and focus pause the timer, Escape closes the focused toast; a click opens that conversation (`conversations.onSelect`, then the window expands). With `systemNotifications`, a bell in the header asks for browser notification permission only when the person clicks it, and a system notification is shown only while the page is hidden, so a host whose connection feeds the store passes `pauseWhenHidden: false` to `createRemoteChat` (by default the stream pauses while hidden and nothing would arrive); `browser-notify.ts` is the one file that touches `Notification`, feature-detects it and never asks on load.

Secure-context capabilities are the host's: the voice button in the screenshots needs `getUserMedia`, which exists only on HTTPS or localhost, so it is a `tools` slot and not part of the component. `examples/ambient/mic.mjs` shows the guarded pattern (no button where it is missing); `npm run check` fails any other use of `Notification`, `getUserMedia` or `navigator.mediaDevices` in browser-reachable code.

`pi-chat` ships the microphone button itself: `VoiceInput` (`pi-chat/voice-input.tsx`) is the `tools` slot of `PiChat` or `AmbientChat` (`tools={<VoiceInput controller={controller} transcribe={transcribe} />}`). The first click asks for the microphone (`createVoiceCapture` of `@hachej/boring-feedback/page`, opened only from that click), the second stops and calls `transcribe(audio: Blob, signal)`, and the trimmed text is appended to the composer draft. It is never sent: the person reads it and presses Send. A cancel control shows while recording; cancel, a stop that fails, or unmounting releases the microphone and drops any transcription in flight. A refused microphone says what to do (blocked, none found, busy, insecure page) in the chat's own words (`voiceDenied`, `voiceNoMicrophone` and the rest in `labels.ts` and `labels-fr.ts`). Speech-to-text is the host's: `transcribe` posts the Blob to the host's own endpoint.


The queue (`queue.tsx`, shared by `PiChat` and `AmbientChat`) is one slim row per message in a tab tucked behind the composer's top edge: queue icon, one-line text, `Steer`, remove and a "…" menu with Edit (all at least 40px on a phone). The composer parity (paperclip, `/`, `@`, model, effort) is one `Composer` component with a one-row and a two-row layout, not two implementations.

`examples/ambient` is a fictional settings console with the bar over it, a durable agent (artifact tools, `ask_user`, one slow tool) and a background task button (`?view=full` renders a `PiChat` with the same composer config, `?artifacts=host` the host-viewer handoff): `npm run ambient`, and `npm run ambient:journey` for the real-browser, real-model journey with screenshots under `.cache/evidence/ambient/`.

## Viewers (`viewers`)

One Tailwind item (owned source, shadcn tokens, light and dark, 44px targets on coarse pointers) with the standard viewer top bar and the panes over it. Every pane borrows a host-owned controller or takes bytes, and shows the same bar: title and subtitle, a status chip (Saved, Unsaved, Saving, Changed elsewhere, Read-only), viewer controls, then the standard actions, each present only when its handler is supplied: Refresh, Share, Copy, Download, Open in new tab, Close. On a narrow bar Copy, Download and Open move into an overflow menu.

| Part | File |
| --- | --- |
| Bar (`ViewerFrame`, `ViewerToggle`, `ViewerIconButton`): always one row; title and facts, icon-only mode toggle with tooltips, Save only while there are edits, a status dot only when not "Saved" (read-only is a word in the subtitle), then Share, full screen and Close; Reload, Copy, Download, Open in new tab and viewer extras sit in the "…" menu (a bottom sheet on a phone) | `viewer-frame.tsx` |
| Menu (`ViewerMenu`, `ViewerVersions`): the shared `ActionMenu` of the `button` item (icon trigger, `menu` roles, arrow keys, Home/End, Escape returning focus); `ViewerVersions` is the version history (newest first, latest marked, current checked) | `menu.tsx` |
| Words, icons, the window (`ViewerWindowProvider` `{ fullscreen, onFullscreenChange, actions, labels, icons }`, `defaultViewerLabels`, `defaultViewerIcons`): for example `<ViewerWindowProvider value={{ labels: { share: 'Partager' }, actions: [{ id: 'pin', label: 'Pin', icon: PinIcon, onSelect: pin }] }}>` around any viewer | `viewer-window.ts` |
| Share: `createLinkShare(link)` uses the Web Share API, otherwise copies the link and the bar says "Link copied"; plain-HTTP origins lack `navigator.clipboard`, so `copyText` falls back to `execCommand('copy')`, and if the browser allows no copy at all the bar shows the link selected for a manual copy. A frame shown only while a file or artifact version loads offers no Share: the pane that shows it brings its own frame, which replaces (remounts) the loading one, and a notice set on the old frame would be lost | `share.ts`, `utils/utils.ts` of the `utils` item (`copyText`, `ManualCopyError`) |
| Markdown editor with toolbar, prose styling, Rich/Source toggle, Save | `markdown-pane.tsx` (over `@hachej/boring-ui-kit/markdown-editor`) |
| HTML preview and source; passive preview by default, optional interactive preview (below) | `html-pane.tsx` (over `@hachej/boring-ui-kit/html-viewer`), `interactive-html.tsx` |
| Image viewer: fit, zoom, pan, checkerboard; every type through an `<img>` from an object URL | `image-pane.tsx` |
| PDF viewer: the browser's own viewer in a frame over an object URL, a Download fallback where there is none | `pdf-pane.tsx` |

Refresh runs the controller's own refresh for editable panes, so unsaved edits are kept and shown as "Changed elsewhere". Rich Markdown editing is offered only when the document survives a parse and serialise round trip unchanged; otherwise it opens as source with a notice. The canvas is not a pane: wrap tldraw's editor in `ViewerFrame` (see `examples/studio/panels/canvas.jsx`). `viewers.css` is the source of the item's `css`; run `node registry/viewers/build-css.mjs` after editing it.

### Interactive HTML preview (host opt-in)

By default the HTML preview is the passive, sanitised rendering of `@hachej/boring-ui-kit/html-viewer` (scripts, attributes and external resources removed, `sandbox=""`). A host can pass `interactive={{ scriptSources: [...] }}` to `HtmlPane`; the Preview view is then the page itself, running, and the Preview | Source toggle stays the only mode switch (a Reload button, or pressing Preview again, loads the page again). Nothing changes without the option.

What is isolated: the page runs in `<iframe sandbox="allow-scripts" allow="" referrerpolicy="no-referrer" srcdoc>`. There is no `allow-same-origin`, so the page has an opaque origin (no cookies, `localStorage` or access to the host page), and no top navigation, popups, forms, downloads or modals; `allow=""` withholds camera, microphone, location and other powerful features. A `<meta http-equiv="Content-Security-Policy">` is injected first in the document: `default-src 'none'; script-src 'unsafe-inline' <origins>; style-src 'unsafe-inline' <origins>; img-src data: blob:; font-src data: <origins>; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'`. What egress is allowed: only loading scripts, styles and fonts from the host's `scriptSources` (HTTPS origins; anything else is dropped, so the list cannot inject directives). The page cannot make requests (fetch, XHR, WebSocket), embed frames or load images from the web. The studio allows `https://cdnjs.cloudflare.com` and `https://cdn.jsdelivr.net`; pinning library versions is the page's responsibility (the studio's artifact agent is told to use exact versions).

This is trusted-host opt-in for untrusted content, not a claim of qualification: the acceptance row A12 (content refused or isolated; declared CSP and egress enforced) is not claimed for it. A third-party CDN script runs with the page's privileges inside the sandbox, and a compromised or unpinned library can draw anything on the page.

## Feedback (`feedback`)

`FeedbackBar`, `NoteBubble`, `FeedbackChip` (with `FeedbackReview`) and `useComposerFeedback` (`feedback-session.tsx`, over `createFeedbackSession` from `@hachej/boring-feedback/ui`), `PickerOverlay` (styles and `usePickerOverlay`), and the optional Release 1 components `PointButton`, `AnnotateSheet`, `FeedbackList` and `FeedbackReport` (not mounted by default) install into `components/feedback/`. They import React, React DOM (the review is a portal) and `@hachej/boring-feedback/format`, `/page` and `/ui` directly: picking, masking, anchoring and placement stay in the package, so restyling cannot weaken them. CSS is plain and scoped to `[data-boring="feedback"]`, reading the host's shadcn tokens through `--boring-feedback-*` variables; the overlay lives in a shadow root and takes the `pickerOverlayStyles` string, with `box`, `label` and `toolbar` parts. `registry/feedback/feedback.css` is the source of the item's `css` (`node scripts/build-feedback-css.mjs`). Save appears only when the host passes a save endpoint (`fetchSaveEndpoint` over its own authenticated route); Show works only in the application page itself. `examples/feedback` mounts the composer UX on a fictional page, and the Release 1 surfaces with `?ui=classic` (`npm run feedback`, `npm run feedback:journey`, `npm run feedback:journey:picker`), and `npm run test:feedback-registry-consumer` installs the item with the pinned CLI.

## Task-list viewer

`task-list-viewer` installs the consumer-owned domain, controller and React renderer. It uses `@hachej/boring-ui-kit/text-buffer` and public resource contracts. The host parses the `fictional.task-list` version 1 descriptor with `createTaskListFeature(options)`, then passes its concrete controller to `TaskListViewer`. Descriptors select the already-bound source and carry no access credentials. No core file-type switch changes are required for this direct host composition.

The renderer supports task creation, completion, removal, exact Save, Refresh, Discard, receipt Reconcile and explicit Abandon save. The host owns controller disposal and its resource client. New documents remain local until Save. A concurrent native save leaves a human draft intact and makes a stale human save conflict.

`examples/shared/task-list-tools.mjs` separately registers native `read_task_list` and `edit_task_list` tools. Supply a resolver with the original binding ID, target, current access and public reader/publisher/lookup capabilities. A binding ID identifies a provider incarnation and must change when that authority changes. The tools retain publication intent in native task memo state and recover attempted saves by lookup only. Installing the React recipe does not register tools or grant authorization.

Run `npm run test:task-list-registry-consumer` after building the packages. It uses the pinned shadcn CLI, built item JSON and isolated package tarballs; checks strict declarations and browser imports; drives and restyles the installed component; then exercises the native tools and six SQLite SIGKILL cases against that installed domain/controller source. `npm run task-list:journey` drives Chromium through an authenticated local HTTP bridge, including concurrent saves and an independent Markdown provider. Loopback-restricted environments cannot qualify that browser journey. Hosted registry discovery, live identity and full A43/A46 remain separate qualifications.

## File tree

Install `file-tree.json` for portable `FileTree` and `FileTreeView` wrappers.
The renderer adapts shadcn `sidebar-11`; the recipe imports its scoped stylesheet.
It can mount in a detached window without the workspace layout. Pass the concrete
`revisionProvider` from the [files guide](../packages/files/README.md#frontend-revision-provider).
The `pi-app` recipe accepts the same binding and supplies the tree, `@` filename
search and attachment uploads. See the [UI guide](../packages/ui/README.md#file-tree-and-filename-mentions)
for publication, navigation and lifecycle behavior. `npm run file-tree:journey`
drives the fictional SQLite-backed browser fixture; `npm run
test:app-registry-consumer` installs the recipes in an isolated consumer.

The default `pi-app` left pane includes Library when `revisionProvider` is bound.
Library displays the tree in the center; selecting a file opens the right artifact
viewer and keeps unsaved-change protection. Chat remains mounted across switches.
`libraryPlacement="pane"` shows the Library in the left pane instead: a tab beside
the conversations, or the whole pane on a single-session page without
`conversations` (a bot with one conversation). `agents={{ items, activeId, onSelect }}`
adds an agent switcher at the top of the pane when there are two or more agents;
the host scopes the conversations and controller to the chosen one.
`locale="fr"` (on `AgentWorkspace`, or `PiChat` alone) switches every word of the chat,
the panes, the viewers and the Library to French; English stays the default. The French
words are exported (`frenchChatLabels`, `frenchAppLabels`, `frenchFileTreeLabels`) and typed
like the English ones, and `labels` / `chat.labels` still override any word.
`fileTree={{ upload: false, history: false, refreshKey }}` hides the Library's Upload and
History buttons and reloads it when `refreshKey` changes.
`chat={{ showHistory: false, showConnectionStatus: false }}` hides the chat header's
History button and connection badge (defaults keep both), and `chat.tools` puts host
controls such as a microphone at the end of the composer bar.
`onUnsavedChange` reports an open file's unsaved changes, so a host can ask before
it switches workspace or identity. Chat attachments are saved as
`uploads/<name>-<8 hex>.<ext>`, so a second pasted `image.png` never collides.
