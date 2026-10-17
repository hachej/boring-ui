# Viewer source recipes

The `markdown-editor` and `html-viewer` items copy thin React wrappers and scoped CSS into a host application. They preserve concrete controller props and borrow the host's controller. Unmounting a wrapper leaves its controller alive.

| Item | Public renderer | Controller |
| --- | --- | --- |
| `markdown-editor` | `@hachej/boring-ui-kit/markdown-editor` | `MarkdownController` from `@hachej/boring-ui-kit/markdown` |
| `html-viewer` | `@hachej/boring-ui-kit/html-viewer` | `HtmlController` from `@hachej/boring-ui-kit/html` |
| `pi-chat` | copied source in `components/pi-chat/` | `NativeChatController` from `@hachej/boring-ui-kit/native-chat` |
| `pi-ambient` | copied source in `components/pi-ambient/` | the same `NativeChatController` as `pi-chat` |
| `pi-workspace` | copied source in `components/pi-workspace/` | none: layout driven by props |
| `dock` | copied source in `components/dock/` | none: `Dock`, `DockLayout`, `DockMain` (re-exported by `pi-workspace/dock`; the app shell installs it) |
| `pi-app` | copied source in `components/pi-app/` | the agent page; viewers over one resource client (`useRemoteChat` lives in `pi-chat` and is re-exported) |
| `documents` | copied source in `components/documents/` | none: the Library, a file and its revisions over one `revisionProvider`; `DocumentSheet` for one document over the app |
| `provider-setup` | copied source in `components/provider-setup/` | none: props and callbacks only |
| `theme` | the shadcn tokens (light, dark) and their `@theme inline` bindings, merged into the host's CSS | none |
| `utils`, `button` | `cn`/`copyText` and the host-action adapters in `components/button/actions.tsx`; controls come from the consumer's `components/ui/` | none |

## Blocks: what to install

