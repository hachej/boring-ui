# Viewer source recipes

The `markdown-editor` and `html-viewer` items copy thin React wrappers and scoped CSS into a host application. They preserve concrete controller props and borrow the host's controller. Unmounting a wrapper leaves its controller alive.

| Item | Public renderer | Controller |
| --- | --- | --- |
| `markdown-editor` | `@hachej/boring-ui-kit/markdown-editor` | `MarkdownController` from `@hachej/boring-ui-kit/markdown` |
| `html-viewer` | `@hachej/boring-ui-kit/html-viewer` | `HtmlController` from `@hachej/boring-ui-kit/html` |
| `highlights` | copied `Highlights` over the Markdown editor | borrowed `MarkdownController`, default workspace `MarkStore` or supplied store |
| `pi-chat` | copied source in `components/pi-chat/` | `NativeChatController` from `@hachej/boring-ui-kit/native-chat` |
| `pi-ambient` | copied source in `components/pi-ambient/` | the same `NativeChatController` as `pi-chat` |
| `pi-workspace` | copied source in `components/pi-workspace/` | none: layout driven by props |
| `windows` | copied source in `components/windows/` | none: floating utilities, launcher and shared `useDraggable` |
| `dock` | copied source in `components/dock/` | none: `Dock`, `DockLayout`, `DockMain` (re-exported by `pi-workspace/dock`; the app shell installs it) |
| `pi-app` | copied source in `components/pi-app/` | the agent page; viewers over one resource client (`useRemoteChat` lives in `pi-chat` and is re-exported) |
| `documents` | copied source in `components/documents/` | none: the Library, a file and its revisions over one `revisionProvider`; `DocumentSheet` for one document over the app |
| `provider-setup` | copied source in `components/provider-setup/` | none: props and callbacks only |
| `theme` | the shadcn tokens (light, dark) and their `@theme inline` bindings, merged into the host's CSS | none |
| `utils`, `button` | `cn`/`copyText`/`useDraggable` and the host-action adapters in `components/button/actions.tsx`; controls come from the consumer's `components/ui/` | none |

## Blocks: what to install

