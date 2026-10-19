# Unreleased (0.4.3)

Non-breaking for files and props: older `*.maquette.json` files read unchanged, and a page that passes none of the new props renders as before.
`maquette-viewer` now also needs the new `diagram-viewer` item and the `toggle` and `tooltip` shadcn components; `pi-app` installs `diagram-viewer`.

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