`pi-chat` is the chat and nothing else. `pi-ambient` and `pi-workspace` are optional blocks over it; install only what the page needs. A block imports its dependency by the installed sibling folder (`../pi-chat/rows`, `../utils/utils`, `../button/actions`), so there is one copy of each helper, and `scripts/check-registry-blocks.mjs` (in `npm run check`) fails if `pi-chat` imports a block, `pi-workspace` imports `pi-ambient`, a source file is not listed in its item, a file's type or target is off, two items ship the same file name, or any import cycle exists in a block or a package's sources (type-only and lazy imports count; it prints the cycle's path).

Item and file types follow the shadcn schema: the multi-file chat items are `registry:block`, the viewer wrappers and component sets `registry:component`, the host-action adapters `registry:component`, the shared helpers `registry:lib`, the tokens `registry:theme`. Within an item a `.tsx` file is `registry:component`, a `use*.ts` file (and `pi-ambient/browser-notify.ts`) is `registry:hook`, and any other `.ts` file is `registry:lib`. Every file has the target `components/<item>/<file>`, so the installed folders mirror `registry/` (the Markdown and HTML wrappers land in `components/markdown-editor/markdown-editor.tsx` and `components/html-viewer/html-viewer.tsx`, the preview banner in `components/feedback-preview/`).

| Block | Install | Pick it when |
| --- | --- | --- |
| `pi-chat` | `npx shadcn@4.21.4 add <registry>/theme.json <registry>/pi-chat.json` (drop `theme.json` when the host already defines the shadcn tokens) | you lay out the page yourself and only need the conversation (`PiChat`) |
| `pi-ambient` | `... add <registry>/pi-ambient.json` (also installs `pi-chat` and `pi-workspace`) | an agent sits beside an existing site: `AmbientChat` bar and `AgentNotifications` toasts |
| `pi-workspace` | `... add <registry>/pi-workspace.json` (also installs `pi-chat`) | the page is the chat plus a resizable artifact panel (`ArtifactWorkspace`); add `viewers` for the panel contents and `pi-ambient` for float-when-narrow |
| `pi-app` | `... add <registry>/pi-app.json` (also installs `pi-chat`, `pi-workspace` and `viewers`) | the page is a whole agent app: sessions, chat and artifact viewers in one `AgentWorkspace` (see [below](#whole-agent-app-pi-app-agentworkspace)) |
| `app-shell` | `... add <registry>/app-shell.json` (also installs `pi-chat`, `feedback` and pinned `drawer` and `dropdown-menu` recipes plus the shadcn `sidebar` and `avatar` of your own style; add `<registry>/theme.json` too when the host has no shadcn tokens) | one agent above any app: a bottom drawer with peek, half and full on a phone, a right panel on a wide screen (see [below](#agent-layer-app-shell)) |

Registry blocks support the shadcn **Base UI style only**. Only the `base-nova` style is supported. Viewer, Library and shared chat menus use the consumer's real `@/components/ui/dropdown-menu`, declared as the bare `dropdown-menu` registry dependency. `ActionMenu` only maps actions and metadata to that component; it owns no menu positioning, focus loop or visual primitive. The consumer's shadcn components supply appearance and interaction. `npm run test:app-registry-consumer` installs and strictly checks Base UI, including Library controls, portalled viewer/version menus and the phone files drawer. Ordinary buttons and icon actions import the consumer's `@/components/ui/button` directly. Pressed actions use `@/components/ui/toggle`; the compact account theme uses `@/components/ui/switch`. Their bare registry dependencies install the consumer's components. `button/actions.tsx` adapts host actions, not visual primitives. Lists (conversation history, sessions, Library tree, documents' revisions, empty states) compose the consumer's `sidebar` menu, `input-group`, `popover`, `scroll-area`, `collapsible`, `empty` and `separator`; the packaged tree (`@hachej/boring-ui-kit/file-tree-view`) takes them through its `components` prop and ships layout CSS only. Other component groups remain tracked in `scripts/design-groups.json`.

Tokens: `pi-ambient`, `pi-workspace`, `pi-app`, `viewers`, `provider-setup` and `file-tree` depend on `theme` (directly or through a block), so `shadcn add` merges the tokens into the app's CSS file. `pi-chat`, `button`, `dock`, `feedback` and `app-shell` do not: they use the host's shadcn tokens (`background`, `foreground`, `muted`, `primary`, `border`, `ring`, `destructive` and the rest) and their own layout, and they install no global tokens. A host that has those tokens changes nothing. A host without them must also install `theme.json` (`npx shadcn@4.21.4 add <registry>/theme.json <registry>/<block>.json`), or those items render with semantic colours and focus styling missing (dock's resize indicator loses its colour). The blocks import `cn` from `utils` and controls directly from the consumer's `components/ui/`; the CLI installs each dependency once. `registry.json` owns the current file lists. Theme-carrying installs merge the theme tokens into CSS and keep tokens the host already defines.

`<registry>` is wherever `public/r/` is served. Items name their registry dependencies as absolute URLs of their own release (`<registry>/pi-chat.json`, `<registry>/pi-workspace.json`), so no `registries` line is needed in `components.json`. `pi-ambient` needs `pi-workspace` because the ambient window opens artifacts in the same panel layout; `pi-workspace` never needs `pi-ambient` (the host chooses to render `AmbientChat` when the chat floats). Examples: [`lab/studio`](../lab/studio/README.md) assembles every block; [`examples/ambient`](../examples/ambient/README.md) uses `pi-chat` and `pi-ambient` only.

## Artifact cards in `pi-chat`

Pass `artifacts={{ open, isOpen?, detect? }}` to `PiChat` and a tool result whose JSON text carries a valid `boring.artifact` descriptor (the result of `present`) becomes a card outside the activity block: icon, title, type, a real button calling `open` (and the version number for a descriptor that has one; a presented file's descriptor points at the file and has none). A running `present` shows an opening card, a failed call shows none, and presenting one file several times in a turn shows its last version once. The host owns the panel; `collectArtifacts(view, detect)` lists the versions a conversation produced. The copied `artifact.ts` repeats the descriptor validator of `@hachej/boring-agent/artifacts` because a registry item cannot import it; a source test keeps them equal. The item is also usable in a narrow container: touch targets of at least 40px on small or coarse-pointer screens, 16px composer text, Enter inserts a newline on touch devices, and pickers and menus open as a bottom sheet or full-width popover.

## File cards and paste-to-file in `pi-chat`

A sent message that mentions an upload (`@uploads/<path>`, what `attachments` saves) shows the file as a card above its text bubble (`message-files`; each card is a `message-file` item holding a `message-mention` element, the id the chip had, so a journey that clicks a sent mention still finds it). The card's icon follows the extension (`fileKind` in `config.ts`: image, PDF, spreadsheet, presentation, document, otherwise file), its label is `labels.fileKind`, and the name drops the random suffix the upload adds. An image card shows a thumbnail when `mentions.preview(path, signal)` returns its bytes (`{ mimeType, data }` base64); the host reads them through its own provider, and only png, jpeg, gif and webp are drawn. The mention is removed from the drawn text only; the message content and the transcript keep it. Clicking a card calls `onOpenFile(path)`; without it, `mentions.open(path)` (the chip's opener, so a host that set it keeps the click). With neither, the card is a plain element. Other mentions keep their chip.

`pasteToFile` (default `{ minChars: 2000, minLines: 40 }`, more than either) turns a long paste into an upload through `attachments`: the file is `Pasted text <time>.md` (or `.txt`, or the French name), shown as a pending card in the composer. Its restore button (also on a failed upload) abandons the upload and puts the pasted text back where it was pasted, inserting it without deleting what was typed since; a paste over a selection removes the selection at once. Ctrl+Z does the same only while the message text is still what it was right after the paste. When the upload finishes its mention is in the composer, and Send references it like any attachment. Without `attachments` a paste stays inline. The host's `accept` still applies to the saved file, so a host whose picker refuses `.md` and `.txt` refuses pasted text too.

`fileChanges` on `PiChat` or `AmbientChat` opts into the same file-card renderer for successful native `write` and `edit` calls with a `path`. One card per path appears below the reply, outside collapsed activity, labelled Created for `write` or Edited for `edit`. A write followed by edits stays Created. Failed, pending and unrelated calls show no file card. Clicking uses `onOpenFile`, falling back to `mentions.open`; without either, the card is not clickable. This is a view of native tool results, not publication evidence or a pinned revision. It is off by default because a host's tools named `write` or `edit` need not operate on workspace files. The workspace demo enables it.

## Shared chat and file header

`PiChat header={false}` omits its built-in header so a host can render its own row. The default remains `true`. `ViewerWindowProvider value={{ renderHeader: header => createPortal(header, target) }}` moves the existing viewer bar into a host row, including its menu, status and editor controls. Without `renderHeader`, each viewer keeps its bar above its body.

`ViewerWindowProvider value={{ headerLayout: 'stacked' }}` keeps a compact, left-aligned title and facts with the menu and Close on one row, and places viewer controls directly below in the same frame. The default `inline` layout is unchanged. The workspace demo uses `stacked` inside `ArtifactWorkspace variant="inset"`, with 44px header targets. It does not portal the file header outside its card.

## Reply footer in `pi-chat`

Pass `replyFooter={reply => <small>…</small>}` to `PiChat` or `AmbientChat` and every finished reply gets that node under its actions, including earlier replies in the same transcript. Archived replies keep passive copy and footer content, but cannot revive question answers, fork controls or host mutation actions. `reply` is the
same `ReplyRef` `messageActions` receives, now with `timestamp` (the last model round's message timestamp, ms), `model`
(`{provider, modelId}` as that message names them, so it is the model that really answered after a fallback, even when that last round
shows nothing) and `durationMs` (Pi's own `AssistantMessage.durationMs`: how long the last round took to answer, excluding queue time, earlier rounds, tools and retry delays;
absent for messages written before Pi recorded it; never computed at render). The host decides who sees it (for example only the editors of the app).
Not rendered while the reply streams, runs a tool or waits to retry.

## Approval cards in `pi-chat`

Pass `actions.answer` to `PiChat`. A call to a tool wrapped with `requireApproval` from `@hachej/boring-agent/approval` shows an Approve / Deny card while it waits: the wrapper publishes a one-line summary under `APPROVAL_DETAILS` in the call's details, which is how `derive` recognizes it (no list of tool names); the person's click goes through `actions.answer`, the same operation as `ask_user` questions. The card shows the summary as the headline and folds the raw arguments under an "Arguments" disclosure. A denied call (a result starting `Denied by the person.`) shows as denied, any other result as approved, and the call stays a step of the activity block. Without `actions.answer` the card is read-only.

## `provider-setup`

`ProviderSetup` is a Tailwind popover for model access. It never fetches: the host passes `providers` (`{ id, name, models, auth: ('api_key' | 'oauth')[], configured, needsGateway?, loginLabel? }`, whichever providers the host registered), the current `value` (`{ provider, modelId, gateway? }`) and callbacks. `onSave({ provider, modelId, gateway, apiKey? })` may reject with an Error to show its message; `onLogin(providerId)` starts a device-code sign-in whose progress the host passes back as `loginState` (`idle | starting | pending { userCode, verificationUri } | done | failed { message }`). The API key field is masked and shows "saved" when `configured`; a provider with `needsGateway` shows a note and the optional gateway field. Put it in the `controls` slot of `PiChat`; `trigger`, `side`, `align`, `showGateway` and `defaultOpen` adjust it. `@hachej/boring-browser/models` produces the provider list (`catalog()`), and its `createModelAccessHandler` serves the item's routes from a worker (`GET`/`PUT <prefix>`, `POST <prefix>/login`) for one conversation, whose native model is the value. `needsGateway` and the gateway field are for hosts that route some providers through their own proxy; the handler leaves that to the host.

## Feedback cards (`feedback`)

`feedbackRenderTool({ onShowFeedback, onHideFeedback })` is a `renderTool` for `PiChat` or `AmbientChat` (memoize it) that turns results of the opt-in `feedback` tool of `@hachej/boring-feedback/agent` into cards: a `list` result shows each report with its element lines (fallback and `source`) and placements (and says when the store is unprotected), a `show` result is an offer for one element line, and a refused `show` says why. The cards are `inline` chat cards, so they stay in the transcript in expert mode. The tool never reveals anything: hovering or focusing an element line calls the host's `onShowFeedback({ id, anchor, note, intent: 'hover' })` and leaving it `onHideFeedback()`; a click sends `intent: 'click'`, so the host may let the person choose among ambiguous candidates. Only a chat mounted in the subject's application page can give the callback (it resolves and reveals against the live page), and the card shows the outcome it returns inline (`applied`, `stale`, `unavailable` or `denied` with its reason; a throw is `unavailable`). Without the callback the lines are plain text and an offer says `unavailable`: open the application page. The card lives in the `feedback` item (`feedback-card.tsx`), not in `pi-chat`, which never imports `@hachej/boring-feedback`. A report mention (`@feedback/<id>.md`) in a sent message becomes a chip through the chat's generic `mentions.render` hook: pass `mentions={{ search, open, render: feedbackMentionRenderer(open) }}` (`open` optional; without it the chip is not a button). Any other mention keeps pi-chat's default.

`Composer`, `PiChat` and `AmbientChat` take an optional `feedback` prop (`ComposerFeedback`: `annotate`, `active`, `count`, `clear`, `attach`, `sent`; the `feedback` item's `useComposerFeedback(session)` returns it). It adds ONE annotate toggle beside the "+" menu (`labels.annotate`; it arms element targeting on the host's page, or point mode on touch and compact screens, [FEEDBACK.md](../docs/architecture/FEEDBACK.md#ux-one-annotate-toggle)) and, once notes are taken, a count chip with a remove button; Send then calls `attach(text)` for the text to send with the notes attached (a refusal sends nothing and is shown) and `sent()` once the message is accepted. Without the prop the composer renders exactly as before. An `@<root><id>.md` mention of a report in a sent message renders as a feedback chip. The card imports `FEEDBACK_ID` from `@hachej/boring-feedback/format` directly instead of copying the validator, so the item depends on `@hachej/boring-feedback`.

## Changes

**2026-10-14: file cards and paste-to-file in `pi-chat`.** A sent `@uploads/<path>` mention is now a card above the message bubble: its icon or image thumbnail, its name without the upload suffix, and its type (Document, Image, PDF, Spreadsheet, Presentation, File; French: Tableur, Présentation, Fichier). The mention leaves the bubble's text, and the message content keeps it. `PiChat` takes `onOpenFile(path)` (the card is a button only with it), and `mentions.preview(path, signal)` returns an image's bytes for its thumbnail (pi-app reads them through the revision provider). Paste-to-file: a paste over `pasteToFile` (2000 characters or 40 lines by default; `{ minChars, minLines }`) becomes a pending upload named « Texte collé » or « Pasted text » with a timestamp (`.md` when it looks like markdown, else `.txt`), only when `attachments` is given. Its restore button (also on a failed upload) puts the text back in the composer, and Ctrl+Z does so while the text is unchanged since the paste. No change without `attachments`. No new message format; nothing changes for a message without an `uploads/` mention.
**Breaking: group 1 controls use the consumer's shadcn components.** `button/button.tsx`, its `Button`/`IconButton` exports and `ViewerIconButton` are removed. Import `Button` from `@/components/ui/button`; use its native variants and sizes (`quiet` → `ghost`, `bar` → `sm`, `icon-bar` → `icon-sm`). Icon actions retain accessible labels. Pressed actions use `Toggle`, and the compact account theme uses `Switch`. Menu rows and selectable lists/cards remain in their later groups. `ViewerToggle` now maps the existing option props to the host's native ToggleGroup.

**Breaking (2026-10-14): `pi-chat`, `button`, `dock`, `feedback` and `app-shell` no longer install the theme.** Before, `shadcn add` of any of them merged the shadcn tokens and radius steps into the host's CSS. Now they ship no global tokens, so a shell or a standalone block cannot clobber a host's theme. A registry consumer that relied on the automatic tokens (a host with none of its own) must add `<registry>/theme.json` to the same `shadcn add`; a host that already defines the tokens changes nothing.

**Breaking (2026-10-14): one annotate toggle replaces the Feedback block.** The composer showed a Feedback button, « Show in app », and, in feedback mode, a bar (`N notes`, Record, « Ask a general question », Use app, Done, ✕). It is now one annotate toggle and a count chip. `ComposerFeedback` shrank from `{ start?, point?, active?, pending?, chip?, bar?, attach?, sent? }` to `{ annotate, active, count, clear, attach, sent }`; `useComposerFeedback(session, { entry })` is `useComposerFeedback(session)` (touch and compact screens enter point mode by themselves). Replace `feedback.start` and `feedback.point` with `feedback.annotate`, `feedback.pending` with `feedback.count > 0`, and stop reading `chip` and `bar` (the composer draws the count chip; `AmbientChat` no longer docks a bar). `data-testid` `composer-feedback` and `composer-point` are now `composer-annotate`; the chip is `feedback-count`. `labels.feedback`, `feedbackHint`, `point` and `pointHint` are replaced by `annotate`, `annotateHint`, `annotateNotes` and `annotateClear`. `NoteBubble` loses « Ask a general question » and the general-question dialog (a general note is the plain chat; `captureGeneral` and `askGeneral` stay in the session API), gains a mic (`transcribe` prop) and an « Add note » button, and shows the Alt hint on desktop. Run `npx shadcn add` for `pi-chat`, `pi-ambient` and `feedback` again together. Picking, masking and anchoring are unchanged.

## Panel (`pi-workspace`), History and queue (`pi-chat`)

`ArtifactWorkspace` (`pi-workspace/workspace.tsx`) lays out the chat with a right-hand panel: it slides in at full height, the full-height divider resizes it (pointer and arrow keys, width kept for the session; double-click resets it). Both `split` and `inset` keep a quiet 1px `border` seam with a centred 12px hit area. Hover, keyboard focus and dragging strengthen it to 2px in `ring`. Docked agent panels use the same seam, the panel can go full screen (Escape leaves) and below `sheetBelow` it is a full-screen sheet. Opt in with `floatBelow={320}` and the chat can float: dragging the divider until the chat is narrower than that shows a dimmed "Release to float the chat" hint, releasing floats it, Alt+Left on the divider or "Float chat" in the viewer "…" menu (pi-app's `AgentWorkspace` turns `api.floatChat` into one of the `ViewerWindow.actions`, see [host actions](#labels-icons-and-host-actions)) does the same, and the panel takes the full width. `chat` is then a function `({ floating, dock }) => node`: return the docked `PiChat` or, while floating, `<AmbientChat controller={same} onDock={dock} defaultState="expanded" />` with the same props. Both use one controller, so transcript, queue, draft and the single watch stream carry over (`PiChat`/`AmbientChat` only borrow it). Dock returns the chat at the last width above the threshold; the floating state is remembered for the session, closing the panel docks, and the phone sheet ignores it. Off by default. It owns layout only; what is open is the host's, and the viewer inside uses `ViewerFrame`, which shows an Enter/Exit full screen button when wrapped in `ViewerWindowProvider` (viewers item). It is its own block (`pi-workspace`) because it is self-contained and driven by props; the studio uses it for artifacts and workspace files. Pass `conversations={{ items, activeId, onSelect, onNew }}` to `PiChat` and the header History button opens a searchable list of past conversations (the open conversation's persisted records stay reachable at the transcript top, even with `header={false}` or `showHistory={false}`). A message sent while the agent works waits in the queue, where each message offers Steer now, edit and remove (steer and edit need `actions.withdraw`); the composer has no mode toggle. Enter empties the composer at once; a message sent while the previous one is still being confirmed shows as a "Sending" row (the controller's `outbox`) until it is submitted, and a refused message comes back into the composer above what was typed since.

`@` mentions name workspace files; a path with whitespace or a quote is written quoted (`@"docs/Meeting notes.md"`, with `\"` and `\\` escaped), and bare paths keep their form. `mentionToken(path)` writes the text, `pieces` and `mentionedPaths` (the agent package, which must match it) read it back, and the composer chip and `removeMention` treat the quoted form as one token. A bare mention ends at whitespace, so the composer never inserts a bare path that contains a space.

## Docks (`dock`)

`dock/dock.tsx` (the `dock` item; `pi-workspace/dock.tsx` re-exports it, so existing imports keep working) lays out any host content as a row of docks around the app. It is layout only: what a dock shows is the host's, and `ArtifactWorkspace` is unchanged (it keeps its own panel, and the two do not know about each other).

On a wide screen the app shell's agent layer is one of these docks (id `agent`): docked right by default, floatable and dockable left or right from its header, remembered per viewer (local storage under `boring.app-shell`); below 768px it stays the bottom drawer.

- `DockLayout` is the row. It measures its own width, so it works in any container. Props: `storageKey` (default `boring.dock`), `persist` (`session`, default, or `local`), `minMain` (default 360: the main content never gets narrower while docks are beside it), `className`.
- `DockMain` is the host's own content between the docks; it takes the remaining width. While a dock is a `page`, the main stays mounted but is hidden and inert.
- `Dock` is one dock, on the `left` or `right` of `DockMain` (order the children as they appear: left docks, `DockMain`, right docks). Props: `id`, `side`, `children` (a node, or a function of the `DockApi`), `defaultWidth` (400), `minWidth` (280), `floatable`, `dragBelow`, `narrowBelow`, `narrow` (`float`, `sheet` or `hide`; default `float` for a floatable dock, otherwise `hide`), `open`/`defaultOpen`/`onOpenChange` (controlled or not), `defaultFloating`, `defaultPlacement` (`page`, `docked` or `floating`; remembered choices win), `contained` (while docked, the dock is the containing block of its content's fixed overlays: a full-screen sheet, a drawer or a viewer's full screen covers the dock, not the page), `onPlacementChange`, `labels` (`region`, `resize`, `floatHint`, `closeHint`), `className`.
- `useDock(id)` returns the `DockApi` of a dock from anywhere inside the layout, or `undefined` until that dock has rendered: `placement`, `open`, `floating`, `canDock`, `width`, `setPlacement('page' | 'docked' | 'floating')`, `setOpen`, `toggle`, `float`, `dock`, `setWidth` (clamped and remembered like a drag, for example to widen a dock while it shows a document). A button in a chat header can open the files dock; a chat can detach itself.

A dock's `placement` is on `[data-boring=dock][data-dock=<id>][data-placement]`: `page` (fills the main area, including on a phone, without a divider), `docked` (beside the main content, resizable), `floating` (the content stays mounted in a zero-width slot, so a children function renders its own floating surface, for example `AmbientChat`), `sheet` (full screen, only on a narrow layout and only while open) or `closed` (mounted, hidden). Below `narrowBelow` the layout is too narrow to dock: the dock floats, becomes a sheet or is hidden, according to `narrow`.

Each docked dock has a divider on its inner edge (`data-testid=dock-divider-<id>`, `role=separator`). Dragging resizes it, clamped between `minWidth` and the layout width minus `minMain` minus the other docked widths. With `dragBelow`, dragging until the dock would be narrower shows a hint (`data-testid=dock-hint-<id>`) and releasing floats a `floatable` dock or closes any other; the dock keeps the last width above the threshold. Keyboard on the divider: the arrow towards the main content widens and the one away narrows (24px; Shift 96px), Home is `minWidth`, End the maximum, Alt plus the arrow away floats or closes (with `floatable` or `dragBelow`), and double-click resets to `defaultWidth`. Width, placement, floating and open are remembered under `<storageKey>.<id>.width|placement|floating|open`, in `sessionStorage` or, with `persist="local"`, `localStorage`.

An agent chat attached to the left of a host app that floats as `AmbientChat` when detached (the same controller, so the draft and transcript carry over):

```tsx
<DockLayout storageKey="pm">
  <Dock id="chat" side="left" floatable dragBelow={260} narrowBelow={720}>
    {api => api.floating
      ? <AmbientChat controller={controller} variant="surface" defaultState="expanded" onDock={api.dock} />
      : <PiChat controller={controller} />}
  </Dock>
  <DockMain><HostApp /></DockMain>
</DockLayout>
```

Sessions on the left, the chat in the main, and a files explorer on the right that a button in the chat header opens, and that is a full-screen sheet on a phone:

```tsx
function Chat() {
  const files = useDock('files');
  return <PiChat controller={controller} headerActions={[{ id: 'files', label: 'Files', onSelect: () => files?.toggle() }]} />;
}
<DockLayout>
  <Dock id="sessions" side="left" defaultWidth={280} minWidth={200} dragBelow={160}><Sessions /></Dock>
  <DockMain><Chat /></DockMain>
  <Dock id="files" side="right" defaultOpen={false} dragBelow={200} narrowBelow={720} narrow="sheet"><FileExplorer /></Dock>
</DockLayout>
```

[`examples/dock-app`](../examples/dock-app/README.md) is the first composition running (scripted model); its journey drives pointer and keyboard resize, the hint, floating, Dock, the files dock and a 390px phone in a real browser. `test/contracts/pi-workspace-dock-source.test.mjs` checks the item, strict types and the rendered structure; the behaviour above is proven by that journey, not by unit tests.

## Agent layer (`app-shell`)

`AgentLayerProvider` takes `agent` (one assistant) and `improve` (the product manager, shown from the account menu); each is `{ controller, chatProps?, voice?, feedback? }`, a borrowed `NativeChatController` rendered by `PiChat`. `AgentLayer` is placed once; `AgentTrigger` opens it; `useAgentLayer()` gives `{ state, showing, open(which?, at?), close(), expanded }`. Nothing else is configurable (the layer's words: the agent's `chatProps.locale`, then the shell's `locale`, then English). On a phone (below 768px, the shadcn `useIsMobile`) it is the explicitly installed `drawer` recipe (public Base UI) with three fixed snap points: a peek (8rem above the tab bar `--app-shell-tabbar`, one composer row and a line of the last reply, the page stays usable), half and full. A swipe, an outside tap and a lost focus never close it: they go to peek (half without an `agent`), so the coach stays reachable; only the handle and the title row drag, the transcript scrolls; the close button and Back close it; Escape steps it down to peek like a swipe (half without an `agent`), so the coach stays reachable, and at peek there is no close button, so it is closed from half or full; focusing the composer goes to full and keeps it above the soft keyboard. On a wide screen it is the `sidebar` on the right, not modal. `voice` adds push-to-talk (hold the trigger or the hero button; `send: 'auto'` submits the transcript, `'draft'` (default) fills the composer). `useAgentContext({ name, params })` registers the current screen; `useRemoteChat({ ..., requestContext: readAgentContext })` sends it as the submit's `context` (with a `placement` beside it: `PiChat` reports `docked` unless its `placement` prop says otherwise, `AmbientChat` `floating`, and the layer reports `floating` for the phone drawer and the floating panel; see [PAGE-TOOLS.md](../docs/architecture/PAGE-TOOLS.md)) and the host renders it with `createPromptContext` (see `packages/agent/README.md`). `useBackLayer` is the one Back manager (`point < sheet < agent < stack`). Point mode for `improve` is wired: « Montrer dans l’app » hides the sheet and the feedback item's `PointBar` sits above the tab bar. Example and journey: `examples/app-shell/` (`npm run app-shell:journey`); the shadcn components there are pinned fixtures for type-checking only. Reply actions use 44px touch targets.

On phones, the peek strip is the persistent resting state when an `agent` is set: swipe-down, outside tap and Escape step down to peek, and there is no full close from peek (owner ruling 2026-10-14). Apps with only `improve` have no peek.

Host actions: `headerActions` on the `agent` or `improve` spec are icon buttons in the layer's title row, typed as the screen header's `ScreenHeaderAction` (`{ id, label, icon, showLabel?, href?, target?, rel?, onSelect }`). `href` renders a link (`onSelect` still runs on click; `target` and `rel` only when given). Two are shown, the rest in « … » (a sheet on a phone, a menu on a wide screen). They sit before the dock controls on a wide screen, and before Expand and Close on a phone at half and full (none at peek). Test ids: `agent-layer-action-<id>`, `agent-layer-more`.

The screen layout (`AppShell`) takes an optional `locale` (`'en' | 'fr'`) for its own words (« Se déconnecter », « Plus », « Navigation »); the agent's `chatProps.locale` wins when it sets one; otherwise `locale`; otherwise English. The compact tab bar is `role="tablist"` (labelled « Navigation ») with `role="tab"` items (`data-testid="tab-<id>"`); the current one has `aria-selected="true"`, and « Plus » is one more tab when there are more than four screens. Tests locate tabs by these roles. The account sheet is titled « Compte » (the person's name is shown once, in the person block).

The account theme appears when the account gives `theme: { value, onChange }` (`value` is the resolved `'light' | 'dark'`: the host resolves `system`). The compact sheet uses the consumer's Switch. The expanded menu uses its registered DropdownMenuCheckboxItem, preserving arrow-key navigation and close-on-selection. Without `theme` there is no row. The shell's root carries the `app-shell` class in every layout, so the item's css reset (`.app-shell :where(button, [role=button])`) reaches its own header and nav buttons and the popups it portals to the body (the sheets, the account menu, the agent drawer and panel) even without preflight. No wrapper is needed. Vendoring by copying files must also copy the item's `css` into the app's global stylesheet; the files alone leave those buttons unstyled.

`useShellLayer(id)` (`app-shell/shell-layer.ts`) lets a full-screen view of the app (a document sheet, a pushed view) take part in the same one-layer-at-a-time rule: `const { open, close, isOpen } = useShellLayer('documents')`. Opening it closes the agent and product manager layers, and opening either of those closes it; the browser's Back closes it first (the Back manager's `sheet` layer). No `AppShell` prop is added. Any component may call `open`, so a host's handler can open the view; the view's component renders from `isOpen`.

### Changes

- `AppShell` gained the optional `locale` prop, and the account sheet's title is the generic « Compte » instead of the person's name. Hosts that relied on the name as the sheet title will see « Compte » there.

## Whole agent app (`pi-app`: `AgentWorkspace`)

History and Library are independently placeable. `ConversationList` is the searchable history piece shared by the chat's `ConversationHistory` popover and `SessionsPane`. `FileTree` is the Library list over a borrowed revision provider. Both are re-exported from `pi-app/agent-workspace`. A host can render them inside its own nav or keep chat-header popovers. [The workspace demo](../demos/workspace/README.md) places them in icon-anchored top-bar popovers in every agent placement. They need no agent workspace or Dock.

`AgentWorkspace sessions={props => <MyNavigation {...props} />}` replaces its sessions rendering with host navigation. The props are exactly `SessionsPane`'s, including `conversations`, drawer state and Library content when `libraryPlacement="pane"`. Omit `sessions` to retain the existing default. `sessions={false}` leaves navigation to the host and removes the workspace toggle, while `conversations` still supplies Fork to the chat.

`AmbientChat embedded` renders its expanded conversation inline under the host's header. Changing `embedded` preserves the conversation renderer, transcript and composer DOM. The workspace demo keeps this one renderer inside its one `ArtifactWorkspace`; `Dock` changes where the whole workspace sits. Embedded submits report `docked`; floating submits report `floating`. See [placement](../docs/architecture/PAGE-TOOLS.md).

`AgentWorkspace` (`pi-app/agent-workspace.tsx`) is one page: the sessions pane on the left (`sessions.tsx` over `pi-chat`'s `ConversationList`: search, New, rename, archive with the Archived filter, delete; the header toggle hides it, remembered for the session; the toggle stays mounted in the workspace over the chat header, so it keeps working while a switched chat connects and its header is replaced; below `drawerBelow` it is a drawer with a backdrop, closed by Escape or a choice), `PiChat` in the center (scrolling near the top loads the open conversation's persisted records into the same transcript, `historyList={false}`, and replies keep Fork), and on the right the `ArtifactWorkspace` panel with the artifact viewer (`artifact-panel.tsx`: follow the latest or pin a version from the file's history, read-only; Markdown, HTML, SVG, code), the file viewer (`file-viewer.tsx`: Markdown and HTML editable, image, PDF, text) and the host's own views. New artifacts of the open conversation open the panel unless the person closed it in this turn (not on a phone, where the panel is a full-screen sheet). Every prop is data or a callback: `controller`, `conversationId`, `chat` (the other `PiChat` props), `conversations`, `resources` `{ endpoint, fetch, identity, history?, locate? }`, `viewers` (host viewers by type or kind, for example a tldraw canvas), `interactive`, `share`, `opened`/`onOpenedChange` (controlled; `{ kind: 'artifact' | 'file' | <host kind> }`), `panels`, `fileBack`, `floatingChat`, `controls`, `chatTop`, `sheetBelow`, `drawerBelow`, `floatBelow`, `storageKey`. Hooks: `useConversations({ endpoint, fetch, activeId, onSelect, onChange? })` (the sessions list over the conversations handler, polled), `useRemoteChat({ conversationId, endpoint, fetch, identity })` (one controller per conversation over the chat transport) and `useSaved` (a resource's saved text, never replacing unsaved edits). A `present` call that waits for the page (its opt-in acknowledgement, see [the agent README](../packages/agent/README.md)) is answered by `AgentWorkspace` once the built-in artifact or file viewer has mounted the presented revision (`onShown` in `ViewerOptions`): it opens the file, or refuses with `closed by user` (closed this turn), `unsaved changes` or `narrow screen`. A host viewer (`viewers`) reports no mount, so its presented files end `unconfirmed`.

Chat attachments are saved under `uploads/` and reference-only by default (`useRevisionAttachments`, below, gives a bare `PiChat` the same): the message carries each file's `@path` and the agent reads it with its file tools, so no base64 rides along in every later turn. `uploads={{ inlineImages, maxBytes, accept }}` opts back into a native image per png/jpeg/gif/webp (`inlineImages`), refuses larger files before upload with a visible reason (`maxBytes`, labelled by `attachmentTooLarge`), and sets the picker's `accept`. Saved names contain no whitespace, since a mention ends at a space.

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

## Documents (`documents`)

The `documents` item is the workspace's file screen with no page of its own: `Documents` shows the Library (the file tree) as the list (`ListDetail`: beside the file on a wide screen, one pane at a time on a phone), the chosen file in the same viewer the Library opens (editable where it edits), and its Revisions beside it. `<Documents provider={revisionProvider} locale="fr" labels={…} viewers={…} share={…} />`; the provider is the files guide's `connectRevisionProvider` (or a host binding), borrowed and never disposed here.

Revisions are the public `RevisionProvider.history(path)`: one row per retained revision, newest first, with when it was saved and who wrote it (`publish`, `agent` or `observed`), and its revision id. The list is read again when the provider's `changes` feed moves. An older revision opens read-only in the artifact panel's pinned view (text, Markdown and HTML); the newest row returns to the editable file. Images and PDFs have no older-version preview here (the panel says so).

`DocumentSheet` opens one document over the app, for a host's « Voir la fiche »: the host holds the `path` and clears it in `onClose`. `<DocumentSheet provider path onClose onShowAll locale />` is a bottom sheet of the full height that uses `useShellLayer('document')` (one layer at a time, Back closes it), with the viewer and an optional « Toutes les fiches » button that closes the sheet and then calls `onShowAll`.

Not in this item: the Library's own History button and upload (`FileTreeView` is given `upload={false}` and `history={false}`, since the revisions panel is the history). The Library's buttons are 44px on a coarse pointer through the documents item's own CSS, not by changing the file tree.

Words: `documentsLabels(locale, labels)` over `defaultDocumentsLabels` and `frenchDocumentsLabels`, and the viewers' words through the pi-app labels. Journey: `npm run app-shell:journey:documents` (the example's `?documents=1` page: a Fiches screen, and « Voir la fiche » in the product manager's layer).

## Install into a new app (tested with a fresh outside app)

Nothing is published, so a consumer needs a package source for the private `@hachej/boring-*` packages. The first pass at A46 used the steps below in a Vite, React 19 and Tailwind v4 app created by the pinned CLI (`npx shadcn@4.21.4 init -t vite -b base -p nova -n app -y --no-monorepo`).

1. In this repository: `npm ci && npm run build && npm run registry:build`, then `npm pack ./packages/ui ./packages/files ./packages/agent --pack-destination <dir>`.
2. Serve the tarballs as an npm registry for the `@boring` scope (a ten-line static registry that returns a packument with `dist.tarball`, `dist.integrity` and the package's own manifest is enough) and put `@boring:registry=http://127.0.0.1:<port>/` in the app's `.npmrc`. This is required because every item lists `@hachej/boring-ui-kit@0.0.0` as a dependency and the CLI runs `npm install` for it. `file:` tarball specs in `package.json` do not help: the CLI still installs `@hachej/boring-ui-kit@0.0.0` by name.
3. Serve `public/r/` over HTTP and run `npx shadcn@4.21.4 add http://127.0.0.1:<port>/r/pi-chat.json http://127.0.0.1:<port>/r/viewers.json http://127.0.0.1:<port>/r/markdown-editor.json -y`. Files land in `src/components/pi-chat/`, `src/components/viewers/`, `src/components/button/`, `src/components/utils/` and `src/components/markdown-editor/markdown-editor.tsx`; registry dependencies are the published release's jsDelivr URLs, so an unpublished build serves only its own items locally (the consumer harness serves the dependencies too); scoped CSS is merged into the app's CSS file. Re-running with `-o` is idempotent.
4. Install the server side with exact pins: `@hachej/boring-agent`, `@hachej/boring-files`, `react@19.3.0`, `react-dom@19.3.0`, `@earendil-works/pi-durable@1.0.1`, `@earendil-works/pi-ai@1.0.1` and `@earendil-works/chord@1.0.1`. Node 22.19 or newer runs a TypeScript server with `node server/main.ts` (SQLite resources use `node:sqlite`).
5. The shadcn Vite template's `npm run typecheck` is `tsc --noEmit` over a solution file with `"files": []` and checks nothing. Use `tsc -p tsconfig.app.json --noEmit`; the installed source passes the template's `strict`, `noUnusedLocals` and `noUnusedParameters`.

## Build and install

Run `npm run registry:build` with the pinned shadcn 4.21.1 development dependency. The command generates the registry index and the item JSON files under `public/r/` from `registry.json`. The source contract test rebuilds the item and compares its contents.

With the exact package dependencies available through the host's package distribution, run the standard CLI in an existing React application with a valid `components.json`:

```sh
npx shadcn@4.21.4 add /absolute/path/to/public/r/markdown-editor.json
npx shadcn@4.21.4 add /absolute/path/to/public/r/html-viewer.json
```

Version 0.0.0 identifies the local library candidate. This repository does not publish or host the package or registry endpoint. The command above requires that distribution setup before a normal npm install can succeed.

Create a controller through `@hachej/boring-ui-kit/markdown` with the host's resource client and identity. Pass it as `controller` to the copied `MarkdownEditor`. The host owns authentication, publication policy and controller teardown. The wrapper forwards the editor's title, mode, placeholder, className and `onMountedTools` props. The installed recipe repeats mounted selection/navigation tests before and after restyling; see the [mounted command guide](../packages/ui/README.md#mounted-markdown-commands).



## Styling

The contract is [BORING-UI-1](../INVARIANTS.md#boring-ui-1--shadcn-first-blocks-carry-no-visual-value). Blocks compose the consumer's unchanged `@/components/ui/*` components. They add layout, not a second control skin.

Theming contract: an app restyles every block only by setting its theme tokens ([BORING-UI-1](../INVARIANTS.md#boring-ui-1--shadcn-first-blocks-carry-no-visual-value)); no other theming API is supported. Set core tokens following boring-stack's `boring-design-system` skill. Keep derived tokens in the template's derived theme file. Do not override a block's CSS, set `--boring-editor-*` or `--boring-html-*`, or edit copied shadcn components to rebrand a block. `--shell` and `--overlay` are the documented kit-specific tokens. The optional `theme` item supplies defaults only for hosts without a theme.

`MarkdownEditor` and `HtmlViewer` accept `components` bindings for the host's Button, Toggle, Input, Textarea, Separator and selection-bubble Card. The formatting toolbar, the phone formatting bar and the selection bubble are built from them. Their installed recipes and the viewer panes supply these bindings through `button/editor-controls.tsx`. Direct package rendering without bindings retains unstyled native HTML for compatibility. That fallback is not an installed-block design qualification. Controller ownership, save acknowledgements and model input are unchanged.

## Controlled local qualification

```sh
npm run build
npm_config_cache=/absolute/path/to/writable/npm-cache npm run test:registry-consumer
TMPDIR=/var/tmp npm_config_cache=/absolute/path/to/writable/npm-cache npm run test:html-registry-consumer
```

The cache must contain the pinned dependency archives from `package-lock.json`. The recipe uses disposable package installations and the actual shadcn CLI. Its ignored local fixture replaces direct dependency locators with cached tarball paths. It checks original registry archive integrity, embedded package names and versions, and installed versions. Boring archives come from the current public package output and only the item's declared Boring dependencies are packed. Markdown declares its files peer explicitly. Only fixture dependency strings change; committed source pins and generated item contents remain intact.

The fixture selects an empty base color in `components.json` so the host owns its theme and the CLI does not download a color preset. It drives the copied Markdown wrapper through real React, Tiptap and SQLite operations. Chat uses a real native Harness, a fictional streaming provider and native ToolTask execution. The Markdown and HTML recipes repeat these checks after changing the core radius token, without editing copied components. Their browser fixture covers stock and brand themes in both modes at desktop and phone widths. Strict declarations and a browser bundle check physical dependency isolation.

DOM checks do not qualify browser geometry, keyboard behavior or accessibility. This local tarball installation does not qualify hosted registry discovery or npm metadata resolution. Run the chat consumer outside any ancestor application node_modules. Some upstream public declarations probe ancestor paths explicitly; the strict physical isolation guard rejects them. Canvas and agent installation recipes remain separate roadmap work; the consumer task-list recipe is described below. A20 and A46 remain partial.

## HTML source and preview

Pass a host-created `HtmlController` to the copied `HtmlViewer`. Source edits and exact saves use the resource client. The preview reconstructs passive formatting with no source attributes or external resources. Source viewing and saving remain available when parsing, Trusted Types or size limits refuse the preview. See the [UI guide](../packages/ui/README.md#optional-html-source-and-preview) for the exact contract.

The HTML installation fixture repeats public controller/renderer behavior through the copied wrapper, checks native control bindings and core theme tokens, and builds the controller and wrapper together. Its DOM environment does not qualify native template inertness, iframe isolation, CSP, Trusted Types or network behavior. Actual browser qualification remains required.

## Pi chat (Tailwind)

`pi-chat` is the chat product, not a wrapper (the ambient bar and the workspace layout are the separate blocks above): owned, editable Tailwind source under `registry/pi-chat/`. `PiChat({ controller, labels, icons, mode, actions, ... })` subscribes to the headless `NativeChatController` from `@hachej/boring-ui-kit` and renders the native Pi view directly. There is one message model (the Pi view) and no AI SDK: types come from `@earendil-works/pi-durable` and `@earendil-works/pi-ai` as type imports only. The files install into `components/pi-chat/` so they never overwrite a host's own `button` or `utils`.

| Part | File |
| --- | --- |
| Component, scrolling, send/stop/connection state, history paging | `pi-chat.tsx` |
| View to display rows (tool calls paired with results, expert mode, live generation, merged turns) | `rows.ts` |
| Messages, interrupted and failed states, copy response | `message.tsx` |
| Safe Markdown with code block cards | `markdown.tsx`, `code-block.tsx` |
| Nested shadcn Trace lines for activity summaries, tool output and reasoning; shared working-text shimmer | `activity.tsx`, `tool.tsx`, `shimmer.tsx` |
| Composer (auto-growing, Enter/Shift+Enter, IME safe, one Send/Stop button, steer or queue while busy, image chips) | `composer.tsx` |
| Optional composer features: `/` menu (v2 picker port), `@` file picker, model and effort pickers, shared keyboard hook, option types and token helpers | `slash-menu.tsx`, `mention-menu.tsx`, `pickers.tsx`, `picker-keyboard.ts`, `config.ts` |
| Queue read from the view's `pi.inbox` document | `queue.tsx` |
| Remote conversation over the chat transport: `useRemoteChat` (one controller per conversation, the `NativeChatController` of `createRemoteChat`) | `use-remote-chat.ts` |
| Composer draft kept per conversation in localStorage: `useChatDraft(controller, key)` (`PiChat draftKey`) | `use-chat-draft.ts` |
| Human-in-the-loop `ask_user` card | `question-card.tsx` |
| Feedback card: `feedback` list results and offers with hoverable element lines, report mentions | `feedback/feedback-card.tsx` |
| Empty state, conversation list and inline-history sentinel (`Button` comes from the consumer's `components/ui/`, `cn` from `utils`) | `empty-state.tsx`, `history.tsx` |
| Shared chat behaviour for every surface (send, queue actions, uploads, pickers, rows, paged transcript), send/stop notices | `session.tsx`, `notice.tsx` |

A local conversation is one in-process controller, `createNativeChatController({ identity, conversation, context })`; a remote one is `useRemoteChat({ conversationId, endpoint, fetch, identity })`, whose `controller` feeds the same `<PiChat controller={controller} />`. `pi-chat` alone is enough for either: a floating panel needs no workspace and no `pi-app`.

`PiChat draftKey={conversationId}` keeps the half-typed message across reloads and tabs: `useChatDraft(controller, key)` writes the composer's draft (the controller's draft, not a second state) to `localStorage` under `pi-chat:draft:<key>`, restores it when the composer is empty at mount, follows other tabs through the `storage` event, and clears it when the send empties the composer (a refused send puts the text back and it is written again). Storage that is missing or throws only means the draft is not kept. Text already in the composer is saved when persistence starts. A key change with the same controller shows the new conversation's saved draft (or an empty composer), so no text moves across. Without `draftKey` nothing is stored.

Pass `actions={{ answer, withdraw }}` with the matching functions from `createRemoteChat()` (feature-detect them: a transport without them leaves question cards and queued messages read-only). `answer(callId, answer)` resolves to `{ kind: 'answered' }` or a refusal that the card shows inline.
A question or approval card is `data-state="writing"` while the model is still generating its call (options may be partial and nothing can be answered), then `pending` while it waits on the person.

Each uninterrupted run of tool calls and reasoning is a shadcn `Trace`. Its summary expands into steps, and a detailed step expands into arguments and output. Running lines shimmer, failed lines use `error`, and queued user messages use `pending`. Failures open automatically unless the reader has chosen otherwise. `expert` mode keeps successful steps plain and exposes failed output. `developer` mode also exposes successful output and reasoning. Text splits activity runs. Approval, question, artifact, feedback and host `renderTool` cards keep their existing placement outside the activity. `groupTool` still decides which tools join a summary. Nothing changes in native model input.

`pi-chat` declares the bare `trace` built-in and imports `@/components/ui/trace`. The repository's pinned **shadcn@4.21.4** successfully installed the Base UI `base-nova` variant in a disposable app on 2026-10-15. Consumers use only the Base UI `base-nova` style. Re-run `shadcn add` when upgrading the copied chat. No Trace source is vendored into the item. The local demo/typecheck fixtures are CLI output from [the Base UI registry](https://ui.shadcn.com/r/styles/base-nova/trace.json), SHA-256 `8533d800f5216797578f0954bf917aed6b8cd48016f73975c6a4caaf7ab539d4`. The [upstream source revision](https://github.com/shadcn-ui/ui/blob/4233ed1caded8c38f4bc14b14afe1f93ebcaf966/apps/v4/registry/bases/base/ui/trace.tsx) and fixture headers record provenance. The CLI resolves future consumer installs from shadcn's registry, not from this fixture hash.

Trace's native disclosure lifecycle mounts nested lines when expanded. Existing `activity`, `activity-step`, `tool-card`, `tool-details` and `reasoning` test ids remain; journeys must expand a summary before selecting its steps. The chat's scoped CSS supplies the running shimmer and disables it under reduced motion.

The October [Tool, Reasoning, Chain of Thought and Subagent patterns](https://ui.shadcn.com/docs/ai-elements) compose these same Trace parts, so the chat adds no separate pattern wrappers or AI SDK dependency. The new Code Block adds a highlighting dependency and its copy button calls the Clipboard API directly. It does not replace our smaller code block with its insecure-origin fallback and host `onCopy`. Confirmation does not replace durable question-bound approval cards. Queue describes agent todos, not Pi inbox submissions with steer, edit and withdrawal, so only those submissions' presentation becomes a Trace line.

`npm run workspace-demo:journey:trace` drives the workspace demo's real native tools with fictional scripted responses. It checks nested keyboard disclosures and reduced motion, then writes running, done, failed and expanded screenshots in both themes to `.cache/evidence/trace/`.

Composer features are switched on by props, and each is absent without its prop (no menu, button or key trigger): `slash={{ commands, skills }}` (`/` at the start of the message: a searchable menu with source chips; a command runs `run({ setText, text })`, a skill inserts a `/skill-name ` token), `mentions={{ search }}` (`@` picker, composer chips, styled mentions in sent messages; the mention is plain text for the model), `attachments={{ accept, upload }}` (attach, paste and drop; a returned `path` becomes an `@path` mention, a returned `image` a native image attachment; progress and failure chips), `model={{ options, change }}` and `effort={{ options, change }}` (compact pickers showing the view's `pi.agent` model and thinking level; disabled while a change is in flight; a rejected `change` shows its message inline). With `createRemoteChat()` use `remote.configure` inside `change` and throw on a refusal. The studio wires these per demo (`lab/studio/demos/index.mjs`).

The tokens (`--background`, `--foreground`, `--muted`, `--border`, `--ring`, `--primary`, `--destructive`, `--radius` and the `--color-*`/`--radius-*` bindings) are the `theme` item; see [Theme and Tailwind](#theme-and-tailwind). The item's `css` adds only `@layer base` rules scoped to `.pi-chat`, the shimmer and caret rules and their keyframes; it needs no preflight.

Markdown output stays inert: raw HTML is text, images are alt text and only plain `http(s)` links render. `test/contracts/pi-chat-source.test.mjs` compiles the source and checks that, plus the row model. The studio (`lab/studio`) renders this item and the studio scenarios (`lab/studio/scenarios/chat-basics.mjs` and the others) drive it in a real browser. Local tarball installation of the chat blocks through the shadcn CLI is not covered by `test:registry-consumer`; `test:app-registry-consumer` installs `pi-app` and with it `pi-chat`, `pi-workspace` and `viewers` (see [pi-app](#whole-agent-app-pi-app-agentworkspace)).

### Attachments from any revision provider (`useRevisionAttachments`)

`useRevisionAttachments({ revisionProvider, accept, maxBytes, tooLarge, inlineImages, onPreparationFailure })` (`pi-app/use-revision-attachments.ts`) returns the `attachments` config `PiChat` takes, saving each file through the provider under `uploads/` (`uploadRevisionAttachments` in `revision-files.ts`). A file over `maxBytes` is refused before it is read, with `tooLarge` as its reason; a file not matching `accept` (`image/*`, an exact MIME type or `.ext`, comma-separated; an empty list accepts any) is refused with `This file type is not accepted.`. Refused and failed files go to `onPreparationFailure(name, reason)`; an upload that saves nothing rejects with the reason, which the chip shows. Without `fileTree` the hook makes and disposes its own tree controller from the provider; `AgentWorkspace` passes its Library's tree, so the page keeps one. Returns `undefined` until there is a tree.

## Theme and Tailwind

The target contract is [BORING-UI-1](../INVARIANTS.md#boring-ui-1--shadcn-first-blocks-carry-no-visual-value). The staged migration below does not claim that existing custom components already meet it.

### Design verification

Run `npm run check` for the static inventory, `node scripts/check-design.mjs --details` for file/line findings, and `npm run test:design` for the real Chromium theme audit. Set `CHROMIUM` to a Chromium binary; build packages first. `npm run verify` includes both checks. CI runs the browser audit with the scripted journeys too.

`scripts/design-groups.json` owns group folders, browser selectors and REPORT/FAIL modes. Later groups flip their entry to FAIL after replacement and browser coverage; missing coverage fails a migrated group. Exception reasons and exact static allowances live only in [design-allowlist.json](../scripts/design-allowlist.json). The browser reports computed values separately from static counts; REPORT debt is never a pass claim.

The standalone `examples/workspace-app` and `demos/workspace` accept `?theme=brand&mode=dark` for the fictional [brand fixture](../test/fixtures/themes/brand.css). Omit `theme` for the registry's stock tokens and use `mode=light` or `mode=dark`. The audit visits both apps, themes, modes and widths 1440/390, checks main token role pairs for WCAG AA, and writes screenshots and per-element JSON to `evidenceDirectory` in the group config (override with `DESIGN_EVIDENCE`). Groups 1, 2, 4 and 7 fail on violations; groups 3, 5 and 6 remain REPORT. Group 7 also scans `packages/ui/styles/*.css`. The [group 1 renderer fixture](../test/fixtures/themes/group-one.jsx) adds long choices, multiline notifications, provider actions, and pressed Toggle/Switch states. Those callbacks are fictional host fixtures, not model-execution qualification. The fixtures install no component overrides.

The `theme` item (`registry:theme`) is the one source of the shadcn tokens: `cssVars.light`, `cssVars.dark` and the Tailwind v4 bindings in `cssVars.theme`. Items that depend on it are listed under [Blocks](#blocks-what-to-install). `pi-chat`, `button`, `dock`, `feedback` and `app-shell` do not ship global tokens, so `shadcn add` of those leaves the host's CSS alone: a host without the shadcn tokens adds the theme explicitly (`... add <registry>/theme.json`), which merges the tokens into the app's CSS file (light on `:root`, dark on `.dark`, bindings in `@theme inline`) and keeps any token the host already defines; the host's theme wins. The theme also maps Tailwind's `--default-border-width` to the host's `--border-width` and maps shadow utilities to `--shadow-xs` through `--shadow-2xl`. Those bindings let core token changes reach unchanged shadcn controls; hosts that omit the theme must supply equivalent bindings for those extra tokens. The examples compile the same values: `themeCss()` in `lab/studio/tailwind.mjs` renders the item (dark on `.dark` and under `prefers-color-scheme`), and `scripts/check-registry-blocks.mjs` plus `test/contracts/registry-source.test.mjs` keep the item complete.

A consumer needs only Tailwind v4's standard build, nothing from this repository:

1. Tailwind v4 through its Vite plugin (`@tailwindcss/vite`, already set up by `shadcn init -t vite`) or its CLI (`npx @tailwindcss/cli -i src/index.css -o dist/app.css`).
2. `src/index.css` starts with `@import "tailwindcss";` and holds the tokens the CLI merged in.
3. Sources: Tailwind's automatic detection scans the project, which includes the installed `src/components/` folders. When the components live outside the scanned base (a monorepo package, a folder in `.gitignore`), add `@source "../path/to/components";` after the import.
4. Dark mode uses the CLI's `.dark` class variant. Set light and dark core tokens in the app's theme, not in a block stylesheet. The consumer's shadcn components own colours, type, shape, borders, shadows and motion. Blocks add layout only; they must not override those components. The app's derived theme maps core roles to component tokens. Remaining custom skins are migration debt reported by `check-design`, not another supported theming API.

`lab/studio/tailwind.mjs` builds the examples with Tailwind's library API. It includes upstream preflight around Library and viewer fixtures, matching a consumer's standard Tailwind baseline. It is not part of an installation.

## Ambient agent (`pi-ambient`: `AmbientChat`, `AgentNotifications`)

The `pi-ambient` block (`pi-ambient/ambient.tsx`, `notifications.tsx`, `browser-notify.ts`) installs an agent that sits beside an existing website instead of owning the page (see `docs/architecture/WEBSITE-INTEGRATION.md`). `AmbientChat` is a compact floating bar docked at the bottom right; the host page stays fully usable under it. It is driven by the same `NativeChatController` and the same building blocks as `PiChat` (one `useChatSession` hook in `session.tsx` owns sending, queue Steer/edit/remove, uploads, pickers and rows for both), so `slash`, `mentions`, `attachments`, `model`, `effort`, `conversations`, `actions` and `artifacts` are the same config objects.

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

`headerTools` is an optional React node before the header actions and Dock, for host-owned controls such as icon-anchored popovers. `embedded` hosts supply their own header and can render the same controls there. Without it the header is unchanged.

States: `bar` (title row with minimise, a spinner while working and a check when done, ⌄ and a drag grip; queued prompts as a tab tucked behind the composer; the composer row, which is the same `Composer` as `PiChat`'s in its one-row layout: paperclip, `/` and `@` menus typed in the input, which reads "Working for 40s" while the agent runs and "Do anything" when idle, model and effort pickers as icons (the brain for effort), host slots and one round Send/Stop button), `expanded` (the same window grown upward in place: the shared transcript with Markdown replies, the activity block, answerable `ask_user` cards, artifact cards, and per reply copy, optional feedback, "open in full chat" and the time; height follows the content up to 70% of the viewport, then scrolls) and `minimized` (a pill with the spinner, the title and an unread dot). Click the title or a toast to expand, minimise to step back down (bar, then pill), Escape returns from the window to the bar. `state` and `onStateChange` control it; `defaultState` starts it. The window stays alive while the host switches conversation.

Placement: offsets from the bottom right corner, shared by the bar, the window and the pill, remembered for the browser session under `storageKey`. The grip (in the header and at the left of the pill) drags it; the whole pill drags too once the pointer moves 4px, so a plain click still restores it. With the grip focused, arrow keys move it (Shift for bigger steps) and Home returns it to the default corner. `storage="local"` keeps it in `localStorage` across sessions (default `session`, `sessionStorage`). The position is clamped to the viewport on every render (also when the window is resized or grows), so the agent UI can never be off screen. On a phone (below 640px) the bar and the pill are docked at the bottom with no dragging, and the window is a full-height sheet. `variant="contrast"` (default) is a dark window on any page: its root carries the `.dark` class (and `color-scheme: dark`), so every reused part shows the host's own dark tokens; the item declares no colours. `variant="surface"` uses the host's tokens, light or dark.

Artifacts: with `artifactPanel` (a render function the host writes with the viewer registry, see `examples/ambient/artifact-panel.jsx`), clicking an artifact card opens it inside the window. The window widens (up to 72rem, at most the viewport) into the chat on the left and the panel on the right, using `ArtifactWorkspace` (draggable divider, width remembered, full screen that covers the viewport, a full-screen sheet on a phone). The panel gets `{ fullscreen, onFullscreenChange, close, versions, follow, select }` for the viewer bar and the version history; it reads through the host's own resource client. Escape steps back: full screen, then the artifact, then the window. `artifactTarget="host"` calls `artifacts.open` instead, for hosts with their own viewer.

`AgentNotifications` is a polite live region of toasts (status icon, title, a one-line summary of the final reply, close). `AmbientChat` feeds its store when its own run finishes, fails (toast kind `error`) or waits for an answer (`input`, never auto-dismissed, taken back when answered); a toast is not raised while the window is open on that conversation. A host pushes events for anything else with `store.push({ kind, title, summary, conversationId })`, or lets `watchConversation` do it. `autoDismissMs` (default 8000, 0 keeps them), `maxToasts`, hover and focus pause the timer, Escape closes the focused toast; a click opens that conversation (`conversations.onSelect`, then the window expands). With `systemNotifications`, a bell in the header asks for browser notification permission only when the person clicks it, and a system notification is shown only while the page is hidden, so a host whose connection feeds the store passes `pauseWhenHidden: false` to `createRemoteChat` (by default the stream pauses while hidden and nothing would arrive); `browser-notify.ts` is the one file that touches `Notification`, feature-detects it and never asks on load.

Secure-context capabilities are the host's: the voice button in the screenshots needs `getUserMedia`, which exists only on HTTPS or localhost, so it is a `tools` slot and not part of the component. `examples/ambient/mic.mjs` shows the guarded pattern (no button where it is missing); `npm run check` fails any other use of `Notification`, `getUserMedia` or `navigator.mediaDevices` in browser-reachable code.

The `feedback` item ships the microphone button: `VoiceInput` (`feedback/voice-input.tsx`) is the `tools` slot of `PiChat` or `AmbientChat` (`tools={<VoiceInput controller={controller} transcribe={transcribe} />}`). The first click asks for the microphone (`createVoiceCapture` of `@hachej/boring-feedback/page`, opened only from that click), the second stops and calls `transcribe(audio: Blob, signal)`, and the trimmed text is appended to the composer draft. It is never sent: the person reads it and presses Send. A cancel control shows while recording; cancel, a stop that fails, or unmounting releases the microphone and drops any transcription in flight. A refused microphone says what to do (blocked, none found, busy, insecure page) in the chat's own words (`voiceDenied`, `voiceNoMicrophone` and the rest in `labels.ts` and `labels-fr.ts`). Speech-to-text is the host's: `transcribe` posts the Blob to the host's own endpoint.


The queue (`queue.tsx`, shared by `PiChat` and `AmbientChat`) is one slim row per message in a tab tucked behind the composer's top edge: queue icon, one-line text, `Steer`, remove and a "…" menu with Edit (all at least 40px on a phone). The composer parity (paperclip, `/`, `@`, model, effort) is one `Composer` component with a one-row and a two-row layout, not two implementations.

`examples/ambient` is a fictional settings console with the bar over it, a durable agent (artifact tools, `ask_user`, one slow tool) and a background task button (`?view=full` renders a `PiChat` with the same composer config, `?artifacts=host` the host-viewer handoff): `npm run ambient`, and `npm run ambient:journey` for the real-browser, real-model journey with screenshots under `.cache/evidence/ambient/`.

## Viewers (`viewers`)

One Tailwind item (owned source, shadcn tokens, light and dark, 44px targets on coarse pointers) with the standard viewer top bar and the panes over it. Every pane borrows a host-owned controller or takes bytes, and shows the same bar: title and subtitle, a status chip (Saved, Unsaved, Saving, Changed elsewhere, Read-only), viewer controls, then the standard actions, each present only when its handler is supplied: Refresh, Share, Copy, Download, Open in new tab, Close. On a narrow bar Copy, Download and Open move into an overflow menu.

| Part | File |
| --- | --- |
| Bar (`ViewerFrame`, `ViewerToggle` over the consumer's `ToggleGroup`, consumer-owned `Button`): always one row; title and facts, icon-only native mode toggle, Save only while there are edits, a native Badge for status (read-only is a word in the subtitle), then Share, full screen and Close; Reload, Copy, Download, Open in new tab and viewer extras sit in the "…" menu (a bottom sheet on a phone) | `viewer-frame.tsx` |
| Menu (`ViewerActions`, `ViewerVersions`): the consumer's shadcn Base UI dropdown through `ActionMenu`, with native keyboard navigation and dismissal. Version rows show relative time, provenance (You, Agent or External change when recorded), optional measured change summaries, day groups and a quiet Current marker with a check. Older versions are read-only; the viewer explicitly states that restoration is unavailable rather than inventing a write path | `menu.tsx` |
| Words, icons, the window (`ViewerWindowProvider` `{ fullscreen, onFullscreenChange, actions, labels, icons }`, `defaultViewerLabels`, `defaultViewerIcons`): for example `<ViewerWindowProvider value={{ labels: { share: 'Partager' }, actions: [{ id: 'pin', label: 'Pin', icon: PinIcon, onSelect: pin }] }}>` around any viewer | `viewer-window.ts` |
| Share: `createLinkShare(link)` uses the Web Share API, otherwise copies the link and the bar says "Link copied"; plain-HTTP origins lack `navigator.clipboard`, so `copyText` falls back to `execCommand('copy')`, and if the browser allows no copy at all the bar shows the link selected for a manual copy. A frame shown only while a file or artifact version loads offers no Share: the pane that shows it brings its own frame, which replaces (remounts) the loading one, and a notice set on the old frame would be lost | `share.ts`, `utils/utils.ts` of the `utils` item (`copyText`, `ManualCopyError`) |
| Markdown editor with toolbar, prose styling, Rich/Source toggle, Save | `markdown-pane.tsx` (over `@hachej/boring-ui-kit/markdown-editor`) |
| HTML preview and source; passive preview by default, optional interactive preview (below) | `html-pane.tsx` (over `@hachej/boring-ui-kit/html-viewer`), `interactive-html.tsx` |
| Image viewer: fit, zoom, pan, checkerboard; every type through an `<img>` from an object URL | `image-pane.tsx` |
| PDF viewer: the browser's own viewer in a frame over an object URL, a Download fallback where there is none | `pdf-pane.tsx` |

Refresh runs the controller's own refresh for editable panes, so unsaved edits are kept and shown as "Changed elsewhere". Rich Markdown editing is offered only when the document survives a parse and serialise round trip unchanged; otherwise it opens as source with a notice. The canvas is not a pane: wrap tldraw's editor in `ViewerFrame` (see `lab/studio/panels/canvas.jsx`). `viewers.css` is the source of the item's `css`; run `node registry/viewers/build-css.mjs` after editing it.

### Interactive HTML preview (host opt-in)

By default the HTML preview is the passive, sanitised rendering of `@hachej/boring-ui-kit/html-viewer` (scripts, attributes and external resources removed, `sandbox=""`). A host can pass `interactive={{ scriptSources: [...] }}` to `HtmlPane`; the Preview view is then the page itself, running, and the Preview | Source toggle stays the only mode switch (a Reload button, or pressing Preview again, loads the page again). Nothing changes without the option.

What is isolated: the page runs in `<iframe sandbox="allow-scripts" allow="" referrerpolicy="no-referrer" srcdoc>`. There is no `allow-same-origin`, so the page has an opaque origin (no cookies, `localStorage` or access to the host page), and no top navigation, popups, forms, downloads or modals; `allow=""` withholds camera, microphone, location and other powerful features. A `<meta http-equiv="Content-Security-Policy">` is injected first in the document: `default-src 'none'; script-src 'unsafe-inline' <origins>; style-src 'unsafe-inline' <origins>; img-src data: blob:; font-src data: <origins>; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'`. What egress is allowed: only loading scripts, styles and fonts from the host's `scriptSources` (HTTPS origins; anything else is dropped, so the list cannot inject directives). The page cannot make requests (fetch, XHR, WebSocket), embed frames or load images from the web. The studio allows `https://cdnjs.cloudflare.com` and `https://cdn.jsdelivr.net`; pinning library versions is the page's responsibility (the studio's artifact agent is told to use exact versions).

This is trusted-host opt-in for untrusted content, not a claim of qualification: the acceptance row A12 (content refused or isolated; declared CSP and egress enforced) is not claimed for it. A third-party CDN script runs with the page's privileges inside the sandbox, and a compromised or unpinned library can draw anything on the page.

## Feedback (`feedback`)

### Changes

- `ComposerFeedback.start` (pi-chat's composer prop) is optional now (API change). The type no longer requires it; without it the composer shows no Feedback button. Hosts that always passed `start` are unaffected.

**Moved: update your imports.** `pi-chat` no longer exports `FeedbackCard`, `FeedbackMention`, `feedbackMentionId`, `feedbackRenderTool`, `feedbackResultView` or their types; they come from `components/feedback/feedback-card` (installed by the `feedback` item, which depends on `pi-chat` as its host). `VoiceInput` moved to `components/feedback/voice-input`. Hosts wire it as `mentions={{ search, open, render: feedbackMentionRenderer() }}` and pass `<VoiceInput … />` through the composer's `tools` slot.

`NoteBubble` (the pin: a text field with a mic inside it; pass `transcribe` for the mic), `useComposerFeedback` (the composer's annotate toggle and count), the optional `FeedbackBar` and `FeedbackChip` (with `FeedbackReview`) (`feedback-session.tsx`, over `createFeedbackSession` from `@hachej/boring-feedback/ui`), `PointBar` and `usePointing` (`point-mode.tsx`: point mode for phones; the host hides its panel while `usePointing` is true and passes its tab bar height as `bottomOffset`), `PickerOverlay` (styles and `usePickerOverlay`), and the optional Release 1 components `PointButton`, `AnnotateSheet`, `FeedbackList` and `FeedbackReport` (not mounted by default) install into `components/feedback/`. They import React, React DOM (the review is a portal) and `@hachej/boring-feedback/format`, `/page` and `/ui` directly: picking, masking, anchoring and placement stay in the package, so restyling cannot weaken them. CSS is plain and scoped to `[data-boring="feedback"]`, reading the host's shadcn tokens through `--boring-feedback-*` variables; the overlay lives in a shadow root and takes the `pickerOverlayStyles` string, with `box`, `label` and `toolbar` parts. Every selection can be cancelled (Esc, a second click on the zone, the "Cancel selection" button of the bubble and of `AnnotateSheet`) and a note can have no element ("Ask a general question", `captureGeneral`); the words are `labels` (`feedback-labels.ts`: English by default, `feedbackLabelsFr` for French). `registry/feedback/feedback.css` is the source of the item's `css` (`node scripts/build-feedback-css.mjs`). Save appears only when the host passes a save endpoint (`fetchSaveEndpoint` over its own authenticated route); Show works only in the application page itself. `examples/feedback` mounts the composer UX on a fictional page, and the Release 1 surfaces with `?ui=classic` (`npm run feedback`, `npm run feedback:journey`, `npm run feedback:journey:picker`; `?mobile=1` and `npm run feedback:journey:point` for point mode on a 390x844 phone), and `npm run test:feedback-registry-consumer` installs the item with the pinned CLI.

## Task-list viewer

`task-list-viewer` installs the consumer-owned domain, controller and React renderer. It uses `@hachej/boring-ui-kit/text-buffer` and public resource contracts. The host parses the `fictional.task-list` version 1 descriptor with `createTaskListFeature(options)`, then passes its concrete controller to `TaskListViewer`. Descriptors select the already-bound source and carry no access credentials. No core file-type switch changes are required for this direct host composition.

The renderer supports task creation, completion, removal, exact Save, Refresh, Discard, receipt Reconcile and explicit Abandon save. The host owns controller disposal and its resource client. New documents remain local until Save. A concurrent native save leaves a human draft intact and makes a stale human save conflict.

`shared/task-list-tools.mjs` separately registers native `read_task_list` and `edit_task_list` tools. Supply a resolver with the original binding ID, target, current access and public reader/publisher/lookup capabilities. A binding ID identifies a provider incarnation and must change when that authority changes. The tools retain publication intent in native task memo state and recover attempted saves by lookup only. Installing the React recipe does not register tools or grant authorization.

Run `npm run test:task-list-registry-consumer` after building the packages. It uses the pinned shadcn CLI, built item JSON and isolated package tarballs; checks strict declarations and browser imports; drives and restyles the installed component; then exercises the native tools and six SQLite SIGKILL cases against that installed domain/controller source. `npm run task-list:journey` drives Chromium through an authenticated local HTTP bridge, including concurrent saves and an independent Markdown provider. Loopback-restricted environments cannot qualify that browser journey. Hosted registry discovery, live identity and full A43/A46 remain separate qualifications.

## File tree

Install `file-tree.json` for portable `FileTree` and `FileTreeView` wrappers.
The renderer adapts the structure of shadcn `sidebar-11`; the recipe imports its scoped stylesheet.
Buttons come from the consumer's `@/components/ui/button`; actions use the existing
pinned Base UI dropdown recipe. Their look is not overridden by Library CSS.
The package renderer takes an explicit `components` binding; these installed wrappers
supply it, so installed consumers need no extra props.
It can mount in a detached window without the workspace layout. Pass the concrete
`revisionProvider` from the [files guide](../packages/files/README.md#frontend-revision-provider).
The `pi-app` recipe accepts the same binding and supplies the tree, `@` filename
search and attachment uploads. See the [UI guide](../packages/ui/README.md#file-tree-and-filename-mentions)
for publication, navigation and lifecycle behavior. `npm run file-tree:journey`
drives the fictional SQLite-backed browser fixture; `npm run
test:app-registry-consumer` installs the recipes in an isolated consumer.

With a `revisionProvider`, `pi-app` opens Library in the artifact column by default
(`libraryPlacement="panel"`). On a phone, Library opens in the explicitly installed Base UI bottom drawer.
Choosing a file closes Library and opens its viewer. Opening Library asks before discarding an unsaved file.
The chat stays mounted. `libraryPlacement="side"` retains the separate resizable column to the
right of the viewer, with its viewer-header toggle. `libraryPlacement="center"` retains the
center Library view; its close button returns to chat.
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
version-history menu item and reloads it when `refreshKey` changes.
The shared tree defaults to `variant="list"`: one title/count/upload/close row,
inset search, 48px rows with kind and size, and Open, Version history and Download
in a keyboard-accessible ⋯ menu. Picker and drop uploads use the existing provider.
`variant="plain"` keeps the compact tree. These defaults apply to every Library
placement, the file-tree recipe, Documents and the demo's popover and phone sheet.
The count is visible loaded items, not a workspace total. The catalog supplies no
edit date or author, so file rows show neither. The Library history panel and viewer
version menu share relative-time, You/Agent and Current rows through `version-history`.
Run `node examples/file-tree/journey-library.mjs` with `CHROMIUM` set for both
consumers' light/dark and 360px browser checks.
`AgentWorkspace` omits the chat header's duplicate History action. An IntersectionObserver sentinel loads
older native records near the top of the same transcript in standalone, docked, embedded, page and floating
chats. Older messages use the normal bubbles, Markdown, Trace and file cards, not a separate read-only
panel. Prepending keeps the first visible row anchored. A small spinner reports loading, a quiet marker
identifies the start, and a visually hidden "Load earlier messages" button supports keyboard and screen-reader
use. Loaded counts are announced politely. Pages accumulate only on demand and never change model context.

Reply footer actions are icon-only, with accessible names and tooltips. Their hit areas are 32px with a
pointer and 44px on touch screens. They appear on hover or focus on desktop and stay visible on phones.
Connection badges default off
in `PiChat`; connection failures still appear inline. `showConnectionStatus={true}` restores the badge.
`chat.tools` puts configured voice/action controls at the right of the composer controls row.
`chat.composerChips` adds optional host pills beside the attach button and model picker.

`PiChat` centers the empty greeting and composer on desktop. After a message, the composer docks
to the bottom. Phones always dock it. `emptyLayout="docked"` retains the former empty layout,
and the default `composerLayout="card"` follows the owner reference: full-width, growing text above
one centred row of 40px pointer or 44px touch controls. `composerLayout="pill"` explicitly restores
the previous single-line pill; `stacked` and `inline` remain available. `AmbientChat` uses the same
default and compatibility prop. Attachments stay inside the card above the text. An `Artifacts · n`
chip appears above it for observed conversation files and uploads, opening a desktop popover or
phone drawer through the existing file/artifact callbacks. `ConversationList` defaults to
search disclosure and overflow row actions; `searchMode="inline"` and `rowActionLayout="inline"`
retain the former controls.

Viewer headers default to one quiet row. `ViewerFrame compactHeader={false}` retains the former
visible Share and fullscreen actions and supports `ViewerWindow.headerLayout="stacked"`.
Compact headers show metadata on hover. On phones, Back, the title, and overflow remain visible;
editing controls and revision history move into overflow. Escape and browser Back close the phone
artifact without replacing the mounted conversation. `ArtifactWorkspace.onClose` may return `false`
to refuse a synchronous close; declining the file's discard prompt restores the sheet's Back entry.
Reselecting the current file closes Library without changing the selected path or the chat draft.

`MarkdownEditor` and `MarkdownPane` now default to `formattingToolbar="pinned"` on desktop.
The toolbar stays on one row and scrolls when its controls do not fit. The header's Aa
control switches to selection formatting; `formattingToolbar="selection"` starts with Tiptap's native
bubble menu instead. Phones always use selection formatting, with no pinned row. Keyboard shortcuts
and Markdown input rules remain available.

Markdown autosave is on by default. It calls the existing `controller.flush` after 1200ms without an
edit, on blur outside the editor, before closing or switching files, and when the page becomes hidden.
Saves run one at a time; edits during a save are flushed next. The header shows Saving… and then Saved.
There is no Save button while autosave is on; Cmd/Ctrl+S still saves immediately.
`autosave={false}` on `MarkdownEditor` or `MarkdownPane` restores explicit saving.
`autosave={{ delayMs: 2000 }}` changes the idle delay. `ViewerWindowProvider value={{ autosave: false }}`
sets the policy for its Markdown panes; a pane's own prop wins. Read-only panes never autosave.
An untouched new buffer is not automatically published by idle, blur, page hide or teardown; explicit Cmd/Ctrl+S can create it.

Autosave uses the same [conditional write, operation lookup and receipts](../docs/architecture/FILES-GIT-EXEC.md#one-place-for-files).
Stale revisions still refuse. Conflicts, refused or unavailable writes, and unconfirmed acknowledgements
pause that file's autosave and retain its buffer. Typing does not retry a refusal. The existing explicit
resolution controls resume saving once the base or outcome is resolved. Agent writes retain their current
change-event and stale-revision semantics. Workspace navigation flushes first and asks about discarding
only when the flush failed or remains unconfirmed. A host with its own navigation can register the
`onAutosaveChange` flush callback on the editor or pane and await it before unmounting.
To delegate refused-close/discard decisions to a real host guard, pass `onBeforeLeaveChange` to
`MarkdownPane` or `FileViewer` (or the artifact's `ViewerOptions`) and route `onClose` through that guard.
Internal teardown registration alone never permits closing over a failed flush.
Hidden-page and unmount flushes are best effort, not a persistence guarantee
when the browser terminates. `MarkdownEditor showOutline` controls heading navigation; by default it follows `header`.
`onUnsavedChange` reports an open file's unsaved changes, so a host can ask before
it switches workspace or identity. Chat attachments are saved as
`uploads/<name>-<8 hex>.<ext>`, so a second pasted `image.png` never collides.