`pi-chat` is the chat and nothing else. `pi-ambient` and `pi-workspace` are optional blocks over it; install only what the page needs. A block imports its dependency by the installed sibling folder (`../pi-chat/rows`, `../utils/utils`, `../button/actions`), so there is one copy of each helper, and `scripts/check-registry-blocks.mjs` (in `npm run check`) fails if `pi-chat` imports a block, `pi-workspace` imports `pi-ambient`, a source file is not listed in its item, a file's type or target is off, two items ship the same file name, or any import cycle exists in a block or a package's sources (type-only and lazy imports count; it prints the cycle's path).

Item and file types follow the shadcn schema: the multi-file chat items are `registry:block`, the viewer wrappers and component sets `registry:component`, the host-action adapters `registry:component`, the shared helpers `registry:lib`, the tokens `registry:theme`. Within an item a `.tsx` file is `registry:component`, a `use*.ts` file (and `pi-ambient/browser-notify.ts`) is `registry:hook`, and any other `.ts` file is `registry:lib`. Every file has the target `components/<item>/<file>`, so the installed folders mirror `registry/` (the Markdown and HTML wrappers land in `components/markdown-editor/markdown-editor.tsx` and `components/html-viewer/html-viewer.tsx`, the preview banner in `components/feedback-preview/`).

| Block | Install | Pick it when |
| --- | --- | --- |
| `pi-chat` | `npx shadcn@4.21.5 add <registry>/theme.json <registry>/pi-chat.json` (drop `theme.json` when the host already defines the shadcn tokens) | you lay out the page yourself and only need the conversation (`PiChat`) |
| `pi-ambient` | `... add <registry>/pi-ambient.json` (also installs `pi-chat` and `pi-workspace`) | an agent sits beside an existing site: `AmbientChat` bar and `AgentNotifications` toasts |
| `pi-workspace` | `... add <registry>/pi-workspace.json` (also installs `pi-chat`) | the page is the chat plus a resizable artifact panel (`ArtifactWorkspace`); add `viewers` for the panel contents and `pi-ambient` for float-when-narrow |
| `pi-app` | `... add <registry>/pi-app.json` (also installs `pi-chat`, `pi-workspace` and `viewers`) | the page is a whole agent app: sessions, chat and artifact viewers in one `AgentWorkspace` (see [below](#whole-agent-app-pi-app-agentworkspace)) |
| `maquette-viewer` | `... add <registry>/maquette-viewer.json` (installed with `pi-app`) | you show a PM agent's `*.maquette.json` mock-ups outside `AgentWorkspace` (`MaquetteViewer`, `maquetteKind`; see [below](#maquette-viewer-maquette-viewer)) |
| `app-shell` | `... add <registry>/app-shell.json` (also installs `pi-chat`, `feedback` and pinned `drawer` and `dropdown-menu` recipes plus the shadcn `sidebar` and `avatar` of your own style; add `<registry>/theme.json` too when the host has no shadcn tokens) | one agent above any app: a bottom drawer with peek, half and full on a phone, a right panel on a wide screen (see [below](#agent-layer-app-shell)) |
| `windows` | `... add <registry>/windows.json` (host Base UI controls only; add `theme.json` if needed) | independent floating utilities and a keyboard launcher (see [below](#floating-windows-windows)) |
| `agent-target` | `... add <registry>/agent-target.json` (also installs `app-shell`; requires the coordinated kit patch, not the older published 0.4.3) | point and dictate on explicitly marked app JSON without opening chat (see [below](#point-and-dictate-on-app-data-agent-target)) |

Registry blocks support the shadcn **Base UI style only**. Only the `base-nova` style is supported. Viewer, Library and shared chat menus use the consumer's real `@/components/ui/dropdown-menu`, declared as the bare `dropdown-menu` registry dependency. `ActionMenu` only maps actions and metadata to that component; it owns no menu positioning, focus loop or visual primitive. The consumer's shadcn components supply appearance and interaction. `npm run test:app-registry-consumer` installs and strictly checks Base UI, including Library controls, portalled viewer/version menus and the phone files drawer. Ordinary buttons and icon actions import the consumer's `@/components/ui/button` directly. Pressed actions use `@/components/ui/toggle`; the compact account theme uses `@/components/ui/switch`. Their bare registry dependencies install the consumer's components. `button/actions.tsx` adapts host actions, not visual primitives. Lists (conversation history, sessions, Library tree, documents' revisions, empty states) compose the consumer's `sidebar` menu, `input-group`, `popover`, `scroll-area`, `collapsible`, `empty` and `separator`; the packaged tree (`@hachej/boring-ui-kit/file-tree-view`) takes them through its `components` prop and ships layout CSS only. Other component groups remain tracked in `scripts/design-groups.json`. The cards (approval, question, artifact, code block, feedback) use the consumer's `@/components/ui/item` and `badge` with layout classes only; `pi-chat` and `feedback` declare those bare dependencies. The approval card follows shadcn's Confirmation recipe (an outline Item with Approve and Deny buttons). shadcn's Code Block is not used because installing it adds the `shiki` highlighter this block never calls, and its Questionnaire is a multi-step wizard on a new `@shadcn/react` dependency that does not fit the one-form `ask_user` card.

Tokens: `pi-ambient`, `pi-workspace`, `pi-app`, `viewers`, `provider-setup` and `file-tree` depend on `theme` (directly or through a block), so `shadcn add` merges the tokens into the app's CSS file. `pi-chat`, `button`, `dock`, `feedback`, `app-shell`, `windows` and `agent-target` do not: they use the host's shadcn tokens (`background`, `foreground`, `muted`, `primary`, `border`, `ring`, `destructive` and the rest) and their own layout, and they install no global tokens. A host that has those tokens changes nothing. A host without them must also install `theme.json` (`npx shadcn@4.21.5 add <registry>/theme.json <registry>/<block>.json`), or those items render with semantic colours and focus styling missing (dock's resize indicator loses its colour). The blocks import `cn` from `utils` and controls directly from the consumer's `components/ui/`; the CLI installs each dependency once. `registry.json` owns the current file lists. Theme-carrying installs merge the theme tokens into CSS and keep tokens the host already defines.

`<registry>` is wherever `public/r/` is served. Items name their registry dependencies as absolute URLs of their own release (`<registry>/pi-chat.json`, `<registry>/pi-workspace.json`), so no `registries` line is needed in `components.json`. `pi-ambient` needs `pi-workspace` because the ambient window opens artifacts in the same panel layout; `pi-workspace` never needs `pi-ambient` (the host chooses to render `AmbientChat` when the chat floats). Examples: [`lab/studio`](../lab/studio/README.md) assembles every block; [`examples/ambient`](../examples/ambient/README.md) uses `pi-chat` and `pi-ambient` only.

## Floating windows (`windows`)

Install `<registry>/windows.json` for host-owned utilities independent of an agent.
It uses your Base UI Button, Card, Badge, Drawer and DropdownMenu, with no theme
replacement or Sheet dependency. The app shell and windows share the
`useDraggable` hook from `utils` (also re-exported by `windows/windows`); the
agent's existing dock/float behavior is unchanged.

```tsx
import { FloatingWindow, WindowLayer, WindowLauncher } from '@/components/windows/windows';

const windows = [
  { id: 'notes', title: 'Notes' },
  { id: 'calculator', title: 'Calculatrice' },
  { id: 'planning', title: 'Planning' },
];

<WindowLayer storageKey="workshop.windows" persist="local">
  <WindowLauncher windows={windows} />
  <FloatingWindow id="notes" title="Notes"><Notes /></FloatingWindow>
  <FloatingWindow id="calculator" title="Calculatrice"><Calculator /></FloatingWindow>
  <FloatingWindow id="planning" title="Planning"><Planning /></FloatingWindow>
</WindowLayer>
```

- `WindowLayer` owns one viewport stack. IDs must be unique within the layer.
  `storageKey` defaults to `boring.windows`; `persist="session"` is the default,
  and `local` remembers across visits, like the docks. Each `<key>.<id>` stores
  `{ rect: { x, y, width, height }, status: 'open' | 'minimized' | 'closed' }`.
  No content is stored. Malformed or unavailable storage falls back to defaults.
- `FloatingWindow` accepts `id`, `title`, `children`, `defaultOpen` (false) and
  `defaultRect` (48, 64, 400, 320 pixels). Remembered choices take precedence.
  Drag its title row, resize its corner, click or focus its content to raise it.
  The resize control also accepts arrow keys (24 pixels, Shift: 96). Desktop
  rectangles stay within the viewport on drag, resize, restore and viewport resize;
  the minimum is 240 by 160 pixels, capped by the viewport.
- `WindowLauncher windows={[{ id, title }]}` lists the host's available windows,
  marks open/minimized ones and opens or focuses a choice. `label` changes the
  trigger's text. The native menu supplies arrow keys, typeahead and Escape.
  `useWindow(id)` returns `{ id, rect, status, open, close, minimize }` after the
  corresponding window registers, or `undefined` before then.
- Opening moves focus inside. Escape closes the focused desktop window; nested
  controls that prevent Escape retain their native behavior. Closing or minimizing
  focuses the next open window, then the launcher when none remain. Below 641px,
  only the front window is shown, as the host's full-screen Drawer; the launcher
  remains a list. Returning to desktop restores the desktop rectangle.

These are presentation surfaces, not document storage or task lifecycle owners.
Keep durable content and drafts in host state/controllers, especially across the
phone/desktop presentation change. Z-order is local to the window stack and is
not persisted; native menus and drawers remain above desktop windows.

`npm run windows:journey` drives the fictional Notes, Calculatrice and Planning
fixture at 1440px and 390px, including drag, raise, resize, keyboard launch,
minimize, Escape and reload. Screenshots live under `.cache/evidence/D79/`.
The generated registry is a candidate for the next kit release; publication is a
separate owner-controlled release step.

## Anchored Markdown highlights

Install `<registry>/highlights.json`. It composes `markdown-editor` and the host's
Base UI Button, Textarea, Label and DropdownMenu; it adds no Sheet or owned
primitive. Pass `<Highlights controller={controller} resource={{ client, identity }}
locator={locator} locale="fr" />`, where `client` is the same workspace resource
client used by the document. Opening creates no file; add/comment/remove saves
`<doc>.marks.json` conditionally. `locale="en"` is the default for new controls;
the existing editor keeps its current labels.

An app can borrow a `store={store}` implementing `MarkStore` instead, or render
`marks={[{ id, anchor, colour: 'accent', actions: [{ id, label, run }] }]}` without
storage. `actions` are trusted host callbacks, not sidecar data. Theme colours are
`accent`, `primary` and `muted`; decorations never write Markdown formatting.
Unplaced marks have a missing/ambiguous tray. Choosing a candidate captures fresh
context and saves it through the store; indistinguishable contexts remain a
version-local confirmation rather than guessed persistent identity.

See [the owning anchor/storage semantics](../docs/architecture/FEEDBACK.md#markdown-quotes-and-document-marks)
and the [UI store API](../packages/ui/README.md#document-marks).
`npm run highlights:journey` drives the fictional SQLite workspace through HTTP,
including a stale second tab and phone/desktop FR/EN light/dark screenshots under
`.cache/evidence/D78/`. No agent, model credentials or D-76 conflict UI is needed.

## Updating installed blocks

Installed blocks are generated copies: an app installs the shell and the chat once and updates them with one command, and it never edits a copied file. Everything an app changes goes through an extension point below; a change that has none is a request for a new extension point in this repository, not a local edit. These instructions live here only.

An app enforces every kit rule with this one command and copies no script; there is no app-level allowlist (fix the app, never the rule).

```sh
npx boring-ui-blocks check [--design <dir>...] [--manifest <path>] [--cwd <app web dir>] [--json]
npx boring-ui-blocks update [--version <v>] [--registry <url>] [--dry-run] [--manifest <path>] [--cwd <dir>]
npx boring-ui-blocks add <shadcn add arguments...> [--manifest <path>] [--cwd <dir>]
npx boring-ui-blocks manifest [--manifest <path>] [--cwd <dir>]
```

`boring-ui-blocks` is the `bin` of `@hachej/boring-ui-kit` (`packages/ui/bin/boring-ui-blocks.mjs`). It runs in the app's web directory (the one holding `components.json`), or in `--cwd`. Paths come from `components.json` `aliases`: `components` (default `@/components`) and `ui` (default `<components>/ui`); an `@/` alias resolves to `src/` when the app has one, else to the app root. The kit version is the `version` of the installed `node_modules/@hachej/boring-ui-kit/package.json`, and the registry items are the ones that package ships in `node_modules/@hachej/boring-ui-kit/r/`, so `check` needs no network.

`check` writes nothing and runs three checks:

1. **blocks**: each file of every installed block (one of its files exists under the `components` alias) equals the registry item of the installed kit as the shadcn CLI writes it: the CLI drops the leading comment and a `'use client'` directive, and line endings may change; none of these is an edit.
2. **design** (only with `--design`; none by default): the app's own `.js/.jsx/.ts/.tsx/.mjs/.cjs/.css` files under those directories are tokens-only. This is the app profile of the rule engine `scripts/check-design.mjs` applies to this repository (BORING-UI-1, whose block profile stays stricter: a block picks no radius, border or shadow at all). Utilities that resolve to theme variables pass (`rounded-md`, `border`, `border-t`, `shadow-md`, `text-sm`, `var(--…)` values), and so do layout metrics (gaps, widths, grid tracks, `min-h-[44px]` touch targets). Literals fail: `color` (`#hex`, `rgb()/hsl()/oklch()/oklab()`, palette classes such as `bg-red-500` and `text-white`), `arbitrary-value` (`[…]` on a visual utility: `rounded-[7px]`, `text-[13px]`, `shadow-[…]`, `tracking-[…]`, `font-[…]`, …), `border-width` (`border-2`, `border-t-4`, a declared border width other than `1px`, the `border` utility's width), `font` (a literal `font-family` or `font` shorthand), `literal-value` (a literal `border-radius`, `box-shadow`, `font-size` or `letter-spacing` declaration) and `dark` (`dark:` variants; the theme's `.dark` tokens handle dark mode). In CSS, only token definition blocks (`:root`, `.dark`, `html`, `[data-theme…]`, `@theme`, `@layer theme`) may hold values. Skipped automatically: the `ui` directory (checked by 3), installed block files (checked by 1), `node_modules` and dot entries; Markdown is content and is not scanned. Recommended: `--design src` in the web directory (from the repository root: `npx boring-ui-blocks check --cwd web --design src`); `--design` directories resolve against the app directory.
3. **ui**: every `.js/.jsx/.ts/.tsx/.css` file under the `ui` alias matches its sha256 (text with line endings normalised to LF) in the manifest's `files` map (`{ "button.tsx": "<sha256>" }`). The manifest is `SHADCN-GENERATED.json` next to `components.json`, or `--manifest <path>` (relative to the app directory). A file edited by hand (`edited`), added without the manifest (`unrecorded`) or deleted (`missing`) fails.

Output, one line per violation, then one summary line starting with `ok ` or `fail `:

```text
blocks edited src/components/pi-chat/artifact.ts pi-chat
design color src/features/alert.tsx:2:30 #ff0000
ui unrecorded src/components/ui/card.tsx SHADCN-GENERATED.json
fail @hachej/boring-ui-kit@0.4.1: 3 violation(s) (blocks 1, design 1, ui 1). …
```

The line format is `<check> <rule> <file>[:<line>:<column>] <detail>` with paths relative to the app (detail: the block name, the matched text or the manifest name). `--json` prints `{ ok, kit, version, blocks, violations: [{ check, rule, file, line?, column?, detail }] }` instead, or `{ ok: false, error }`. Exit codes: `0` all checks pass; `1` rule violations; `2` usage or configuration error (unknown command or flag, no `components.json`, the kit not installed or shipping no `r/`, a `--design` directory that does not exist), with `error: …` on stderr.

`add` runs `npx -y shadcn@4.21.5 add <arguments>` in the app and, when it succeeds, rewrites the manifest (only its `files` map; other keys of an existing manifest are kept); add shadcn components with it. After a deliberate `npx shadcn add`, run `manifest` to record the files. `update` reinstalls every installed block from `https://cdn.jsdelivr.net/npm/@hachej/boring-ui-kit@<version>/r/` with `npx -y shadcn@4.21.5 add <items> --overwrite --yes` (default: the installed version; `--registry <url>` for another host; `--dry-run` prints the command) and rewrites the manifest, which also moves the package dependencies the items pin and the shadcn components they depend on. The app's own version specifiers are kept: the CLI installs dependencies by name and npm then saves `^<version>` over an exact pin, so `add` and `update` put back the specifier of every dependency that was in `package.json` (and in the lockfile's root entry) before they ran; dependencies the CLI added keep what it wrote. Run `check` first: `update` overwrites edited copies. Only `add`, `update` and `manifest` write into the app, and only the shadcn files and the manifest.

| An app wants to | Extension point |
| --- | --- |
| rebrand any block | the theme tokens only ([Styling](#styling)) |
| change any word, or speak French | `labels` (partial, over `defaultChatLabels` and each block's defaults) and `locale="fr"` (`frenchChatLabels`, `frenchAppLabels`, …) |
| change icons, add header, panel, message or row actions | `icons`, `headerActions`, `panelActions`, `messageActions`, `conversations.rowActions` ([Labels, icons and host actions](#labels-icons-and-host-actions)) |
| name and draw its own artifact type (`.maquette.json` as « Maquette » with its renderer) | `artifacts.kinds` on `PiChat` / `AmbientChat`, `artifactKinds` on `AgentWorkspace`: `ArtifactKind { match(target, artifact), label, icon?, renderer?({ artifact, text, onReady, onFailed }), waitsForReady? }` (with `waitsForReady` a `present` of the file is confirmed only after `onReady`, and refused on `onFailed` or a throw), consulted before the built-in types by the card, the panel bar and the panel, and by a file opened from the Library, the file tree or a link (one resolution by path, `resolveKind` in `pi-app/artifact-panel.tsx`: the app's kinds first, then the built-in maquette and diagram kinds) |
| open a presented artifact in its own panel | `artifacts.open(descriptor)` (the descriptor carries the exact `revision`), or `AgentWorkspace` with its artifact panel |
| a viewer for a type or file kind | `viewers` on `AgentWorkspace` (`CustomViewers`, for example `canvas`) or an artifact kind's `renderer` |
| show a headless run (`runs/<id>`) | `RunCard` (`run`, optional `fetchRun`), from `renderTool` / `renderEntry` or the page |
| list, create, rename, archive and fork conversations in the shell's chat | `chatProps.conversations` from `useConversations` (relative `_agent/<name>/conversations`) |
| show something under the composer (a requests tray) | `belowComposer` on `PiChat` and `AmbientChat`; `tools` for controls inside the composer bar |
| answer a question outside the chat (a popover) | `QuestionCard` exported from `pi-chat`, with a tool call, a `questionId` and an `answer` callback, inside `ChatTextProvider` |
| render a tool result its own way | `toolRenderers` (keyed by tool name, tried first; an entry returning `undefined` falls back), `renderTool` (the catch-all), `renderEntry`, `groupTool`, `replyFooter` |
| replace a built-in piece of the chat | `renderText(part)` draws assistant text (default Markdown); `cards={{ question, approval }}` take `QuestionCardProps` / `ApprovalCardProps`; a feature config carries its own component: `slash.Picker`, `mentions.Picker`, `model.Picker` / `effort.Picker`, `voiceMessage.Button` / `Bubble`, `attachments.Camera`. Anything left out uses today's component, on `PiChat` and `AmbientChat` |
| everything else the chat takes | the props of `PiChat` (`PiChatProps`), `AmbientChat` and `AgentWorkspace` |

## Artifact cards in `pi-chat`

Pass `artifacts={{ open, isOpen?, detect?, kinds? }}` to `PiChat` and a tool result whose JSON text carries a valid `boring.artifact` descriptor (the result of `present`) becomes a card outside the activity block: icon, title, type, a real button calling `open` (and the version number for a descriptor that has one; a presented file's descriptor points at the file and has none). A running `present` shows an opening card, a failed call shows none, and presenting one file several times in a turn shows its last version once. The host owns the panel; `collectArtifacts(view, detect)` lists the versions a conversation produced. `kinds` (`ArtifactKind[]`) names an app's own file types on the card (label, icon) and draws them in the `pi-app` panel (`renderer`, inside the standard viewer bar with copy and download, at the card's revision); `typeLabel(artifact, kinds)` gives the same name to a host panel. The `pi-app` panel shows a `code` artifact whose `language` is `csv` as a table.

Artifact cards use a tinted icon square, a single-line title and a muted type/version line, with one chevron rather than action text. An open card uses the host's secondary Button variant and a check; `aria-pressed` and its accessible action name remain. The card target is at least 48px high. Built-in type names follow `locale` (`Page HTML`, `Image SVG`, `Canevas` in French), or `labels.artifactTypes`; app kinds still take precedence. Standalone panels can pass that map as the third argument to `typeLabel(artifact, kinds, labels.artifactTypes)`.

The question card (`ask_user`) shows options and a free-text field (unless the call sets `allowFreeText: false`); a call with `questions: [{ question, options? }]` (up to 8) is one form with option chips and a free-text field per question, answered as one text (`formAnswer`: `1. question\n→ answer`, a blank one as `labels.skipped`). `QuestionCard` is exported for a host's own surfaces. The copied `artifact.ts` repeats the descriptor validator of `@hachej/boring-agent/artifacts` because a registry item cannot import it; a source test keeps them equal. The item is also usable in a narrow container: touch targets of at least 40px on small or coarse-pointer screens, 16px composer text, Enter inserts a newline on touch devices, and pickers and menus open as a bottom sheet or full-width popover.

## Inline images in `pi-chat`

Native user images and tool-result screenshots appear as rounded, aspect-preserving thumbnails (240px for a single image, a small grid for several). Tool screenshots stay visible outside folded activity and remain available in its details. Only the same raster MIME types and base64 accepted by composer thumbnails are displayed; image URLs and SVG are not fetched.

Without `onOpenImage`, tapping a thumbnail opens the message's gallery in the shared `ImageViewer`: a full-viewport phone Dialog with pinch/pan, double-tap zoom and downward swipe to dismiss at fitted scale; a centred desktop Dialog with Escape and left/right arrow navigation. Close and navigation targets are at least 48px. Labels follow English/French locale or host overrides. A supplied `onOpenImage(image)` takes precedence. `AgentWorkspace` reuses the viewer for its default image opener, including the conversation-files menu.

Evidence: `test/contracts/pi-chat-file-cards.test.mjs`, `test/ui/workspace-file-opener.test.mjs` and `APP_ONLY=inline-images APP_EVIDENCE=.cache/evidence/D214 npm run workspace-app:journey`. The journey uses fictional native messages and screenshots on desktop and 390px touch; device emulation does not qualify real-phone Safari behaviour.

## File cards and paste-to-file in `pi-chat`

A sent message that mentions an upload (`@uploads/<path>`, what `attachments` saves) shows the file as a card above its text bubble (`message-files`; each card is a `message-file` item holding a `message-mention` element, the id the chip had, so a journey that clicks a sent mention still finds it). The card's icon follows the extension (`fileKind` in `config.ts`: image, PDF, spreadsheet, presentation, document, otherwise file), its label is `labels.fileKind`, and the name drops the random suffix the upload adds. An image card shows a thumbnail when `mentions.preview(path, signal)` returns its bytes (`{ mimeType, data }` base64); the host reads them through its own provider, and only png, jpeg, gif and webp are drawn. The mention is removed from the drawn text only; the message content and the transcript keep it. Clicking a card calls `onOpenFile(path)`; without it, `mentions.open(path)` (the chip's opener, so a host that set it keeps the click). With neither, the card is a plain element. Other mentions keep their chip.

`pasteToFile` (default `{ minChars: 2000, minLines: 40 }`, more than either) turns a long paste into an upload through `attachments`: the file is `Pasted text <time>.md` (or `.txt`, or the French name), shown as a pending card in the composer. Its restore button (also on a failed upload) abandons the upload and puts the pasted text back where it was pasted, inserting it without deleting what was typed since; a paste over a selection removes the selection at once. Ctrl+Z does the same only while the message text is still what it was right after the paste. When the upload finishes its mention is in the composer, and Send references it like any attachment. Without `attachments` a paste stays inline. The host's `accept` still applies to the saved file, so a host whose picker refuses `.md` and `.txt` refuses pasted text too.

`fileChanges` on `PiChat` or `AmbientChat` opts into the same file-card renderer for successful native `write` and `edit` calls with a `path`. One card per path appears below the reply, outside collapsed activity, labelled Created for `write` or Edited for `edit`. A write followed by edits stays Created. Failed, pending and unrelated calls show no file card. Clicking uses `onOpenFile`, falling back to `mentions.open`; without either, the card is not clickable. This is a view of native tool results, not publication evidence or a pinned revision. It is off by default because a host's tools named `write` or `edit` need not operate on workspace files. The workspace demo enables it.

## Sent page comments in `pi-chat`

A user message carrying a page-comments report from `@hachej/boring-feedback/format` renders a compact Card instead of the raw report. `feedback-content.ts` uses the real `parseFeedback`: only a valid host observation with nonempty notes is recognised, either as the complete report or in the composer's `markdown` backtick fence. Reports inside other code fences, malformed reports, non-page reports and ordinary messages keep their existing presentation. Words before and after the fence remain text bubbles, and the native message retains the complete report unchanged.

`sent-feedback.tsx` lists each readable target followed by its note, with the report's general note when present. Captured text stays inert; the card does not resolve live elements, load resources or claim acceptance. More than three notes, or over 400 characters of note/general text, starts collapsed behind the consumer's Base UI Collapsible and Button. That button has a 48px minimum touch target on phone/coarse-pointer screens. Short reports show their notes immediately. `labels.feedbackSent(count)` names the card and disclosure: “2 comments on the page”, or “2 commentaires sur la page” with `locale="fr"`. Override it through the normal partial `labels` prop.

The block imports only the feedback package's browser-safe `/format` entry; it installs no capture UI, store or agent feature. Rendered-message and real formatter round-trip coverage is in `test/contracts/pi-chat-file-cards.test.mjs`; `npm run staged-chat:journey` records desktop/phone, light/dark and plain-message evidence under `.cache/evidence/D207/`.

## Voice messages in `pi-chat`

`voiceMessage={{ transcribe, maxMs?, upload? }}` adds a hold-to-record microphone to PiChat. Release starts upload and transcription in parallel, then submits one native text message, `@uploads/voice-<timestamp>.<extension> <transcript>`. The agent reads the transcript; history retains that same entry and the audio stays in the person's workspace. The existing composer draft is not sent or cleared. Native refusal restores only the transcript beside later typing.

Supply `transcribe(blob, signal)` and the normal `attachments.upload`, or override it with `voiceMessage.upload` of the same signature. Upload exactly one file and return its `uploads/voice-…` path with a supported audio extension. Keep the audio MIME from the Blob, including `audio/webm` and Safari's `audio/mp4`. `onFiles` returns native image attachments and is not an audio persistence API. The host owns authorization, budgets and upload policy.

Local pending user rows in the transcript show known positive duration and progress until admission; zero or unavailable duration is hidden, never presented as `0:00`. A failed recording stays there while the microphone becomes available for another recording; retry and discard always target their own row. Pending uploaded paths appear once in the conversation file list. Failed or empty transcription sends nothing and offers Retry, Send audio only and Discard. Upload failure offers Retry. Failure actions share one aligned row of native Buttons (Discard is ghost). Successful halves are retained, so retrying transcription does not upload again. Discard removes local preparation, not a file already stored by the host. Unconfirmed native admission uses the existing native reconciliation controls, never a fresh voice Retry. Custom `timeline.render(context)` hosts that enable voice must place `context.pendingVoice` in their own native transcript content, not in a footer. The shared-chat renderer already does so; no-voice timelines are unchanged.

The native controller publishes this send's immutable `ChatDraft` synchronously in `send.validating.draft` or its `outbox`, and preserves that object in `attempt.draft`. Voice uncertainty binds to that exact draft and its native request ID, never equal text. Compatible custom controllers must preserve these public snapshot identities for voice admission/reconciliation.

Pressing does not move focus. Slide off, Escape, blur or a hidden page cancels a held recording; browser pointer cancellation keeps it like a release. Space and Enter support keyboard holds. `maxMs` limits capture, not permission to send before release. Replace the controller when an authenticated actor, initiator or workspace binding changes outside its public runtime/scope/principal/conversation identity. Unmount and target changes abandon local preparation without stopping admitted Pi work.

User uploads with the reserved `uploads/voice-` prefix and webm, ogg, m4a/mp4, mp3 or wav extension render a voice bubble with the transcript. Other audio stays a plain file card. Playback lazily reads `mentions.preview(path, signal)`, which must return the stored audio MIME and base64 bytes, not a filename-derived video MIME. Optional `mentions.audioUrl(path, signal)` supplies an authorized HTTP(S) playback URL instead. The host's media CSP must allow Blob URLs or its signed-URL origin. Duration is unknown until lazy loading yields metadata or decoded bytes; after pausing or ending, the play control retains the total duration. Locally created Blob URLs are revoked on provider replacement and unmount.

For the app shell, `AgentSpec.voice.send: 'message'` uses the same preparation hook and existing TalkButton, with no second composer microphone. Its `upload` overrides `chatProps.attachments.upload`; `auto` and `draft` retain their text-only behavior. An actionable message failure at the phone's peek reveals half once without focusing the composer. The person can still collapse the layer while keeping the failed recording. Existing modal accessibility focus handling remains in effect; half/full and desktop states are not changed.

`npm run app-shell:journey:voice` drives fictional native turns, workspace persistence, reload and replay with Chromium's fake microphone, at phone and desktop sizes. Screenshots and logs belong under `.cache/evidence/D111/`. Physical iPhone/Android capture and playback still need the consuming app's device checks after its Factory integration.

## Natural presentation in `pi-chat`

`presentation="natural"` on `PiChat` or `AmbientChat` is for people who should read a conversation, not a trace. It changes rendering only: the controller, the native entries and the stored history are untouched, and without the prop the output is unchanged. The chat then shows the person's messages (text, images, attachments), the assistant's text, question, approval and artifact cards and the interrupted notice. It hides tool steps (including `renderTool` and `groupTool` output, unless a card is `required`), reasoning, system and event rows, unmatched tool failures and the working shimmer, and it derives as a non-developer whatever `mode` says. Raw error text is replaced by the `responseFailed` label, and a blocked send shows `sendUnavailable` instead of the controller's reason. File discovery for the "files" list skips `read`, `write` and `edit` calls and keeps artifacts, mentions, drafts and images.

One status, `<p role="status" data-testid="preparing">` with the `preparing` label (default "Preparing…", FR « En préparation… », customisable through `labels`), replaces the agent status, compaction and "working" lines while the agent works, retries or compacts. It is absent once the work ends (also after a confirmed stop) and while a question or approval waits for the person. An unconfirmed stop keeps it next to the existing stop notice; a lost connection keeps its own notice.

Limits: assistant prose that narrates technical work is kept (nothing is stripped by pattern), and a host `renderTool` card is hidden unless it is `required`; a running `present` card is its own status. Use `mode="developer"` without the prop to see everything.

## Regular chat or shared chat

Choose the copied item explicitly. The headless package root stays lean; channel data is available only from the existing `@hachej/boring-ui-kit/shared-chat` subpath.

**Regular chat** installs no shared-chat files or imports:

```sh
npx shadcn@4.21.5 add <registry>/pi-chat.json
```

```tsx
import { PiChat } from '@/components/pi-chat/pi-chat';
// Keep your existing native or useRemoteChat controller.
<PiChat controller={nativeController} />
```

**Shared chat** adds the optional presentation item, its `pi-chat` dependency and missing existing theme tokens, not `pi-app`:

```sh
npx shadcn@4.21.5 add <registry>/shared-chat.json
```

```tsx
import { PiChat } from '@/components/pi-chat/pi-chat';
import { useSharedChat } from '@/components/shared-chat/shared-chat';
const shared = useSharedChat(source, { locale: 'fr' });
return shared.chatProps ? <PiChat {...shared.chatProps} /> : null;
```

For a page that already installs `pi-app`, use its existing workspace provider and controls:

```tsx
const shared = useSharedChat(source, { locale: 'fr' });
return <AgentWorkspace {...hostProps} {...shared.workspaceProps} />;
```

If adding native chat options, merge rather than replace the composition: `chat={{ ...shared.workspaceProps.chat, draftKey: 'team' }}`. A host that owns a fixed shared controller can render `<SharedChat controller={controller} locale="fr" />` instead. Shared EN/FR label overrides belong to `useSharedChat(source, { labels })`, or `SharedChat.participantLabels`; ordinary PiChat labels remain separate.

### Generic PiChat composition seams

- `timeline: { count, render({ focusComposer, openFile }), afterSend? }` replaces only the transcript. Without it, native rows, paging and scrolling are unchanged. It does not manufacture native messages or IDs.
- `composerHeader`, `composerHasContent` and `onPickFiles` let a host supply draft context and defer files. Existing `composerChips` and `controls` remain ordinary slots.
- `mentions.listLabel`, `icon`, `renderOption` and `renderSent` customize the existing catalog and sent-token rendering, without participant policy in the picker.
- `renderConnectionError` lets a host render an authorized error. `MessageText`, `Markdown` and `useTranscript` are reusable presentation helpers.

The neutral `ChatController`/`ChatSnapshot` structural types live at `/native-chat`. Concrete native controller APIs and return types are unchanged. Optional `shared-chat` owns its own messages, grouping, cards, quotes, traces, membership and mention catalog. Its transcript uses the same scrolling and UI primitives, without projecting host messages into Pi rows.

`npm run test:pi-chat-consumer` checks a real isolated regular install and a browser bundle with no shared files or data module. `npm run test:shared-chat-consumer` installs the optional item, checks its declarations and mounts a fictional send/card-action flow. Both run `boring-ui-blocks check` on the installed files.

## Shared conversations

`createSharedChat(source, { conversationId })` from `@hachej/boring-ui-kit/shared-chat` adapts a host-owned multi-party log to the generic renderer contract. The optional `shared-chat` registry item exports `useSharedChat(source)`, returning the controller, conversations, error, `chatProps` and `workspaceProps`. The conversations appear in the existing History, without kit-side filtering or another sidebar.

Multi-party conversation policy is a host concern Pi does not cover. Pi owns each agent's single conversation. The host forwards to the PM's Pi conversation and posts permitted replies into its shared log. The kit runs no agent and enforces no visibility, role or speaking rules. Delegation to internal agents is the host's business and stays out of the channel.

The additive `ChatController` renderer contract accepts concrete native controllers and shared controllers. Native controllers keep their numeric Pi IDs and full native APIs. The optional item renders authors, request cards, members and live status through composition, without inventing native entries. Regular PiChat never inspects shared metadata. Other people and agents use the same left-aligned muted bubbles, with a small muted name above each consecutive author group. One small Avatar sits bottom-left beside the group's last item, including a final request card. People use initials; agents use a Bot fallback with an accessible Agent label instead of a badge. A change of author or `via`, or a gap over fifteen minutes, starts a new group. Group gaps are 24px and continuation gaps 8px. Own messages remain right-aligned, without a name or avatar, in the theme's `primary` bubble with `primary-foreground` text (Bubble `default`), so a dark-ink theme shows ink bubbles with white text; mentions inside inherit that text colour. Each author group's name is followed by a muted role line, for example `Léa · member`, `Mira · owner` or `Reminder agent · the app’s agent` (see [Role lines](#role-lines-and-card-actions)). A centered localized timestamp appears before the first message and after gaps over fifteen minutes, replacing the beginning-of-conversation line. Sent mentions show an inline small Avatar and medium-weight name aligned on the surrounding text baseline, without `@` or a pill. The composer still inserts stable member-ID tokens. The bar has no live-status dot. Reconnecting and offline show a localized Tooltip and muted or destructive dot, with an `aria-live` announcement.

The package exports these host data shapes:

```ts
type Member = { id: string; name: string; kind: 'person' | 'agent' | 'admin'; role?: 'owner' | 'validator' | 'member' | 'admin' | `agent:${string}`; roleLabel?: string; avatarUrl?: string; presence?: 'here' | 'away' };
type Conversation = { id: string; title: string; kind: 'main' | 'admin' | 'direct' | string; members: string[] };
type CardAction = { id: string; label: string; variant?: 'primary' | 'secondary' };
type Card = { requestId: string; title: string; line: string; since?: string; state?: string; action?: CardAction; actions?: CardAction[] };
type Step = { label: string; detail?: string; status: 'running' | 'done' | 'failed' };
type ChannelMessage = { id: string; conversationId: string; author: string; at: string; via?: string; text?: string; card?: Card; mentions?: string[]; replyTo?: string; attachments?: { path: string; title?: string }[]; steps?: Step[]; streaming?: boolean; removed?: { by: string; at: string }; clientId?: string };
type ChannelEvent =
	| { type: 'message'; message: ChannelMessage }
	| { type: 'delta'; messageId: string; conversationId: string; text: string }
	| { type: 'step'; messageId: string; conversationId: string; index: number; step: Step }
	| { type: 'presence'; members: { id: string; presence: 'here' | 'away' }[] }
	| { type: 'members'; conversationId: string; members: Member[] };
interface ChannelSource {
	me: Member;
	conversations(): Promise<Conversation[]>;
	members(conversationId: string): Promise<Member[]>;
	history(conversationId: string, opts: { before?: string; limit: number }): Promise<{ messages: ChannelMessage[]; before?: string }>;
	send(input: { conversationId: string; text: string; mentions: string[]; replyTo?: string; clientId: string; attachments?: File[] }): Promise<ChannelMessage>;
	action(input: { conversationId: string; requestId: string; actionId: string }): Promise<void>;
	remove?(messageId: string): Promise<void>;
	canRemove?(message: ChannelMessage): boolean;
	subscribe(conversationId: string, onEvent: (event: ChannelEvent) => void, onStatus?: (status: 'live' | 'reconnecting' | 'offline') => void): () => void;
}
```

`at` and `since` are ISO timestamps. History pages are chronological, newest page first, with an opaque `before` cursor for the preceding page. A `message` event replaces the message with that ID. A `delta` appends text and marks an existing message as streaming. A subsequent complete `message` with `streaming: false` settles it. Reconnect reads history backward to the last known message, then deduplicates by message ID and `clientId`. Messages and pending sends remain local presentation state, not another durable transcript.

The existing `@` composer picker lists agents first, then people, and matches names and IDs. It inserts stable member-ID tokens such as `@pm` or `@worker`. The adapter sends resolved IDs in `mentions`, including when names collide. Files selected in shared mode go to `send.attachments` as `File[]`. Received attachment paths open through the workspace's existing file opener. `replyTo` renders a compact muted quote with the author's name and first line, or the parent card title. Click it to reveal and scroll to the parent through the existing transcript and earlier-history controls. An agent message or card has an icon-only Reply action. It puts a removable quoted chip above the existing composer; Send passes the parent message ID in `replyTo`. The host routes it to the same request. There is no thread panel. Delete appears only when both `remove` and `canRemove` exist and the host permits it. There is no copy-link action.

Under CH-10, optional `ChannelMessage.via` names the person's personal agent, for example `Claude` or `ChatGPT`, that posted their message through the hub MCP. The author remains the person, with their name and avatar; my own message keeps the existing user bubble. The `sharedVia(name)` label adds muted `via Claude` after the name, with no Agent badge or agent avatar state. A change of `via` starts a new author group so the attribution is not hidden by a preceding manual message. The host supplies and validates this attribution; browser `send` inputs do not claim it.

Agents remain participants, with a Bot avatar and the same muted bubble as people. Plans reuse streaming Markdown inside the bubble without the native assistant Copy/Fork footer. The fictional demo exposes PM and Data; PM proxies product work and carries its own trace. The kit does not impose that membership policy on other hosts. Agent IDs use a stable unsigned 31-based string hash modulo five to select the existing standard chart tokens. Their Bot icons use that token; names and mentions use only AA-qualified default-palette text colours, otherwise foreground. People stay neutral. No host colour field was added. The theme fills in previously missing standard shadcn chart values and Tailwind bindings, not a new feature palette. Hosts overriding those values must recheck contrast. One request card is replaced by subsequent messages with the same message ID. A completed card can change its line and action to the result, for example `On attend votre essai` and `Essayer cette version`; the Button still only calls `action()`. The request card attaches beneath the PM's group at the bubble maximum width. The demo does not repeat its result as another status message. Reply is positioned beside the message, visible on desktop hover or keyboard focus, or after phone long-press. On narrow screens a focusable message also exposes Reply through Shift+F10 or the Context Menu key. It never occupies a separate footer under the trace.

### Role lines and card actions

The role line comes from the member data the host already sends. `roleLabel`, when set, is shown as is (« the coach »). Otherwise the labels' `sharedRole(member)` derives it: `owner`, `validator` and `member` read as themselves (French: propriétaire, validateur, membre); any agent (`kind: 'agent'` or `role: 'agent:<name>'`) reads `the app’s agent` (« l’agent de l’app »); the admin keeps its Admin badge and no line; a person without a role has none. Override the words through `participantLabels={{ sharedRole: member => … }}` on `SharedChat` (or `labels` in `useSharedChat(source, { labels })`); return `undefined` to hide a line.

A card offers its choices through `actions`, for example `[{ id: 'build', label: 'Build it' }, { id: 'later', label: 'Not now' }]`. Without a `variant` the first is primary (the theme's `default` Button) and the others secondary; an explicit `variant: 'primary' | 'secondary'` wins. The single `action` still works and is used only when `actions` is absent; `cardActions(card)` from the kit returns the effective list. Each button calls the controller's `action(card, actionId)`, which calls the source's `action({ conversationId, requestId, actionId })` with that id (the first when it is omitted) and refuses an id the card does not offer. While one runs, all of the card's buttons are disabled. The card is an outline Item, like the other conversation cards, so its border follows the theme's `--border` colour and `--border-width`, never the stock Card's `ring-foreground/10`.

`Card.state` is the platform's lifecycle ID. The exported `channelAvatarStates` table maps `building`, `executing` and `checks` to `working`; `asked` to `thinking`; `question`, `answer`, `review` and `preview` to `waiting`; `platform` and `fixing` to `blocked`; and `live` to `done`. `declined`, unknown and missing states are neutral, with no indicator. Each agent avatar reflects its latest card in this conversation. Working, thinking and done use a primary dot; waiting uses muted-foreground; blocked uses destructive. Avatar indicators are static corner dots, with no spinner. Hover shows the card's `line` in a Tooltip; a phone tap opens a bottom/start Popover below the avatar, dismissed on scroll. No lifecycle state grants permission or starts work.

`ChannelMessage.steps` is rendered by the optional item's host trace using the same Trace primitives, not native `ActivityBlock`/`ToolCard` branches or fabricated Pi tool calls. A `step` event sets or replaces `steps[index]` on the specified message. While streaming, the list defaults collapsed. Its working line shows one Spinner, the current step label and progress. Expanding removes the summary Spinner and shows the step icons, with only the current running step spinning. Completed steps show a check and failed steps a destructive icon. When streaming ends, the list collapses to a localized `N steps` label with no Spinner and can be expanded. Each agent message owns its own trace, so simultaneous agents stay separate. If an agent has multiple streaming messages, only its latest message owns a loading indicator.

When `detail` is present, it appears beneath the label, smaller, monospace and muted. The kit displays whatever the source sends. Under CH-8, the **host strips `detail` outside the admin conversation** and keeps labels plain. Renderer mode is not an authorization or redaction boundary.

Sends reuse remote chat's transport outbox helper. An unconfirmed acknowledgement retains the exact payload and `clientId`. Only an explicitly retryable failure permits replay after reconnect or a manual retry. A permanent host refusal restores the draft and shows the host's message. An opaque or malformed reply stays unconfirmed without replay; Check the original submission can reconcile it from history. The host must implement idempotent send by `clientId` and echo that same value in its response and message event. Disposing the adapter releases its own subscription, not the source or agent. Request-card actions call `action` once per button activation; the host decides their effect and posts replacement cards.

`createChannelSocket({ url, fetch?, routes?, open?, reconnectMs? })` resolves a `ChannelSocketSource`, extending `ChannelSource` with `space` and `join()`. `url` is the **app URL**, for example `https://app.example/`, not a space URL. The default follows the platform's [app host](https://github.com/hachej/boring-factory/blob/14fda52003d361dd8022d74656bb8886384e4a59/services/channel/host.mjs). `fetch` adds host credentials. Bootstrap `POST _channel/me` returns `{ space, me }`; that `space` supplies the live URL. `open(url)` supplies WebSocket authentication, such as host subprotocols. The default reconnect backoff starts at one second and stops at 30 seconds.

Every HTTP operation is `POST <app>/_channel/<op>`, with `Content-Type: application/json`:

| Operation | JSON body | Result |
| --- | --- | --- |
| `me` | `{}` | `{ space: string, me: Member }` |
| `conversations` | `{}` | `Conversation[]` |
| `members` | `{ conversationId }` | `Member[]` |
| `history` | `{ conversationId, before?, limit }` | `{ messages, before? }` |
| `send` | `{ conversationId, text, mentions, replyTo?, clientId, idempotencyKey: clientId }` | `ChannelMessage` |
| `action` | `{ conversationId, requestId, actionId, idempotencyKey }` | Host result; the adapter generates a fresh key for this activation. |
| `remove` | `{ messageId }` | Host result |
| `join` | `{}` | `{ space }`; `join()` resolves after validation. |

Live uses WebSocket `GET <app>/spaces/<space>/live`, with no conversation query. It carries one JSON `ChannelEvent` per frame. The host authorizes the feed; the source forwards the selected conversation's events and presence updates.

Errors are `{ error: { code, message, retryable } }`. Exported `ChannelRequestError` preserves these fields, and the UI shows `message` for sends and card actions. Reads and actions do not blindly retry. Send transport loss is explicitly retryable uncertainty; outbox replay reuses the original key. For custom sources, throw `ChannelRequestError(code, message, retryable)` to declare retryability; `{ refused: true }` as its fourth argument declares a confirmed refusal rather than an unknown outcome.

`routes` still overrides `conversations`, `members`, `history`, `send`, `action`, `remove` and `canRemove` independently. There is no built-in REST fallback. Delete stays hidden unless the host supplies `canRemove`. JSON cannot upload `File[]`: the default rejects files before sending; supply a host `send` override that uploads through the workspace provider, or a custom source. HTTP data and socket events are schema-validated. The host must authorize every read, subscription, send, attachment and action; the renderer grants no authority.

`createFakeChannelSource(seed)` uses the same source contract for fictional demos and tests. Its `emit`, `setStatus`, `sends` and `actions` controls drive live updates and inspect host calls. See the [shared conversation demo](../examples/shared-chat/README.md) and run `npm run shared-chat:journey` for phone-first browser evidence.

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

**Breaking (2026-10-22): comment mode.** `feedback`: `PointBar` is renamed `CommentBanner` and is shown on wide screens too (at the top, while hover targeting); Annuler and « Utiliser l'app » are replaced by an on/off switch (`data-testid` `feedback-comment-switch`; `feedback-point-cancel` and `feedback-point-use-app` are gone), and the count is of notes that say something (`N notes`, absent at 0). The pin's Alt hint (`feedback-bubble-hint`) is gone, its label names the element in plain words (`plainElement`), and its mic is held to record (it now needs `pi-chat`'s `use-hold-to-record`, installed with it): on release the transcript is appended and the note saved. Labels: `altHint`, `pointHint`, `pointCancel`, `pointUseApp`, `pointUsing` and `pointBar` are removed; `commentMode`, `commentSwitch`, `commentTap`, `commentClick`, `commentPaused`, `commentSent`, `element` are added. New: `useCommenting(session)`, `useSendEachNote(session, send)`. `app-shell`: the agent layer renders `CommentBanner`, and Back ends comment mode. `pi-app`: `AgentWorkspace` takes `barPanels` (`WorkspaceBarPanel { id, label, icon, content(close) }`: the host's own panels in the bar, after Library) and `panelWidth` (the side panel's opening width, a fraction of the workspace when at most 1, else pixels; `ArtifactWorkspace`'s `defaultWidth` accepts the same). `viewers`: `ViewerFrame` takes `mainControl`, a control that stays in the header at every width (`<testId>-main`) while `controls` fold into « … » on a phone. Run `npx shadcn add` for `feedback`, `app-shell`, `pi-app`, `pi-workspace` and `viewers` again together.

**Breaking (2026-10-14): `pi-chat`, `button`, `dock`, `feedback` and `app-shell` no longer install the theme.** Before, `shadcn add` of any of them merged the shadcn tokens and radius steps into the host's CSS. Now they ship no global tokens, so a shell or a standalone block cannot clobber a host's theme. A registry consumer that relied on the automatic tokens (a host with none of its own) must add `<registry>/theme.json` to the same `shadcn add`; a host that already defines the tokens changes nothing.

**Breaking (2026-10-14): one annotate toggle replaces the Feedback block.** The composer showed a Feedback button, « Show in app », and, in feedback mode, a bar (`N notes`, Record, « Ask a general question », Use app, Done, ✕). It is now one annotate toggle and a count chip. `ComposerFeedback` shrank from `{ start?, point?, active?, pending?, chip?, bar?, attach?, sent? }` to `{ annotate, active, count, clear, attach, sent }`; `useComposerFeedback(session, { entry })` is `useComposerFeedback(session)` (touch and compact screens enter point mode by themselves). Replace `feedback.start` and `feedback.point` with `feedback.annotate`, `feedback.pending` with `feedback.count > 0`, and stop reading `chip` and `bar` (the composer draws the count chip; `AmbientChat` no longer docks a bar). `data-testid` `composer-feedback` and `composer-point` are now `composer-annotate`; the chip is `feedback-count`. `labels.feedback`, `feedbackHint`, `point` and `pointHint` are replaced by `annotate`, `annotateHint`, `annotateNotes` and `annotateClear`. `NoteBubble` loses « Ask a general question » and the general-question dialog (a general note is the plain chat; `captureGeneral` and `askGeneral` stay in the session API), gains a mic (`transcribe` prop) and an « Add note » button, and shows the Alt hint on desktop. Run `npx shadcn add` for `pi-chat`, `pi-ambient` and `feedback` again together. Picking, masking and anchoring are unchanged.

## Panel (`pi-workspace`), History and queue (`pi-chat`)

`ArtifactWorkspace` (`pi-workspace/workspace.tsx`) lays out the chat with a right-hand panel: it slides in at full height, the full-height divider resizes it (pointer and arrow keys, width kept for the session; double-click resets it). Both `split` and `inset` keep a quiet 1px `border` seam with a centred 12px hit area. Hover, keyboard focus and dragging strengthen it to 2px in `ring`. Docked agent panels use the same seam, the panel can go full screen (Escape leaves) and below `sheetBelow` it is a full-screen sheet. Opt in with `floatBelow={320}` and the chat can float: dragging the divider until the chat is narrower than that shows a dimmed "Release to float the chat" hint, releasing floats it, Alt+Left on the divider or "Float chat" in the viewer "…" menu (pi-app's `AgentWorkspace` turns `api.floatChat` into one of the `ViewerWindow.actions`, see [host actions](#labels-icons-and-host-actions)) does the same, and the panel takes the full width. `chat` is then a function `({ floating, dock }) => node`: return the docked `PiChat` or, while floating, `<AmbientChat controller={same} onDock={dock} defaultState="expanded" />` with the same props. Both use one controller, so transcript, queue, draft and the single watch stream carry over (`PiChat`/`AmbientChat` only borrow it). Dock returns the chat at the last width above the threshold; the floating state is remembered for the session, closing the panel docks, and the phone sheet ignores it. Off by default. It owns layout only; what is open is the host's, and the viewer inside uses `ViewerFrame`, which shows an Enter/Exit full screen button when wrapped in `ViewerWindowProvider` (viewers item). It is its own block (`pi-workspace`) because it is self-contained and driven by props; the studio uses it for artifacts and workspace files. Pass `conversations={{ items, activeId, onSelect, onNew }}` to `PiChat` and the header History button opens a searchable list of past conversations (the open conversation's persisted records stay reachable at the transcript top, even with `header={false}` or `showHistory={false}`). A message sent while the agent works waits in a compact queue strip against the composer: one muted, single-line preview per message, icon-only Steer now and remove actions, and Edit under the “…” menu (steer and edit need `actions.withdraw`). The controls keep accessible names and title hints, with 48px targets on small or coarse-pointer screens. Steering shows an icon and a screen-reader status, not a text badge. The composer has no mode toggle or visible Queue label: desktop Enter still queues, and the named queue icon provides the touch action. Enter empties the composer at once; a message sent while the previous one is still being confirmed shows as a "Sending" row (the controller's `outbox`) until it is submitted, and a refused message comes back into the composer above what was typed since.

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

## Point and dictate on app data (`agent-target`)

Install `<registry>/agent-target.json` beside the app shell. Pass `labels={agentTargetLabelsFr}` from `agent-target/agent-target-labels` for French, or override any `AgentTargetLabels` fields; omitted labels keep English defaults. It requires the kit patch that adds `NativeChatController.submissionStatus`; the already-published 0.4.3 kit does not provide it. Release versioning and Factory D-87 pins/vendor/fleet sync are a separate handoff. It uses the host's shadcn Button, Card, Message and Bubble, with the shell's existing controller; it never opens the chat drawer or creates a second chat. It installs no theme. See the [marking guide](../docs/guides/agent-target.md) for the data boundary and lifecycle.

```tsx
<Button data-agent-target={JSON.stringify({ meal: 'm-42', slot: 'lunch' })}>
  Fictional lunch
</Button>
<AgentTargetMode enabled={pointing} transcribe={transcribe}
  onSettled={({ target }) => { if (typeof target.meal === 'string') void refetchMeals(target.meal); }} />
```

An enabled tap picks the nearest marked ancestor and starts recording. Stop transcribes and sends one `<target>{…}</target>` block followed by the spoken text **in the user message**, not hidden request context. The transcript shows the block as a chip. Refusal restores only the person's words to the same chat draft. Only a JSON object in the selected attribute is supported, capped at 1,024 UTF-8 bytes; invalid or oversized values are refused before the microphone opens. No sibling dataset attributes, page text or feedback snapshots are collected. `attribute` defaults to `data-agent-target`.

Escape, an outside tap, disabling the mode and unmount release local microphone/transcription/observation work. They do not abort an already admitted native submission. `onSettled({ target, reply, ok })` fires once for an observed outcome; `ok` means an answered native submission, not proof of a domain mutation. The host still authorizes every tool and owns refetching. `useDictation({ transcribe, onText, locale?, labels? })`, exported by `app-shell`, supplies the same start/finish/cancel lifecycle to this bar and the shell's push-to-talk.

The fictional [app-shell journey](../examples/app-shell/journey-target.mjs) drives fake microphone/transcription and a scripted native answer at 390px and desktop (`npm run app-shell:journey:target`). Its refresh calls a fixture list endpoint; it does not qualify a real meal-editing tool, speech service or physical phone keyboard.

## Agent layer (`app-shell`)

`AgentLayerProvider` takes `agent` (one assistant) and `improve` (the product manager, shown from the account menu); each is `{ controller, chatProps?, voice?, feedback? }`, a borrowed `NativeChatController` rendered by `PiChat`. `AgentLayer` is placed once; `AgentTrigger` opens it; `useAgentLayer()` gives `{ agent, state, showing, open(which?, at?), close(), expanded }` (`agent` is the app’s existing controller, even while the product manager is showing). Nothing else is configurable (the layer's words: the agent's `chatProps.locale`, then the shell's `locale`, then English). On a phone (below 768px, the shadcn `useIsMobile`) it is the explicitly installed `drawer` recipe (public Base UI) with three fixed snap points: a peek (8rem above the tab bar `--app-shell-tabbar`, one composer row and a line of the last reply, the page stays usable), half and full. A swipe, an outside tap and a lost focus never close it: they go to peek (half without an `agent`), so the coach stays reachable; only the handle and the title row drag, the transcript scrolls; the close button and Back close it; Escape steps it down to peek like a swipe (half without an `agent`), so the coach stays reachable, and at peek there is no close button, so it is closed from half or full; focusing the composer goes to full and keeps it above the soft keyboard. On a wide screen it is the `sidebar` on the right, not modal. `voice` adds push-to-talk (hold the trigger or the hero button; `send: 'auto'` submits the transcript, `'draft'` (default) fills the composer). `useAgentContext({ name, params })` registers the current screen; `useRemoteChat({ ..., requestContext: readAgentContext })` sends it as the submit's `context` (with a `placement` beside it: `PiChat` reports `docked` unless its `placement` prop says otherwise, `AmbientChat` `floating`, and the layer reports `floating` for the phone drawer and the floating panel; see [PAGE-TOOLS.md](../docs/architecture/PAGE-TOOLS.md)) and the host renders it with `createPromptContext` (see `packages/agent/README.md`). `useBackLayer` is the one Back manager (`point < sheet < agent < stack`). Point mode for `improve` is wired: « Montrer dans l’app » hides the sheet and the feedback item's `CommentBanner` sits above the tab bar; Back ends comment mode. Example and journey: `examples/app-shell/` (`npm run app-shell:journey`); the shadcn components there are pinned fixtures for type-checking only. Reply actions use 44px touch targets.

On phones, the peek strip is the persistent resting state when an `agent` is set: swipe-down, outside tap and Escape step down to peek, and there is no full close from peek (owner ruling 2026-10-14). Apps with only `improve` have no peek.

Host actions: `headerActions` on the `agent` or `improve` spec are icon buttons in the layer's title row, typed as the screen header's `ScreenHeaderAction` (`{ id, label, icon, showLabel?, href?, target?, rel?, onSelect }`). `href` renders a link (`onSelect` still runs on click; `target` and `rel` only when given). Two are shown, the rest in « … » (a sheet on a phone, a menu on a wide screen). They sit before the dock controls on a wide screen, and before Expand and Close on a phone at half and full (none at peek). Test ids: `agent-layer-action-<id>`, `agent-layer-more`.

The screen layout (`AppShell`) takes an optional `locale` (`'en' | 'fr'`) for its own words (« Se déconnecter », « Plus », « Navigation »); the agent's `chatProps.locale` wins when it sets one; otherwise `locale`; otherwise English. The compact tab bar is `role="tablist"` (labelled « Navigation ») with `role="tab"` items (`data-testid="tab-<id>"`); the current one has `aria-selected="true"`, and « Plus » is one more tab when there are more than four screens. Tests locate tabs by these roles. The account sheet is titled « Compte » (the person's name is shown once, in the person block).

`AppShell rail="hover"` keeps the wide-screen navigation at icon-rail width. Pointer hover or keyboard focus within reveals the native sidebar's labels over the page without changing the page width. Pointer leave, focus leaving the rail, or Escape collapses it. Escape keeps keyboard focus on the current control. Touch does not trigger hover expansion, and phones keep the same tab bar. The default `rail="icon"` preserves the existing sidebar toggle and initial state for each layout. Preview the option in `examples/app-shell` with `?rail=hover&nav=dashboard`.

The account theme appears when the account gives `theme: { value, onChange }` (`value` is the resolved `'light' | 'dark'`: the host resolves `system`). The compact sheet uses the consumer's Switch. The expanded menu uses its registered DropdownMenuCheckboxItem, preserving arrow-key navigation and close-on-selection. Without `theme` there is no row. The shell's root carries the `app-shell` class in every layout, so the item's css reset (`.app-shell :where(button, [role=button])`) reaches its own header and nav buttons and the popups it portals to the body (the sheets, the account menu, the agent drawer and panel) even without preflight. No wrapper is needed. Vendoring by copying files must also copy the item's `css` into the app's global stylesheet; the files alone leave those buttons unstyled.

Conversations: the agent's chat in the layer takes the same `conversations` as any `PiChat`, through `chatProps.conversations`. Build it with `useConversations` (now in `pi-chat/use-conversations.ts`, re-exported by `pi-app`, one implementation) over the host's `createConversationsHandler` of `@hachej/boring-agent/conversations`, at a relative per-agent endpoint: `chatProps: { conversations: useConversations({ endpoint: '_agent/coach/conversations', fetch, activeId, onSelect }) }`. The header's History then opens the searchable list with New, rename, archive and delete, and replies get Fork; `onSelect` (also called by New and fork) is where the host opens that conversation's controller. The layer is a drawer or a narrow right panel, so History is the popover or sheet: the side column of `pi-app` needs a pane at least 720px wide (`history-column.tsx`) and is not part of `app-shell`.

Headless runs: `RunCard` (`pi-chat/run-card.tsx`) shows a run of `POST _agent/<name>/runs { input, idempotencyKey }` → `GET _agent/<name>/runs/<id>` (`{ id, status: queued | running | completed | failed, output?, text?, error?, agent?, startedAt?, finishedAt? }`): the agent's title, a status Badge, a Spinner and the elapsed time while queued or running, the duration once finished, the output (or text) as Markdown (structured output as JSON), and the error in an Alert. The host fetches: `<RunCard run={record} fetchRun={(id, signal) => fetch('_agent/coach/runs/' + id, { signal }).then(r => r.json())} />` polls every `pollMs` (2 s) until the run settles and offers Refresh; `parseRun` reads a record defensively. Render it from `renderTool` or `renderEntry` for a run in the thread, or anywhere in the page.

`useShellLayer(id)` (`app-shell/shell-layer.ts`) lets a full-screen view of the app (a document sheet, a pushed view) take part in the same one-layer-at-a-time rule: `const { open, close, isOpen } = useShellLayer('documents')`. Opening it closes the agent and product manager layers, and opening either of those closes it; the browser's Back closes it first (the Back manager's `sheet` layer). No `AppShell` prop is added. Any component may call `open`, so a host's handler can open the view; the view's component renders from `isOpen`.

### Open the agent from a URL

Launch links are enabled by default. `/?agent=coach&open=full&input=text` opens the app's agent and focuses its composer after the drawer settles. On desktop it opens the existing dock. `coach` and `agent` select the app's one assistant; `improve` selects its product manager. Unknown or unavailable agents open nothing. This selects a view, not an agent id or a permission.

`open` accepts `half` or `full`; `input` accepts `text` or `voice`. Missing or invalid options default to `full` and `text`. Voice always opens full with the microphone ready, leaves the composer unfocused, and never starts recording. The microphone starts only on the person's press, as iOS and Android require. On iOS, a cold home-screen launch focuses the text composer but cannot raise the keyboard automatically. One tap raises it.

The shell consumes `agent`, `open`, and `input` once on mount with `history.replaceState`. Other query parameters, the path, hash, and host history state remain. Back closes the phone layer without restoring the launch query; reload stays closed. `<AppShell agentLink={false} ... />` opts out of both opening and URL cleanup.

Use the pure helpers exported by `app-shell/index.ts` to build app-owned manifest shortcuts or `start_url` values:

```ts
import { agentLink, parseAgentLink } from '@/components/app-shell';

const start_url = '/' + agentLink({ agent: 'coach', open: 'full', input: 'text' });
// /?agent=coach&open=full&input=text
const launch = parseAgentLink('?agent=coach&input=voice');
// { agent: 'coach', open: 'full', input: 'voice' }
```

The app owns its manifest, shortcut icons, and install flow. Real iPhone and Android home-screen launches require consumer testing; the browser journey checks URL consumption, focus, Back, reload, and the idle microphone.

### Changes

- `AppShell` gained the optional `locale` prop, and the account sheet's title is the generic « Compte » instead of the person's name. Hosts that relied on the name as the sheet title will see « Compte » there.

## Placed agent (`placed-agent`: `PlacedAgentWorkspace`)

`PlacedAgentWorkspace` takes every `AgentWorkspace` prop and keeps ONE controller in two places: the page (the app's « Agent » tab) or collapsed beside the app. Extra props: `placement` (`'tab'` is a plain `AgentWorkspace`; `'tab+ambient'`, the default, and `'ambient'` add the collapse and expand actions), `collapsed` and `onCollapsedChange` (controlled; the app moves to another screen or back to the tab there), and `storageKey` (placement remembered in `localStorage` under `${storageKey}.placement`). `usePlacedAgentState(storageKey)` is that remembered flag for an app that sets it from its own navigation; `usePlacedAgent()` gives `{ mode, collapsible, collapse, expand }` to buttons inside the workspace (the bar's `controls`).

- Wide (641px and up): collapsed is a floating `AmbientChat` on the same controller (the conversation and the draft are the controller's); its Dock button expands. The page stays mounted, hidden, so its open file and panel survive; a file the floating chat names opens in the page, which comes back.
- Phone (below `PHONE_BELOW`): never the ambient overlay. Inside an `AppShell` the controller is lent to the shell's agent layer (`useAgentLoan()` of `app-shell`: `lend(spec, 'peek')`, `lend(undefined)` to take it back) and the layer opens at peek above the tab bar; its title row has « expand » (half and full), which returns to the tab. There is exactly one chat drawer, the shell's, so the header and the tab bar are never covered. A shell with its own `agent` keeps it (the loan is refused) and the workspace stays a page, as it does on a phone outside a shell. `open(which, 'peek')` of `useAgentLayer` now also takes `'peek'` (the agent only).
- A placement restored on load is lent without opening the drawer; collapsing while mounted opens it at peek.

Example and journey: `examples/app-shell` `?app=placed` (`npm run app-shell:journey:placed`, screenshots under `.cache/evidence/placed-agent/`); contract test `test/ui/placed-agent-workspace.test.mjs`.

## Whole agent app (`pi-app`: `AgentWorkspace`)

History and Library are independently placeable. `ConversationList` is the searchable history piece shared by the chat's `ConversationHistory` popover and `SessionsPane`. `FileTree` is the Library list over a borrowed revision provider. Both are re-exported from `pi-app/agent-workspace`. A host can render them inside its own nav or keep chat-header popovers. [The workspace demo](../demos/workspace/README.md) places them in icon-anchored top-bar popovers in every agent placement. They need no agent workspace or Dock.

History is a side column by default (`pi-app/history-column.tsx`): in a page or docked pane at least 720px wide it is a 260px `SessionsPane` at the pane's start, open or closed as this viewer left it (`localStorage`), and it steps aside while an open artifact would leave the chat under 360px; floating panes, narrow docks and phones keep the popover or sheet. `AgentWorkspace history="popover"` opts out; a pane of your own gets the same column from `useHistoryColumn` and `HistoryColumnToggle`.

`AgentWorkspace layout="embedded"` is the page a host embeds (an app-shell screen, a hub page, a full-screen PM page); `layout="default"` (the default) is the three-column page below. Embedded has no sessions pane and no left column at any width, and one compact top bar (`pi-app/workspace-bar.tsx`): the title (truncated; the conversation's, or with `title` the app's name that stays whatever the conversation is called, followed by the conversation title in muted text, which a phone leaves to History: test ids `workspace-bar-title` and `workspace-bar-conversation`), then icon buttons for History (the `ConversationList`), Library and New (test ids `workspace-bar-history`, `workspace-bar-library`, `workspace-bar-new`), then `chat.headerActions` and `controls`. History and Library open a popover on a wide workspace and a bottom sheet below `drawerBelow`; picking a document opens it in the artifact panel. The buttons have tooltips and accessible names, 44px on a phone. Inside an app-shell screen the buttons go into the shell's screen header instead (one row, nothing to configure): the shell provides its header's slot through `ScreenHeaderSlotContext` (`utils/screen-header-slot.ts`) and the bar renders its controls there. The artifact panel, composer, question form and `chat.belowComposer` are unchanged.

A Library also exists without a `revisionProvider`: when `resources.endpoint` answers the revision protocol's discovery (`createRevisionHandler` serves the resource calls, the listing and the change feed on one route) for the same `identity`, `AgentWorkspace` binds it and shows a read-only Library of its files in either layout (open, and version history when `resources.history` is given; no Upload). The viewers then read through that binding. A plain `createResourceHandler` has no listing, so such a page has no Library.

**No live feed.** `RevisionProvider.changes` (`GET ?op=changes`) ends with a `RevisionError` and is not retried when the route answers **501** (the intended signal that a host serves no change feed), and also **400**, which `createRevisionHandler` answers to an unknown `op` or a malformed cursor and which stays supported. `403` and `409` end it as `denied`; any other failure reconnects with backoff. `AgentWorkspace` then keeps the views' own refresh (`useChangeFeed` reports `live: false`).

`AgentWorkspace sessions={props => <MyNavigation {...props} />}` replaces its sessions rendering with host navigation. The props are exactly `SessionsPane`'s, including `conversations`, drawer state and Library content when `libraryPlacement="pane"`. Omit `sessions` to retain the existing default. `sessions={false}` leaves navigation to the host and removes the workspace toggle, while `conversations` still supplies Fork to the chat.

`AmbientChat embedded` renders its expanded conversation inline under the host's header. Changing `embedded` preserves the conversation renderer, transcript and composer DOM. The workspace demo keeps this one renderer inside its one `ArtifactWorkspace`; `Dock` changes where the whole workspace sits. Embedded submits report `docked`; floating submits report `floating`. See [placement](../docs/architecture/PAGE-TOOLS.md).

`AgentWorkspace` (`pi-app/agent-workspace.tsx`) is one page: the sessions pane on the left (`sessions.tsx` over `pi-chat`'s `ConversationList`: search, New, rename, archive with the Archived filter, delete; the header toggle hides it, remembered per viewer; the toggle stays mounted in the workspace over the chat header, so it keeps working while a switched chat connects and its header is replaced; below `drawerBelow` it is a drawer with a backdrop, closed by Escape or a choice), `PiChat` in the center (scrolling near the top loads the open conversation's persisted records into the same transcript, `historyList={false}`, and replies keep Fork), and on the right the `ArtifactWorkspace` panel with the artifact viewer (`artifact-panel.tsx`: follow the latest or pin a version from the file's history, read-only; Markdown, HTML, SVG, code), the file viewer (`file-viewer.tsx`: Markdown and HTML editable, image, PDF, text) and the host's own views. New artifacts of the open conversation open the panel unless the person closed it in this turn (not on a phone, where the panel is a full-screen sheet). Every prop is data or a callback: `controller`, `conversationId`, `chat` (the other `PiChat` props), `conversations`, `resources` `{ endpoint, fetch, identity, history?, locate? }`, `viewers` (host viewers by type or kind, for example a tldraw canvas), `interactive`, `share`, `opened`/`onOpenedChange` (controlled; `{ kind: 'artifact' | 'file' | <host kind> }`), `panels`, `fileBack`, `floatingChat`, `controls`, `chatTop`, `sheetBelow`, `drawerBelow`, `floatBelow`, `storageKey`. Hooks: `useConversations({ endpoint, fetch, activeId, onSelect, onChange? })` (the sessions list over the conversations handler, polled), `useRemoteChat({ conversationId, endpoint, fetch, identity, transport? })` (one controller per conversation over the chat transport; `transport: 'websocket'` uses one hibernatable socket, see `packages/agent/README.md`) and `useSaved` (a resource's saved text, never replacing unsaved edits). A `present` call that waits for the page (its opt-in acknowledgement, see [the agent README](../packages/agent/README.md)) is answered by `AgentWorkspace` once the built-in artifact or file viewer has mounted the presented revision (`onShown` in `ViewerOptions`): it opens the file, or refuses with `closed by user` (closed this turn), `unsaved changes` or `narrow screen`. A host viewer (`viewers`) reports no mount, so its presented files end `unconfirmed`.

Chat attachments are saved under `uploads/` and reference-only by default (`useRevisionAttachments`, below, gives a bare `PiChat` the same): the message carries each file's `@path` and the agent reads it with its file tools, so no base64 rides along in every later turn. `uploads={{ inlineImages, maxBytes, accept }}` opts back into a native image per png/jpeg/gif/webp (`inlineImages`), refuses larger files before upload with a visible reason (`maxBytes`, labelled by `attachmentTooLarge`), and sets the picker's `accept`. Saved names contain no whitespace, since a mention ends at a space.

The host mounts these handlers, each behind its own authentication (one composition, as in [`examples/workspace-app/server.mjs`](../examples/workspace-app/server.mjs), about 100 lines with the agent):

| Route the props name | Handler |
| --- | --- |
| conversations (`useConversations` `endpoint`) | `createConversationsHandler({ conversations: createConversations({ harness, context }), authenticate })` of `@hachej/boring-agent/conversations`; `authenticate` returns `{ owner, start }` |
| chat (`useRemoteChat` `endpoint(id)`) | `createChatTransportHandler({ authenticate })` of `@hachej/boring-agent/chat-transport`, opening the conversation with `conversations.open(owner, id)` |
| `resources.endpoint` | `createResourceHandler({ authenticate, reader: files, publisher: files.publication, lookup: files.reconciliation })` of `@hachej/boring-files/remote` over the workspace provider |
| `resources.history` (optional: the version menu) | `GET ?path=` returning `{ saves: files.saves(path) }` |

`examples/workspace-app` is that page and server only (`npm run workspace-app`; `npm run workspace-app:journey` drives it with the scripted model: the list, search, switching, an artifact on the right, collapse right after a switch (the toggle is the same button across it), and the phone drawer and sheet at 390px; then `?configured`, the same page rebranded through the props below, with every host action clicked, by keyboard too, and at 390px).

### Large files (blob pointers)

A large or binary file (up to 100 MB) can live in the host's blob store while the workspace holds a small pointer file, `<name>.blob.json` (`@hachej/boring-files/blob`, format in [the files README](../packages/files/README.md#large-files-blob-pointers-and-media-sniffing)). The host serves the bytes at `GET <blobBase><encodeURIComponent(id)>`, same origin, checking access on every request (an `<img>` or PDF frame sends cookies, not a bearer header) and setting disposition, `nosniff` and a CSP.

- `resources.blobBase` (default `/_files/`; with a `revisionProvider`, `resources` may carry only the blob options): a same-origin path starting with `/`. Anything else (`https://…`, `//host/`, a relative path) is refused with a `TypeError` when the page renders. `Documents` takes the same `blobBase` prop.
- The Library reads its listings through `withBlobPointers`: each pointer is resolved there once, to `{ name, size, type, url }`, and listed under its file's name, kind and size; the row's Download fetches the URL.
- The file viewer resolves a pointer where it reads it and gives the viewers a URL, never the pointer: an image inline (`<img src>`), a PDF in the PDF viewer loading the URL itself (the bytes never enter the page), anything else a default shadcn download action named after the file. A newer pointer format (`"boring:blob": 2`) shows as its JSON file with a muted note; an invalid pointer shows as its JSON file.
- `resources.uploadBlob(file, { signal, onProgress })`, optional: Library uploads above `uploads.maxBytes` go to it. The host stores the bytes and writes the pointer file itself (for example `POST /_files`), then resolves with the pointer it wrote; the Library checks it with `parseBlobPointer`, reloads its listing and writes nothing. `onProgress({ loaded, total })` drives a default shadcn `Progress` in the upload row, whose cancel icon button aborts `signal` (no error shown); a refusal rejects with `{ error: { code, message } }` and the Library shows `message`. Without `uploadBlob` a file above `uploads.maxBytes` is refused with the existing `attachmentTooLarge` message. The `file-tree` item now also installs the shadcn `progress` component.

`examples/workspace-app` has a fictional in-memory host (`blobs.mjs`, `startWorkspaceApp({ blobs: true })` or `APP_BLOBS=1`, page `?blobs`), and `npm run blobs:journey` drives it at 1440 and 390, light and dark.

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

Revisions are the public `RevisionProvider.history(path)`: one row per retained revision, newest first, with when it was saved and its source (`publish`, `agent`, `observed`, `rename` or `delete`), and its revision id. Rename/delete mark the affected retained version; receipts, not these deduplicated revision rows, are the operation audit. The list is read again when the provider's `changes` feed moves. An older revision opens read-only in the artifact panel's pinned view (text, Markdown and HTML); the newest row returns to the editable file. Images and PDFs have no older-version preview here (the panel says so).

`DocumentSheet` opens one document over the app, for a host's « Voir la fiche »: the host holds the `path` and clears it in `onClose`. `<DocumentSheet provider path onClose onShowAll locale />` is a bottom sheet of the full height that uses `useShellLayer('document')` (one layer at a time, Back closes it), with the viewer and an optional « Toutes les fiches » button that closes the sheet and then calls `onShowAll`.

Not in this item: the Library's own History button and upload (`FileTreeView` is given `upload={false}` and `history={false}`, since the revisions panel is the history). The Library's buttons are 44px on a coarse pointer through the documents item's own CSS, not by changing the file tree.

Words: `documentsLabels(locale, labels)` over `defaultDocumentsLabels` and `frenchDocumentsLabels`, and the viewers' words through the pi-app labels. Journey: `npm run app-shell:journey:documents` (the example's `?documents=1` page: a Fiches screen, and « Voir la fiche » in the product manager's layer).

## Install into a new app (tested with a fresh outside app)

Nothing is published, so a consumer needs a package source for the private `@hachej/boring-*` packages. The first pass at A46 used the steps below in a Vite, React 19 and Tailwind v4 app created by the pinned CLI (`npx shadcn@4.21.5 init -t vite -b base -p nova -n app -y --no-monorepo`).

1. In this repository: `npm ci && npm run build && npm run registry:build`, then `npm pack ./packages/ui ./packages/files ./packages/agent --pack-destination <dir>`.
2. Serve the tarballs as an npm registry for the `@boring` scope (a ten-line static registry that returns a packument with `dist.tarball`, `dist.integrity` and the package's own manifest is enough) and put `@boring:registry=http://127.0.0.1:<port>/` in the app's `.npmrc`. This is required because every item lists `@hachej/boring-ui-kit@0.0.0` as a dependency and the CLI runs `npm install` for it. `file:` tarball specs in `package.json` do not help: the CLI still installs `@hachej/boring-ui-kit@0.0.0` by name.
3. Serve `public/r/` over HTTP and run `npx shadcn@4.21.5 add http://127.0.0.1:<port>/r/pi-chat.json http://127.0.0.1:<port>/r/viewers.json http://127.0.0.1:<port>/r/markdown-editor.json -y`. Files land in `src/components/pi-chat/`, `src/components/viewers/`, `src/components/button/`, `src/components/utils/` and `src/components/markdown-editor/markdown-editor.tsx`; registry dependencies are the published release's jsDelivr URLs, so an unpublished build serves only its own items locally (the consumer harness serves the dependencies too); scoped CSS is merged into the app's CSS file. Re-running with `-o` is idempotent.
4. Install the server side with exact pins: `@hachej/boring-agent`, `@hachej/boring-files`, `react@19.3.0`, `react-dom@19.3.0`, `@earendil-works/pi-durable@1.0.1`, `@earendil-works/pi-ai@1.0.1` and `@earendil-works/chord@1.0.1`. Node 22.19 or newer runs a TypeScript server with `node server/main.ts` (SQLite resources use `node:sqlite`).
5. The shadcn Vite template's `npm run typecheck` is `tsc --noEmit` over a solution file with `"files": []` and checks nothing. Use `tsc -p tsconfig.app.json --noEmit`; the installed source passes the template's `strict`, `noUnusedLocals` and `noUnusedParameters`.

## Build and install

Run `npm run registry:build` with the pinned shadcn 4.21.1 development dependency. The command generates the registry index and the item JSON files under `public/r/` from `registry.json`. The source contract test rebuilds the item and compares its contents.

With the exact package dependencies available through the host's package distribution, run the standard CLI in an existing React application with a valid `components.json`:

```sh
npx shadcn@4.21.5 add /absolute/path/to/public/r/markdown-editor.json
npx shadcn@4.21.5 add /absolute/path/to/public/r/html-viewer.json
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
| Nested shadcn Trace lines for activity summaries, tool output and reasoning; host Spinner for working text | `activity.tsx`, `tool.tsx`, `shimmer.tsx` |
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

Each uninterrupted run of tool calls and reasoning is a shadcn `Trace`. Its summary expands into steps, and a detailed step expands into arguments and output. Running lines use Trace's native `running` state and Spinner, failed lines use `error`, and queued user messages use `pending`. Failures open automatically unless the reader has chosen otherwise. `expert` mode keeps successful steps plain and exposes failed output. `developer` mode also exposes successful output and reasoning. Text splits activity runs. Approval, question, artifact, feedback and host `renderTool` cards keep their existing placement outside the activity. `groupTool` still decides which tools join a summary. Nothing changes in native model input.

`pi-chat` declares the bare `trace` built-in and imports `@/components/ui/trace`. The repository's pinned **shadcn@4.21.4** successfully installed the Base UI `base-nova` variant in a disposable app on 2026-10-15. Consumers use only the Base UI `base-nova` style. Re-run `shadcn add` when upgrading the copied chat. No Trace source is vendored into the item. The local demo/typecheck fixtures are CLI output from [the Base UI registry](https://ui.shadcn.com/r/styles/base-nova/trace.json), SHA-256 `8533d800f5216797578f0954bf917aed6b8cd48016f73975c6a4caaf7ab539d4`. The [upstream source revision](https://github.com/shadcn-ui/ui/blob/4233ed1caded8c38f4bc14b14afe1f93ebcaf966/apps/v4/registry/bases/base/ui/trace.tsx) and fixture headers record provenance. The CLI resolves future consumer installs from shadcn's registry, not from this fixture hash.

Trace's native disclosure lifecycle mounts nested lines when expanded. Existing `activity`, `activity-step`, `tool-card`, `tool-details` and `reasoning` test ids remain; journeys must expand a summary before selecting its steps. Running icons and working text use the host's Spinner. The chat no longer supplies shimmer or caret CSS.

The October [Tool, Reasoning, Chain of Thought and Subagent patterns](https://ui.shadcn.com/docs/ai-elements) compose these same Trace parts, so the chat adds no separate pattern wrappers or AI SDK dependency. The new Code Block adds a highlighting dependency and its copy button calls the Clipboard API directly. It does not replace our smaller code block with its insecure-origin fallback and host `onCopy`. Confirmation does not replace durable question-bound approval cards. Queue describes agent todos, not Pi inbox submissions with steer, edit and withdrawal, so only those submissions' presentation becomes a Trace line.

`npm run workspace-demo:journey:trace` drives the workspace demo's real native tools with fictional scripted responses. It checks nested keyboard disclosures and reduced motion, then writes running, done, failed and expanded screenshots in both themes to `.cache/evidence/trace/`.

Composer features are switched on by props, and each is absent without its prop (no menu, button or key trigger): `slash={{ commands, skills }}` (`/` at the start of the message: a searchable menu with source chips; a command runs `run({ setText, text })`, a skill inserts a `/skill-name ` token), `mentions={{ search }}` (`@` picker, composer chips, styled mentions in sent messages; the mention is plain text for the model), `attachments={{ accept, upload }}` (attach, paste and drop; a returned `path` becomes an `@path` mention, a returned `image` a native image attachment; progress and failure chips), `model={{ options, change }}` and `effort={{ options, change }}` (compact pickers showing the view's `pi.agent` model and thinking level; disabled while a change is in flight; a rejected `change` shows its message inline). With `createRemoteChat()` use `remote.configure` inside `change` and throw on a refusal. The studio wires these per demo (`lab/studio/demos/index.mjs`).

The tokens (`--background`, `--foreground`, `--muted`, `--border`, `--ring`, `--primary`, `--destructive`, `--radius` and the `--color-*`/`--radius-*` bindings) are the `theme` item; see [Theme and Tailwind](#theme-and-tailwind). The item's base rules remain scoped to `.pi-chat`.

Messages compose the October 2026 Base UI `Message`, `Bubble`, `Attachment` and `MessageScroller` components through the consumer's `@/components/ui/*`. Sent text uses the native muted bubble; assistant prose uses the native ghost bubble. File cards use Attachment's title, description, media and overlay trigger. Existing `message-mention` and `message-image` test ids stay on the activation button. The card content is its sibling, not a child of that button. Passive cards have no trigger. Model content, provider reads, file-change projection and host callbacks are unchanged.

Message Scroller owns bottom-follow, viewport resize, user-scroll intent and prepend anchoring in both `PiChat` and `AmbientChat`. `useTranscript` retains only the bounded window and native history paging. Bounded message items stay laid out with `content-visibility: visible`, so offscreen height estimates cannot move a retained prepend anchor. The pinned `@shadcn/react@0.3.1` replaces `use-stick-to-bottom`; there is no second scroll controller. Markdown keeps its safe token renderer and exact copy source. Its task controls, tables and command controls compose Checkbox, Table and Button. Tool details and queued submissions compose Card and Alert; queue Edit uses DropdownMenu.

Markdown output stays inert: raw HTML is text, images are alt text and only plain `http(s)` links render. `test/contracts/pi-chat-source.test.mjs` compiles the source and checks that, plus the row model. The studio (`lab/studio`) renders this item and the studio scenarios (`lab/studio/scenarios/chat-basics.mjs` and the others) drive it in a real browser. Local tarball installation of the chat blocks through the shadcn CLI is not covered by `test:registry-consumer`; `test:app-registry-consumer` installs `pi-app` and with it `pi-chat`, `pi-workspace` and `viewers` (see [pi-app](#whole-agent-app-pi-app-agentworkspace)).

### Attachments from any revision provider (`useRevisionAttachments`)

`useRevisionAttachments({ revisionProvider, accept, maxBytes, tooLarge, inlineImages, onPreparationFailure })` (`pi-app/use-revision-attachments.ts`) returns the `attachments` config `PiChat` takes, saving each file through the provider under `uploads/` (`uploadRevisionAttachments` in `revision-files.ts`). A file over `maxBytes` is refused before it is read, with `tooLarge` as its reason; a file not matching `accept` (`image/*`, an exact MIME type or `.ext`, comma-separated; an empty list accepts any) is refused with `This file type is not accepted.`. Refused and failed files go to `onPreparationFailure(name, reason)`; an upload that saves nothing rejects with the reason, which the chip shows. Without `fileTree` the hook makes and disposes its own tree controller from the provider; `AgentWorkspace` passes its Library's tree, so the page keeps one. Returns `undefined` until there is a tree.

## Theme and Tailwind

The contract is [BORING-UI-1](../INVARIANTS.md#boring-ui-1--shadcn-first-blocks-carry-no-visual-value); every design group below enforces it.

### Design verification

Run `npm run check` for the static inventory, `node scripts/check-design.mjs --details` for file/line findings, and `npm run test:design` for the real Chromium theme audit. Set `CHROMIUM` to a Chromium binary; build packages first. `npm run verify` includes both checks. CI runs the browser audit with the scripted journeys too.

`scripts/design-groups.json` owns group folders, browser selectors and REPORT/FAIL modes. Every group is FAIL; missing browser coverage fails it. Exception reasons and exact static allowances live only in [design-allowlist.json](../scripts/design-allowlist.json). The browser reports computed values separately from static counts; REPORT debt is never a pass claim.

The standalone `examples/workspace-app` and `demos/workspace` accept `?theme=brand&mode=dark` for the fictional [brand fixture](../test/fixtures/themes/brand.css). Omit `theme` for the registry's stock tokens and use `mode=light` or `mode=dark`. The audit visits both apps, themes, modes and widths 1440/390, checks main token role pairs for WCAG AA, and writes screenshots and per-element JSON to `evidenceDirectory` in the group config (override with `DESIGN_EVIDENCE`). All groups fail on violations. Group 7 also scans `packages/ui/styles/*.css`. The group 5 fixture additionally captures messages, expanded activity, tool results, notices and queue menus in all eight theme/mode/width combinations. `npm run test:design` runs both audits; `node scripts/test-transcript-design.mjs` runs the transcript matrix alone. The [group 1 renderer fixture](../test/fixtures/themes/group-one.jsx) adds long choices, multiline notifications, provider actions, and pressed Toggle/Switch states. Those callbacks are fictional host fixtures, not model-execution qualification. The fixtures install no component overrides.

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

Placement: offsets from the bottom right corner, shared by the bar, the window and the pill, remembered for the browser session under `storageKey`. The grip (in the header and at the left of the pill) drags it; the whole pill drags too once the pointer moves 4px, so a plain click still restores it. With the grip focused, arrow keys move it (Shift for bigger steps) and Home returns it to the default corner. `storage="local"` keeps it in `localStorage` across sessions (default `session`, `sessionStorage`). The position is clamped to the viewport on every render (also when the window is resized or grows), so the agent UI can never be off screen. On a phone (below `PHONE_BELOW`, 641px, the one breakpoint of `utils`, shared with `AgentWorkspace`) the bar and the pill are docked at the bottom with no dragging, and the window is a full-height sheet. `variant="contrast"` (default) is a dark window on any page: its root carries the `.dark` class (and `color-scheme: dark`), so every reused part shows the host's own dark tokens; the item declares no colours. `variant="surface"` uses the host's tokens, light or dark.

Artifacts: with `artifactPanel` (a render function the host writes with the viewer registry, see `examples/ambient/artifact-panel.jsx`), clicking an artifact card opens it inside the window. The window widens (up to 72rem, at most the viewport) into the chat on the left and the panel on the right, using `ArtifactWorkspace` (draggable divider, width remembered, full screen that covers the viewport, a full-screen sheet on a phone). The panel gets `{ fullscreen, onFullscreenChange, close, versions, follow, select }` for the viewer bar and the version history; it reads through the host's own resource client. Escape steps back: full screen, then the artifact, then the window. `artifactTarget="host"` calls `artifacts.open` instead, for hosts with their own viewer.

`AgentNotifications` is a polite live region of toasts (status icon, title, a one-line summary of the final reply, close). `AmbientChat` feeds its store when its own run finishes, fails (toast kind `error`) or waits for an answer (`input`, never auto-dismissed, taken back when answered); a toast is not raised while the window is open on that conversation. A host pushes events for anything else with `store.push({ kind, title, summary, conversationId })`, or lets `watchConversation` do it. `autoDismissMs` (default 8000, 0 keeps them), `maxToasts`, hover and focus pause the timer, Escape closes the focused toast; a click opens that conversation (`conversations.onSelect`, then the window expands). With `systemNotifications`, a bell in the header asks for browser notification permission only when the person clicks it, and a system notification is shown only while the page is hidden, so a host whose connection feeds the store passes `pauseWhenHidden: false` to `createRemoteChat` (by default the stream pauses while hidden and nothing would arrive); `browser-notify.ts` is the one file that touches `Notification`, feature-detects it and never asks on load.

Secure-context capabilities are the host's: the voice button in the screenshots needs `getUserMedia`, which exists only on HTTPS or localhost, so a host's own button is a `tools` slot and not part of the component. `examples/ambient/mic.mjs` shows the guarded pattern (no button where it is missing); `npm run check` fails any other use of `Notification`, `getUserMedia` or `navigator.mediaDevices` in browser-reachable code, except the two kit-shipped, feature-detecting exceptions: the feedback microphone below and the pi-chat camera.

The `pi-chat` item ships the camera: on a touch device (`(pointer: coarse)`) with `canAttach` and an `accept` that admits images, the "+" menu has "Take a photo" (`camera-sheet.tsx`). It opens a full-screen in-page camera (`role="dialog"`, `data-boring-overlay`, one layer above the app shell's point layer) only when tapped; the shutter hands a JPEG scaled to at most 1600px to the same path as a picked file. Close, Escape and unmounting stop the camera; where it cannot open (refused, no media devices, insecure page) the sheet offers the phone's own camera through a file input. Inside the app shell's agent layer, `data-boring-overlay` keeps taps and focus in the overlay from stepping the layer down.

The `feedback` item ships the microphone button: `VoiceInput` (`feedback/voice-input.tsx`) is the `tools` slot of `PiChat` or `AmbientChat` (`tools={<VoiceInput controller={controller} transcribe={transcribe} />}`). The first click asks for the microphone (`createVoiceCapture` of `@hachej/boring-feedback/page`, opened only from that click), the second stops and calls `transcribe(audio: Blob, signal)`, and the trimmed text is appended to the composer draft. It is never sent: the person reads it and presses Send. A cancel control shows while recording; cancel, a stop that fails, or unmounting releases the microphone and drops any transcription in flight. A refused microphone says what to do (blocked, none found, busy, insecure page) in the chat's own words (`voiceDenied`, `voiceNoMicrophone` and the rest in `labels.ts` and `labels-fr.ts`). Speech-to-text is the host's: `transcribe` posts the Blob to the host's own endpoint.


The queue (`queue.tsx`, shared by `PiChat` and `AmbientChat`) is one slim row per message in a tab tucked behind the composer's top edge: queue icon, one-line text, icon-only Steer and remove actions, and a "…" menu with Edit (48px phone targets; see [queue controls](#panel-pi-workspace-history-and-queue-pi-chat)). The composer parity (paperclip, `/`, `@`, model, effort) is one `Composer` component with a one-row and a two-row layout, not two implementations.

`examples/ambient` is a fictional settings console with the bar over it, a durable agent (artifact tools, `ask_user`, one slow tool) and a background task button (`?view=full` renders a `PiChat` with the same composer config, `?artifacts=host` the host-viewer handoff): `npm run ambient`, and `npm run ambient:journey` for the real-browser, real-model journey with screenshots under `.cache/evidence/ambient/`.

## Viewers (`viewers`)

One Tailwind item (owned source, shadcn tokens, light and dark, 44px targets on coarse pointers) with the standard viewer top bar and the panes over it. Every pane borrows a host-owned controller or takes bytes, and shows the same bar: title and subtitle, a status chip (Saved, Unsaved, Saving, Changed elsewhere, Read-only), viewer controls, then the standard actions, each present only when its handler is supplied: Refresh, Share, Copy, Download, Open in new tab, Close. On a narrow bar Copy, Download and Open move into an overflow menu.

| Part | File |
| --- | --- |
| Bar (`ViewerFrame`, `ViewerToggle` over the consumer's `ToggleGroup`, consumer-owned `Button`): always one row; title and facts, icon-only mode toggle (an outlined native ToggleGroup: the pressed segment filled, the other muted), Save only while there are edits, a status dot in the default shadcn roles (primary saved, muted-foreground unsaved or saving, destructive with words when the save needs the person; read-only is a word in the subtitle), then Share, full screen and Close; Reload, Copy, Download, Open in new tab and viewer extras sit in the "…" menu (a bottom sheet on a phone) | `viewer-frame.tsx` |
| Menu (`ViewerActions`, `ViewerVersions`): the consumer's shadcn Base UI dropdown through `ActionMenu`, with native keyboard navigation and dismissal. Version rows show relative time, provenance (You, Agent or External change when recorded), optional measured change summaries, day groups and a quiet Current marker with a check. Older versions are read-only; the viewer explicitly states that restoration is unavailable rather than inventing a write path | `menu.tsx` |
| Words, icons, the window (`ViewerWindowProvider` `{ fullscreen, onFullscreenChange, actions, labels, icons }`, `defaultViewerLabels`, `defaultViewerIcons`): for example `<ViewerWindowProvider value={{ labels: { share: 'Partager' }, actions: [{ id: 'pin', label: 'Pin', icon: PinIcon, onSelect: pin }] }}>` around any viewer | `viewer-window.ts` |
| Share: `createLinkShare(link)` uses the Web Share API, otherwise copies the link and the bar says "Link copied"; plain-HTTP origins lack `navigator.clipboard`, so `copyText` falls back to `execCommand('copy')`, and if the browser allows no copy at all the bar shows the link selected for a manual copy. A frame shown only while a file or artifact version loads offers no Share: the pane that shows it brings its own frame, which replaces (remounts) the loading one, and a notice set on the old frame would be lost | `share.ts`, `utils/utils.ts` of the `utils` item (`copyText`, `ManualCopyError`) |
| Markdown editor with toolbar, prose styling, Rich/Source toggle, Save | `markdown-pane.tsx` (over `@hachej/boring-ui-kit/markdown-editor`) |
| HTML preview and source; passive preview by default, optional interactive preview (below) | `html-pane.tsx` (over `@hachej/boring-ui-kit/html-viewer`), `interactive-html.tsx` |
| Image viewer: fit, zoom, pan, checkerboard; every type through an `<img>` from an object URL | `image-pane.tsx` |
| PDF viewer: the browser's own viewer in a frame over an object URL, a Download fallback where there is none | `pdf-pane.tsx` |
| `LocalFileViewer({ name, blob, onClose?, ... })`: read-only image, PDF or literal text from a browser File or Blob, without a locator | `local-file-viewer.tsx` |

Refresh runs the controller's own refresh for editable panes, so unsaved edits are kept and shown as "Changed elsewhere". Rich Markdown editing is offered only when the document survives a parse and serialise round trip unchanged; otherwise it opens as source with a notice. The canvas is not a pane: wrap tldraw's editor in `ViewerFrame` (see `lab/studio/panels/canvas.jsx`). `viewers.css` is the source of the item's `css`; run `node registry/viewers/build-css.mjs` after editing it.

### Open a browser-only file

```tsx
import { LocalFileViewer } from '@/components/viewers/local-file-viewer';

// A File from an input or drop event is already a Blob.
<LocalFileViewer name={file.name} blob={file} onClose={closePreview} />
```

`LocalFileViewer` uploads nothing and writes no workspace file or browser storage. The file is lost on reload unless your app saves it separately. This is host presentation, not a Pi execution extension. It needs no resource client, `ResourceLocator` or agent. Preview object URLs are revoked when replaced or unmounted; Download uses a temporary URL that is also revoked.

A specific `blob.type` wins. An empty type or `application/octet-stream` falls back to the name through `mediaTypeOf`. Supported images use `ImagePane`, PDFs use `PdfPane`, and text types, JSON and XML use read-only literal UTF-8 text. HTML never runs. Unknown types, NUL bytes, invalid UTF-8 and failed text reads show "No preview" with Download of the original bytes. The standard viewer bar supplies the title and Download; `onClose` adds Close. `subtitle`, `headerStart`, `controls`, `testId`, `titleTestId` and `className` customize the same bar. Words come from `ViewerWindowProvider`.

#### Custom artifacts and a dropped PDF in one app

`artifactKinds` customizes saved artifacts with resource descriptors. A browser-only File has no descriptor or revision. Use a host `panels` entry for it, rather than inventing a locator. This example keeps a dropped fictional PDF in memory alongside a custom saved report viewer:

```tsx
import { useState } from 'react';
import type { ComponentProps } from 'react';
import { AgentWorkspace } from '@/components/pi-app/agent-workspace';
import type { OpenedView } from '@/components/pi-app/agent-workspace';
import { LocalFileViewer } from '@/components/viewers/local-file-viewer';

export function ReportWorkspace(host: ComponentProps<typeof AgentWorkspace>) {
	const [local, setLocal] = useState<File>();
	const [opened, setOpened] = useState<OpenedView | null>(null);
	return <div className="h-full" onDragOver={event => event.preventDefault()}
		onDrop={event => {
			event.preventDefault();
			const file = event.dataTransfer.files[0]; // e.g. compte-rendu-fictif.pdf
			if (file) { setLocal(file); setOpened({ kind: 'local-file' }); }
		}}>
		<AgentWorkspace {...host} opened={opened} onOpenedChange={setOpened}
			artifactKinds={[{
				match: target => target.resource.path.endsWith('.report.json'),
				label: 'Report',
				renderer: ({ text }) => <pre>{text}</pre>,
			}]}
			panels={{ 'local-file': (_view, panel) => local
				? <LocalFileViewer name={local.name} blob={local}
					onClose={() => { setLocal(undefined); panel.close(); }} />
				: null }} />
	</div>;
}
```

Drop only opens the preview. It does not send an attachment to chat, upload the PDF or make its bytes available to the agent.

### Interactive HTML preview (host opt-in)

By default the HTML preview is the passive, sanitised rendering of `@hachej/boring-ui-kit/html-viewer` (scripts, attributes and external resources removed, `sandbox=""`). A host can pass `interactive={{ scriptSources: [...] }}` to `HtmlPane`; the Preview view is then the page itself, running, and the Preview | Source toggle stays the only mode switch (a Reload button, or pressing Preview again, loads the page again). Nothing changes without the option.

What is isolated: the page runs in `<iframe sandbox="allow-scripts" allow="" referrerpolicy="no-referrer" srcdoc>`. There is no `allow-same-origin`, so the page has an opaque origin (no cookies, `localStorage` or access to the host page), and no top navigation, popups, forms, downloads or modals; `allow=""` withholds camera, microphone, location and other powerful features. A `<meta http-equiv="Content-Security-Policy">` is injected first in the document: `default-src 'none'; script-src 'unsafe-inline' <origins>; style-src 'unsafe-inline' <origins>; img-src data: blob:; font-src data: <origins>; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'`. What egress is allowed: only loading scripts, styles and fonts from the host's `scriptSources` (HTTPS origins; anything else is dropped, so the list cannot inject directives). The page cannot make requests (fetch, XHR, WebSocket), embed frames or load images from the web. The studio allows `https://cdnjs.cloudflare.com` and `https://cdn.jsdelivr.net`; pinning library versions is the page's responsibility (the studio's artifact agent is told to use exact versions).

This is trusted-host opt-in for untrusted content, not a claim of qualification: the acceptance row A12 (content refused or isolated; declared CSP and egress enforced) is not claimed for it. A third-party CDN script runs with the page's privileges inside the sandbox, and a compromised or unpinned library can draw anything on the page.

## Feedback (`feedback`)

### Changes

- `ComposerFeedback.start` (pi-chat's composer prop) is optional now (API change). The type no longer requires it; without it the composer shows no Feedback button. Hosts that always passed `start` are unaffected.

**Moved: update your imports.** `pi-chat` no longer exports `FeedbackCard`, `FeedbackMention`, `feedbackMentionId`, `feedbackRenderTool`, `feedbackResultView` or their types; they come from `components/feedback/feedback-card` (installed by the `feedback` item, which depends on `pi-chat` as its host). `VoiceInput` moved to `components/feedback/voice-input`. Hosts wire it as `mentions={{ search, open, render: feedbackMentionRenderer() }}` and pass `<VoiceInput … />` through the composer's `tools` slot.

`NoteBubble` (the pin: a text field with a mic inside it; pass `transcribe` for the mic), `useComposerFeedback` (the composer's annotate toggle and count), the optional `FeedbackBar` and `FeedbackChip` (with `FeedbackReview`) (`feedback-session.tsx`, over `createFeedbackSession` from `@hachej/boring-feedback/ui`), `CommentBanner`, `useCommenting` and `usePointing` (`point-mode.tsx`: comment mode's banner with an on/off switch, at the bottom of a phone in point mode and at the top of a wide screen; the host hides its panel while `usePointing` is true and passes its tab bar height as `bottomOffset`; `inline` keeps the banner over one surface, such as a side panel, instead of the window), `useSendEachNote` (each saved note goes to the agent at once) and `plainElement` (an element named in plain words), `PickerOverlay` (styles and `usePickerOverlay`), and the optional Release 1 components `PointButton`, `AnnotateSheet`, `FeedbackList` and `FeedbackReport` (not mounted by default) install into `components/feedback/`. They import React, React DOM (the review is a portal) and `@hachej/boring-feedback/format`, `/page` and `/ui` directly: picking, masking, anchoring and placement stay in the package, so restyling cannot weaken them. CSS is plain and scoped to `[data-boring="feedback"]`, reading the host's shadcn tokens through `--boring-feedback-*` variables; the overlay lives in a shadow root and takes the `pickerOverlayStyles` string, with `box`, `label` and `toolbar` parts. Every selection can be cancelled (Esc, a second click on the zone, the "Cancel selection" button of the bubble and of `AnnotateSheet`) and a note can have no element ("Ask a general question", `captureGeneral`); the words are `labels` (`feedback-labels.ts`: English by default, `feedbackLabelsFr` for French). `registry/feedback/feedback.css` is the source of the item's `css` (`node scripts/build-feedback-css.mjs`). Save appears only when the host passes a save endpoint (`fetchSaveEndpoint` over its own authenticated route); Show works only in the application page itself. `examples/feedback` mounts the composer UX on a fictional page, and the Release 1 surfaces with `?ui=classic` (`npm run feedback`, `npm run feedback:journey`, `npm run feedback:journey:picker`; `?mobile=1` and `npm run feedback:journey:point` for point mode on a 390x844 phone), and `npm run test:feedback-registry-consumer` installs the item with the pinned CLI.

## Maquette viewer (`maquette-viewer`)

A PM agent writes a mock-up as `<name>.maquette.json` and presents it. The `pi-app` artifact panel draws it with `MaquetteViewer` by default (no prop needed). The screen is the content, drawn with your own shadcn `Button`, `Input`, `NativeSelect`, `Card`, `Table`, `Badge`, `Item`, `Bubble` and `Empty`; the chrome is one thin bar of icons: Back (also Alt+Left) once the person has moved, ‹ `2 / 5` › (also arrow keys and swipe on a phone) and a menu holding the guided tours (`cases[].steps`: the step's caption on one compact line and step dots, × to leave) and "How it works" (the workflow diagram, its numbered legend and the cases' `path` highlights, in a dialog). Blocks with a `goto` get a soft ring on hover and focus and pulse once (the host's `--animate-pulse`) the first time their screen is shown. A screen's `note` is one truncated muted line under it, in full behind its info button. A page URL fragment `#screen=<id>` opens that screen (the panel passes the fragment to a kind's renderer as `fragment`, so a link the PM gives can say "see screen 2"). The file is data: nothing in it runs.

`maquetteKind` (`match`, `label`, `icon`, `renderer`) is the built-in kind, in English ("Mock-up"); `createMaquetteKind({ locale: 'fr' })` gives "Maquette" and the French words, `labels` overrides any word. `AgentWorkspace` uses the kind in its `locale`. Kinds an app passes in `artifactKinds` (or `ViewerOptions.kinds`) are consulted first, so an app's own kind for `.maquette.json` wins.

### Format v1

```jsonc
{
  "version": 1,                       // absent: read as 1; a higher version shows a "newer version" notice and draws what it can
  "title": "Class booking",
  "device": "phone",                  // optional: "phone" | "desktop" frame; absent: the panel's width
  "start": "classes",                 // optional: the first screen (default: the first one)
  "nav": [{ "label": "Classes", "goto": "classes" }],          // optional app bar above every screen
  "screens": {                        // ids in stepper order
    "classes": { "title": "This week's classes", "note": "Why the screen exists, what the person does", "blocks": [
      { "type": "button", "label": "Book", "goto": "class", "primary": true }
    ] }
  },
  "workflow": { "states": [{ "id": "browsing", "label": "Browsing" }], "transitions": [{ "from": "browsing", "to": "booked", "label": "books", "by": "student" }] },
  "cases": [{ "name": "First booking", "steps": [{ "screen": "classes", "caption": "Alex looks for a class." }], "path": ["browsing", "booked"] }]
}
```

Blocks may carry an optional `id` (named by comment pins). Block types: `heading`, `text`, `button`, `link`, `input`, `select` (`items`), `badge`, `list` (`items`), `table` (`columns`, `rows`), `card`, `row`, `stack` (`children`), `chat` (`messages: [{ from, text }]`, `from: "user"` is the person), `document` (`lines`), `placeholder`; any other type is a grey dashed placeholder named by its `label` (or type) with its `note`. Words come from `label` (`text` and `title` are aliases); `children`/`blocks`, `items`/`options` and a transition's `on`/`label` are aliases too, and a state may be a bare string. Lists and strings are bounded (30 screens, 60 blocks per screen, nesting depth 6). Invalid JSON, or a file without screens, shows an inline error.

Differences from the PM skill (`boring-pm`): its `maquettes.md` describes no JSON format (it asks for Markdown scenarios and no static HTML). The format above is the one the PM's `present` tool validates (`maquetteProblem`: `{ title, start, screens: { <id>: { title, blocks } }, workflow?, cases?, nav? }`) and the Factory attaches, plus what v1 adds: `version`, a screen's `note`, `device`, and `cases[].steps`. A case's `path` keeps highlighting the workflow diagram. A block's `height` is no longer read.

## Board format (`board-viewer`)

A PM agent writes a board as `<name>.board.json` to lay its mock-ups out side by side: each maquette screen and each HTML mock-up becomes a frame, left to right, with an arrow for every `goto` link and a sticky note where it helps. The file is plain data; it names other files in the same folder and embeds nothing. The board file is the only authority: the viewer projects it into a disposable native canvas, and people's moves and notes come back as a new `board@1` file. An agent can write and check a board without any canvas runtime: the functions below are pure.

```jsonc
{
  "format": "board@1",                // required. Missing: invalid (unversioned). "board@2" and up: reported as newer, not read
  "title": "Session booking, v1",     // optional, 120 characters
  "items": [
    { "id": "booking", "maquette": "booking.maquette.json" },                      // one frame per screen, id "booking/<screen>"
    { "id": "confirm-html", "html": "confirm.mockup.html", "device": "phone" },    // one frame; device "phone" (390 wide) or "desktop" (1024)
    { "id": "note-1", "note": "Is the reminder opt-in or opt-out?", "near": "confirm-html" }
  ],
  "links": [{ "from": "booking/confirmed", "to": "confirm-html", "label": "richer version" }],   // frame ids: <item>/<screen> or an html item id
  "layout": { "booking/sessions": { "x": 0, "y": 267 } }                           // optional: top-left corner per frame or note id
}
```

- Every item has exactly one of `maquette`, `html` or `note`, and an `id` of 1 to 60 letters, digits, `-` or `_`, unique on the board. At most 40 items, 80 links and 200 layout entries. Unknown fields are errors, so a typo is reported, not dropped.
- Paths are relative to the board's folder: no scheme, no leading `/`, no `..`. A `maquette` ends in `.maquette.json` (format above); an `html` ends in `.mockup.html`. An HTML mock-up is a plain page using Tailwind classes and the app's theme tokens (`bg-background`, `text-foreground`, `bg-primary`, `text-muted-foreground`, `border-border`, `bg-card`); it has no external resources.
- Goto arrows are drawn from the maquette's `goto` blocks, between screens of the same maquette. A `links` entry draws any other arrow. A link to a frame that does not exist is a problem for the planner to report, not a crash.
- Lay out by `layout` only when you need a place; otherwise frames follow each other left to right.

The functions live in `registry/board-viewer/board.ts` (`components/board-viewer/board.ts` once installed):

- `parseBoard(text)` returns `{ kind: 'ok', board }`, `{ kind: 'newer', format, version }` or `{ kind: 'invalid', issues: [{ path, message }] }`. It never throws.
- `planBoard(board, files)` takes a map from each referenced path to its text and returns `frames`, `arrows`, `notes` and `problems` (missing files and dangling links), left to right.
- `applyCanvasEdits(board, { positions, notes })` writes frame positions and the remaining notes back into the board (a note keeps its `near`); maquette, HTML and link entries never change. It returns `ok` or `invalid` with reasons. `serializeBoard(board)` gives the file text.

Fictional fixtures for this format are in `test/fixtures/board/` (a three-screen booking maquette, one mock-up, one board).

### Installing the board viewer

Install `board-viewer` and pass its kind to the artifact panel or workspace:

```tsx
import { createBoardKind } from '@/components/board-viewer/board-viewer';

const board = createBoardKind({ client, identity, assetUrls, licenseKey });
<AgentWorkspace {...workspace} artifactKinds={[board]} />;
```

Use the same resource `client` and authenticated receipt `identity` as the workspace. The host supplies the complete tldraw `assetUrls` map and its license key as props. The [self-hosted assets recipe](../examples/canvas-assets/self-hosted.mjs) serves fonts, icons and translations from the host origin. The key never belongs in a board file. The current owner-approved key expires on 2027-01-01; hosts own renewal and the SDK's licensing and egress obligations.

The block lazy-loads `CanvasProjection` from `@hachej/boring-ui-kit/canvas-editor`, including native CSS. Desktop controls move frames, pan, edit notes, undo and fit. Double-click a frame to interact with its contents; Escape returns to the canvas. Freehand/native drawing records are not part of `board@1`. Phone and coarse-pointer sessions start with the hand tool, hide drawing controls and fit the first frame. Native read-only mode also blocks accidental edits; a pinned historical board is always read-only. Optional `comments` accepts the existing host point-comments binding. Structured board pin delivery is a separate feature.

Autosave waits 600 ms and conditionally replaces the board file at its observed revision. The shared text buffer retains dirty edits on conflict and requires explicit discard to reload. Lost acknowledgements retain their operation identity for lookup, never an automatic second publication. External board rewrites refresh clean projections and preserve dirty ones. Closing a viewer releases only its buffer and native editor, never the borrowed client or workspace. The native store, camera and selection are never persisted.

HTML frames use `MockupViewer` and its sandbox, not host imports. A host that forbids inline scripts must serve mock-ups from a separate sandbox origin. Keep the parent frame navigation policy restricted; the frame's CSP alone cannot prevent a page from navigating itself. Run `npm run board:journey` for real desktop and phone pointer input, revision/receipt races and screenshots under `.cache/evidence/feat-board-viewer/`.
### Comment pins (with the `feedback` item)

Pass the `feedback` item's `usePointComments(session)` as `AgentWorkspace comments` (or `createMaquetteKind({ comments })`) and the bar shows a
comment icon (a `Toggle` with a tooltip). It enters the session's point mode on the current screen (the viewer's own bar stays usable, so the
person can walk to another screen and pin there too); a tap on a block pins a note, the icon again is Done, and the notes wait in the
composer's existing chip for Send. Each block sits in a box marked `data-feedback-id="maquette:<path>#screen=<screen id>&block=<block id>"`
(the block's optional `id`, else its position: `2`, `2.0` for a child) and the screen is a `data-feedback-visible` region, so the report sent
with the message names the maquette path, screen, block and the block's words. Pins of the current screen show as small numbered `Badge`s
once point mode ends. Without a session `usePointComments` returns undefined and no icon shows. The privacy policy drops a marked id with three
digits in a row or an `@`, so keep maquette paths and ids free of those for the pins to name them. `usePointComments` returns
`{ active, point, pins: [{ number, target }] }`, built on the new `SessionNote.feedbackId`.

## HTML mock-ups (`mockup-viewer`)

An agent writes `booking.mockup.html` in its workspace and presents it. `AgentWorkspace` and `ArtifactPanel` render this suffix by default, before the ordinary HTML viewer. Other `.html` files keep their existing passive default. App kinds in `artifactKinds` still win. For standalone use, import `MockupViewer`, `mockupKind` or `createMockupKind({ locale, comments })` from the installed `components/mockup-viewer/mockup-viewer`.

The renderer ports the HTML implementation from `spike/canvas-board` at `3b838e3a5`. It reuses `InteractiveFrame` with `sandbox="allow-scripts"`, `allow=""`, an opaque origin, no-referrer and the existing CSP with no allowed origins. Artifact scripts run only inside that sandbox. The host never parses artifact markup into its DOM or imports artifact code. Files are still read through the workspace provider, with no new storage.

The viewer copies the host element's computed CSS variables into the frame. Theme changes update those variables without restarting the page. Tailwind 4.3.3 compiles the document's classes in a lazy module, with the upstream theme and preflight confined to the frame. The generated compiler input retains Tailwind's MIT license; regenerate it with `node registry/mockup-viewer/build-tailwind.mjs` after upgrading Tailwind or changing theme bindings. Hosts must enable ESM chunk splitting to keep the compiler out of their entry bundle.

Pass `usePointComments(session)` as `AgentWorkspace comments` or to `createMockupKind`. Its icon enters the existing feedback point mode. A click inside the frame sends a bounded structural selector and rectangle. The host accepts only the current iframe window with an opaque origin. It creates a host-DOM proxy and submits it through the session's normal root, privacy, anchor and note checks. Selectors contain only child positions, never IDs, text, attributes or form values. The note's marked target is `mockup:<file path>#element=<selector>`. As with maquettes, the privacy policy drops marked targets containing three consecutive digits or `@`. Picks are untrusted observations of that document. Pin overlays belong to the current viewer mount; retained notes do not silently rebind to a rewritten file. Use app suspends frame interception too.

### Host CSP

A `srcdoc` frame inherits its host's CSP. Hosts that forbid inline scripts need a separate sandbox origin, such as a usercontent domain, instead of `srcdoc`; this block does not provision that origin. Set the host's `frame-src 'none'`, or a narrowly qualified sandbox-origin allowlist, to prevent a hostile page from navigating its own frame to an external site. The frame's own restrictive CSP closes fetch, external images, child frames and forms, but cannot enforce its own navigation policy.

`npm run mockup:journey` drives the fictional `test/fixtures/booking.mockup.html` through the workspace app and real point comments. It checks theme variables, opaque-origin isolation, blocked storage and network, delivered element notes and 360px overflow. Screenshots cover phone 390 and desktop 1440 in light and dark.

### A given look (`themeOverride`)

`MockupViewer` takes `themeOverride`: a shadcn theme in shadcn's own `cssVars` shape (`{ theme, light, dark }`, names without `--`). Its
variables are applied after the host's, so the frame shows that look instead of the host's; a `--radius` also sets shadcn's radius steps.
`mode: 'light' | 'dark'` forces a mode (absent: the host's) and `title` names the frame. Fonts named by a look render only when the frame
can load them (its CSP allows `data:` fonts only), so the swatch names the font even when the frame falls back.

## Looks (`looks-viewer`)

An assistant compares looks for an app: the same `*.mockup.html` key screen in 2 to 6 shadcn themes side by side, then 2 to 4 layout
variants of it in the chosen look. A look is a shadcn theme, nothing else: a preset (`npx shadcn@latest apply <preset> --only theme,font`)
and the theme block that preset writes. `createLooksKind({ onPick, locale })` is opt-in (pass it in `artifactKinds`); the panel's `read`
loads the mock-ups named by the file. `onPick({ kind: 'look' | 'layout', id, label, path })` is the host's: the viewer only marks the pick.

```jsonc
// documents/missing-receipts.looks.json (paths are relative to this file)
{ "mockup": "missing-receipts.mockup.html",
  "looks": [{ "id": "warm", "label": "Warm", "personality": "Friendly and human, like a good café.",
              "preset": "b3kcqrM3M", "css": ":root { --background: oklch(1 0 0); … } .dark { … } @theme inline { --font-sans: 'DM Sans Variable', sans-serif; }" }],
  "layouts": [{ "id": "a", "label": "List and detail", "why": "You work one client at a time.", "mockup": "missing-receipts-a.mockup.html" }],
  "look": "warm" }
```

`parseLooks` validates the file (2 to 6 looks, or 1 when the file compares layouts; unique ids; at most 4 layouts) and `parseShadcnTheme`
the block: only `:root`, `.dark` and `@theme inline`, only shadcn theme variables (`SHADCN_COLOR_VARIABLES`, `radius`, `font-*`) with
colour, length and font-family values; anything else is an issue, never kept. `npm run looks:journey` renders the fictional
`test/fixtures/looks/` files and screenshots the looks grid and the layout grid at desktop 1440 and phone 390, light and dark.

## Diagram viewer (`diagram-viewer`)

An agent writes boxes and arrows as `<name>.diagram.json` and presents it; the `pi-app` artifact panel draws it with `DiagramViewer` by default.
Nodes sit in layers by distance from the first node, one numbered arrow per edge, with a legend under it that says what happens and who acts.
Layers run left to right while they fit and top to bottom in a narrow box (a phone); a diagram still wider than its box scrolls inside it,
never the page. No layout library: the layered layout is a breadth-first pass, so no dependency was added. `diagramKind` ("Diagram") and
`createDiagramKind({ locale: 'fr' })` (« Diagramme ») follow the maquette kind; app kinds win. `DiagramView({ diagram, highlight, labels })`
and `parseDiagram(textOrValue)` are exported: the maquette viewer draws its workflow with them.

```jsonc
{
  "version": 1,                       // absent: read as 1; higher: a notice, and what can be read is drawn
  "title": "Booking a class",
  "nodes": [{ "id": "browse", "label": "Browse classes", "group": "find" }, "done"],   // a bare string is id and label
  "edges": [{ "from": "browse", "to": "done", "label": "books", "by": "student" }],     // `on` is an alias of `label`
  "groups": [{ "id": "find", "label": "Find" }],      // optional; a node's group is a muted second line in its box
  "path": ["browse", "done"],                          // optional: drawn stronger, with the arrows between consecutive nodes
  "note": "One short paragraph under the diagram."     // optional
}
```

`states` and `transitions` are aliases of `nodes` and `edges`, so a maquette's `workflow` is a valid diagram. Lists and strings are bounded
(40 nodes, 80 edges, 12 groups); an edge to an unknown node is dropped. Invalid JSON, or a file without nodes, shows an inline error. A maquette's
`workflow` may instead be a relative `*.diagram.json` path: the viewer reads it from the maquette's folder through the kind renderer's `read`
(`ArtifactKindViewProps.read`, passed by the artifact panel) when How it works opens.

## Typed records (`record-viewer`)

`record-viewer` exports `RecordTable`, `RecordList`, `RecordsViewer` and `createRecordsKind` from `components/record-viewer/record-viewer`. It composes the host's shadcn table, badge, item, button, alert and empty components. `AgentWorkspace` opens `*.records.json` by default; app `artifactKinds` win. This is host presentation, not a Pi execution extension.

```json
{
  "kind": "records@1",
  "columns": [
    { "key": "name", "label": "Article", "type": "text" },
    { "key": "aisle", "label": "Rayon", "type": "text" },
    { "key": "quantity", "label": "Quantité", "type": "number" },
    { "key": "checked", "label": "Vérifié", "type": "date" },
    { "key": "status", "label": "État", "type": "status" }
  ],
  "groupBy": "aisle",
  "rows": [{
    "id": "fictional-brush",
    "values": {
      "name": "Pinceau fictif", "aisle": "Finition", "quantity": 2,
      "checked": "2026-10-01", "status": { "label": "À commander", "tone": "warn" }
    },
    "actions": [{ "id": "order", "label": "Commander" }]
  }]
}
```

Column keys and row IDs must be unique. Missing or null values display `—`. Numbers use `Intl.NumberFormat`; dates accept real ISO calendar dates or timestamps with an explicit timezone and display in UTC. `locale="en"` (default) or `locale="fr"` selects formatting and kit labels; `labels` overrides words. Column, action and status labels are app data, not translated by the block.

The app decides status meaning. Tones map to host Badge variants: `ok → default`, `warn → secondary`, `error → destructive`, `info → outline`, `neutral → secondary`.

```tsx
const records = createRecordsKind({ locale: 'fr',
  onAction: (action, row) => requestOrder(row.id, action.id) });
<AgentWorkspace artifactKinds={[records]} {...workspaceProps} />
<RecordTable columns={columns} rows={rows} groupBy="aisle" onAction={onAction} />
<RecordList items={[{ id: 'brush', title: 'Pinceau fictif', detail: 'Rayon Finition',
  status: { label: 'À commander', tone: 'warn' }, action: { id: 'order', label: 'Commander' } }]}
  onAction={(action, item) => requestOrder(item.id, action.id)} />
```

`RecordTable` always draws a table. The file viewer uses it from 640px viewport width and `RecordList` below that. When grouped, the group heading carries its column: it is omitted from table headers, row cells and phone cards. Phone status columns appear only as badges, with accessible names retaining their column labels. Other fields, first-seen groups and actions are preserved. A list item accepts an optional `action` and an `actions` array; `statuses: [{ label, value }]` supplies multiple labelled badges alongside the optional standalone `status`. Buttons without `onAction` are disabled; callbacks must enforce host policy. Files never execute action metadata. Invalid JSON, cell types/dates, duplicate keys/IDs or invalid groups show exact raw text with a localized note instead of hiding invalid rows.

Evidence: `test/contracts/record-viewer.test.mjs` and `npm run records:journey` (fictional inventory, desktop/phone, English/French, light/dark). Screenshots belong under `.cache/evidence/D77/`. No live domain-service or real-model qualification is claimed.

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
for publication, navigation and lifecycle behavior. The files endpoint also supports
conditional `revisionProvider.rename({ from: locate(oldPath), to: locate(newPath), expectedRevision, operationId })`
and `revisionProvider.delete({ path: locate(path), expectedRevision, operationId })`
when its provider installs them; reconcile an unknown result with the same operation ID.
See the [files endpoint contract](../packages/files/README.md#frontend-revision-provider).
This adds no Rename/Delete tree controls or recursive folder operations.
`npm run file-tree:journey`
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
and the default `composerLayout="card"` follows the owner reference: one host shadcn `InputGroup` with
attachment, upload and mention chips (shadcn `Attachment`) above full-width, growing text, then one centred
row with "+" (a shadcn `DropdownMenu`) on the left and Send on the right. The `@` and `/` pickers are shadcn
`Popover`s of `Item` rows, and the model pill opens a `DropdownMenu` with radio groups; the block adds layout
only. `composerLayout="pill"` puts the text between the controls on one row; `stacked` and `inline` are
accepted and render as `card`. `AmbientChat` uses the same default and compatibility prop. An `Artifacts · n`
chip appears above it for observed conversation files and uploads, opening a compact native desktop menu or
phone drawer through the existing file/artifact callbacks. Its title and rows share a left edge; desktop menus keep
a 6px anchor gap, and phone/coarse-pointer rows have 48px touch targets. Only rows with an opener are listed. `AgentWorkspace`
opens workspace paths in its file viewer by default and supplies an image preview for native images without a path;
`chat.onOpenFile`, `chat.mentions.open` and `chat.onOpenImage` keep their host overrides. An upload returning both
`path` and `image` uses the native image and its preview, not a second path mention: one upload produces one
message attachment and one files-menu entry. The saved workspace file remains available through the Library. `ConversationList` defaults to
search disclosure and overflow row actions; `searchMode="inline"` and `rowActionLayout="inline"`
retain the former controls.

Viewer headers default to one quiet row. `ViewerFrame compactHeader={false}` retains the former
visible Share and fullscreen actions and supports `ViewerWindow.headerLayout="stacked"`.
Compact headers show metadata on hover. On phones, Back, the title, and overflow remain visible;
editing controls and revision history move into overflow. Escape and browser Back close the phone
artifact without replacing the mounted conversation. `ArtifactWorkspace.onClose` may return `false`
to refuse a synchronous close; declining the file's discard prompt restores the sheet's Back entry.
Reselecting the current file closes Library without changing the selected path or the chat draft.

`MarkdownEditor` and `MarkdownPane` default to `formattingToolbar="selection"` on desktop and phone.
Selecting text opens Tiptap's native bubble. The header’s **Formatting** (French: **Mise en forme**) Type icon
toggles the full bar with `aria-pressed`; it stays visible on phones with a 48px target and hides in Markdown mode.
The **…** menu contains **Formatted** / **Markdown**. The standalone editor also offers **Show outline** when allowed.
Choices last for the viewer session; FileViewer retains formatting preferences across saved-revision remounts.
Pass `formattingToolbar="pinned"` for the full desktop row, or the phone's keyboard dock while editing.
A later host prop change takes precedence over the session choice. The menu uses the host's real
shadcn Base UI radio and checkbox items, with 48px phone targets and English/French labels.
Keyboard shortcuts and Markdown input rules remain available.

Formatted preserves front matter, HTML/comments, footnotes, reference links and Windows line endings without rewriting untouched source. Raw constructs appear as literal labelled blocks or inline atoms; front matter is editable as code. Source-only fallback now names unsupported encodings or unretainable source spans, not those common constructs. The [editor guide](../packages/ui/README.md#optional-markdown-editor) owns preservation and serialization limits.

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

## Requests board (`requests-board`)

Install `<registry>/requests-board.json` (and `theme.json` only if the host has no shadcn tokens). The block composes Base UI `base-nova` built-ins and works without app-shell, Pi or a controller:

```tsx
import { RequestsBoard } from '@/components/requests-board/requests-board';
import type { RequestView } from '@/components/requests-board/requests';

<RequestsBoard views={views} mode="full" locale="fr" changeToken={revision}
  repos={['Atelier Exemple']} canApproveRelease={canApproveRelease}
  onOpenAll={openRequests} onOpen={openRequest}
  onAnswer={answerRequest} onDecide={decideRequest} onTry={tryVersion} />
```

The host passes `readonly RequestView[]`: `number`, `title`, `state`, `line`, `since` (ISO timestamp of the last move), `links` and `history`, plus optional `waitsOn`, `repo`, `master`, `question` and `action`. States are `question`, `try`, `validation`, `building`, `checking`, `live` and `abandoned`. Questions have `kind: 'answer' | 'approval' | 'release'` and `text`; actions have `kind: 'preview' | 'pr'` and `href`. Related links use `kind: 'parent' | 'child' | 'blocked_by'` and a request `number`. History entries contain `at` and `text`. Dates use `Intl.DateTimeFormat` in the board's locale and the viewer's time zone, retaining the original ISO value in `<time dateTime>`. Override `labels.formatDate(iso)` for a host-specific format or time zone. The detail shows the repository separately only when the status line does not already contain its name.

`compactRows` takes at most five rows: questions, versions to try, then recent moves (newest first within each group). `filterViews` and `requestCounts` share search and repository scope. “For you” includes open questions; “In progress” excludes live and abandoned requests. Full mode keeps the list mounted while a phone shows only its selected detail; Return restores list focus. Arrows/Home/End move list focus and Enter opens the focused button.

`onOpen(number)` handles row and related-link intent. The block selects local views when available; the host handles external navigation. `onAnswer(number, text)`, `onDecide(number, 'approve' | 'later')` and `onTry(number, action)` report intent only, never a successful mutation. Missing callbacks disable their controls. The host must authorize, handle errors and re-render authoritative views; `canApproveRelease` only hides the going-live question, not an authorization boundary. Drafts reset when switching request/question. No optimistic settlement, polling, subscription, automatic navigation or URL fetch occurs in the block.

The host bumps `changeToken` alongside fresh views. A polite live region compares those views with the last announced snapshot and announces moved rows (number and localized state). Locale defaults to English; `locale="fr"` and `labels` overrides follow the diagram labels pattern. Colours and appearance come entirely from the host's shadcn components and tokens.

Run `node --test test/contracts/requests.test.mjs test/contracts/requests-board.test.mjs` for pure transforms and real-shadcn Happy DOM callbacks. After `npm run build`, open `npm run workspace-app` with `?requests` for the fictional Atelier Exemple demo, or run `npm run requests:journey` with Chromium for desktop/phone light/dark screenshots under `.cache/evidence/D141/`. The demo logs intent; it does not call a production endpoint or persist approvals. D-140 endpoint wiring and release remain consumer/owner work.
