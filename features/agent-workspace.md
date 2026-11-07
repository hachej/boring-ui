# Agent workspace

`pi-app`'s `AgentWorkspace` is a whole agent page: sessions, chat, Library and artifact viewers over one resource client. It also runs embedded in a shell screen and as a placed workspace.

## Sub-features

- `workspace-page` default three-column layout: sessions, chat, artifact panel. `registry/pi-app/agent-workspace.tsx`.
- `workspace-embedded` `layout="embedded"`: one compact bar (History, Library, New), no sessions pane; inside a shell screen the bar uses the screen header. Host `barPanels` supply content/dot/open-state observation; `barOptions.panelsFirst` leads with those panels and `newChat: false` places New inside History. Defaults are unchanged. `registry/pi-app/workspace-bar.tsx`.
- `workspace-chat-only`: omit both resource props for a real chat-only workspace, without a fake filesystem or file endpoint. No Library or automatic file viewer is offered.
- `workspace-placed` `PlacedAgentWorkspace`: one controller in a tab or collapsed beside the app. `registry/placed-agent/placed-agent-workspace.tsx`.
- `workspace-library` Library: files and versions over a revision provider or a discovered endpoint. `registry/pi-app/`, `registry/file-tree/file-tree.tsx`.
- `workspace-library-folders` the file tree renames, moves and deletes a folder through the row's menu, F2 and Delete, one file at a time; a refusal says how many files were changed, and trying again finishes; a rename onto an existing folder is refused; a folder left empty disappears, on disk too, and a file landing meanwhile stays. No New folder: a folder exists through its files. `packages/ui/src/file-tree.ts`, `file-tree-view.tsx`.
- `workspace-library-status` a host shows a status per row: `FileTree decorate={entry => ({ badge: { label, tone }, detail })}` puts the host's shadcn Badge (tone neutral, success, warning or danger, read as « name: label »; plain text without a `Badge` component) and a short secondary text on that row; nothing returned, or no prop, leaves the row as it was. `packages/ui/src/file-tree-view.tsx`, `styles/file-tree.css`.
- `workspace-library-writable` the tree follows the host's word on writing, per folder: a listing (`list({ directory })`, sent for each folder) that says `writable: false` hides Upload (when `uploadDirectory` is in that folder), the file drop, and Rename, Move and Delete of its rows, and that folder is neither a drop target nor a Move to… destination; a folder not listed yet takes the nearest listed folder's word. A folder whose listing is refused (403) shows empty and read-only, with no error; one that is not there (404) leaves the tree. No `writable` field: every control as before. Never read from roles or `boring.json`. `packages/files/src/revision-protocol.ts`, `packages/ui/src/file-tree.ts`, `file-tree-view.tsx`.
- `workspace-artifacts` artifact panel and kinds: `defaultKinds()` from `pi-app-kinds`, own kinds first. `registry/pi-app-kinds/`, `registry/pi-app/artifact-panel.tsx`.
- `workspace-viewers` Markdown, HTML, image, PDF and code viewers loaded by kind. `registry/viewer-markdown/`, `viewer-html/`, `viewer-image/`, `viewer-pdf/`, `viewer-code/`. The Markdown pane is a flat white `bg-card` surface with no edge and no second box for the raw editor: the stylesheet (`viewers.css`, scoped to `.boring-markdown-pane`) paints the host Textarea, the border stays transparent on focus and a 2px inset ring shows (D-1734, `test/fixtures/surface.mjs`, `test/contracts/viewers-source.impl.mjs`).
- `workspace-document-type` scoped in-app MarkdownEditor/Highlights recipe: 12px body and 14px h1/h2/h3 default titles, retaining authored heading levels, rich/source behavior and host overrides; no global or marketing cap. `registry.json` (markdown-editor CSS).
- `workspace-board-projection` board@1 frames own tldraw viewport geometry, not a Card surface; generated maquette app screens pair the host's canvas/foreground tokens over the native canvas, preserving their Card blocks. Native tldraw and authored HTML styling are unchanged. `registry/board-viewer/board-canvas.tsx`.
- `workspace-task-list-layout` the consumer task-list recipe aligns each checkbox and label with a gap, uses a consistent Remove column and spaced add/recovery actions, with a 14px title and 12px body. Controller/edit/flush/recovery APIs are unchanged. `registry.json` (task-list-viewer CSS).
- `workspace-documents` `documents`: the Library, a file and its revisions; `DocumentSheet`. `registry/documents/`.
- `workspace-windows` floating utility windows and launcher. `registry/windows/`.
- `workspace-bar-host` `barOptions={{ hidden, command }}` (embedded): the host draws the one bar; `command={{ kind: 'history' | 'library' | 'new', n }}` still opens History or the Library, or starts a conversation (a new `n` per request). `registry/pi-app/workspace-bar.tsx`.

## How to get to it (user POV)

- A full agent page, a nav item in a shell, or the « Agent » tab of a placed workspace.
- Open a file the agent presented from its artifact card; open the Library from the bar.

## Driving it with the example journeys

Preconditions: `npm run build`, Chromium.

- **Host bar.** `workspace-bar-host`: render an embedded workspace with `barOptions={{ hidden: true, command }}`; changing `command.n` opens `workspace-history` or `workspace-library`, or calls `onNew`. Not driven by a journey yet.
- **Folders.** `workspace-library-folders`: `node --test test/ui/file-tree.mjs` renames, moves and deletes a folder against a fictional sqlite workspace, with a refusal halfway and a retry; `npm run file-tree:journey` drives the folder menu, F2, Move to… and Delete in a browser; `node --test test/packages/files-publication-recovery.test.mjs` prunes on disk.
- **Row status.** `workspace-library-status`: `node --test test/ui/file-tree.mjs` renders a tree with « Lu · 12 lignes », « En attente de lecture », « À revoir » and an undecorated row, and checks each badge by its label.
- **Write permission per folder.** `workspace-library-writable`: `node --test test/ui/file-tree.mjs` renders the tree on the fixture rule `{"public/": "members", "*": ["owner","editor"]}` through `connectRevisionProvider` and a mocked host: a member sees only `public/` with no Upload, Rename, Move or Delete and no drop target; the owner sees every control; a host without the field shows every control; a 403 folder is read-only without an error and a 404 folder disappears; each listing request carries its `directory`.
- **Page.** `workspace-page`, `workspace-library`, `workspace-artifacts`: `npm run workspace-app:journey`.
- **Embedded.** `workspace-embedded`: `npm run app-shell:journey:workspace`; the bar buttons `workspace-bar-history`, `workspace-bar-library`, `workspace-bar-new` sit in the shell header. `node examples/pm-panel/journey.mjs` drives the optional host-first Tasks panel and New inside History.
- **Chat only.** `workspace-chat-only`: `node --test test/contracts/pm-panel-thread.test.mjs` mounts both PM placements without resources and drives the actual regular workspace and native-question composer.
- **Placed.** `workspace-placed`: `npm run app-shell:journey:placed` (wide: floats as ambient; phone: lent to the layer at peek).
- **Viewers.** `workspace-viewers`: `npm run mockup:journey`, `npm run diagram:journey`, `npm run records:journey`.
- **Document type, board projection, task rows.** `workspace-document-type`, `workspace-board-projection`, `workspace-task-list-layout`: no automated browser proof. Their former tests needed an external preview harness that CI never had (D-1747) and were deleted; check by hand in the examples app at 1440 and 390 in both modes.
- **Documents.** `workspace-documents`: `npm run app-shell:journey:documents`.
- **Windows.** `workspace-windows`: `npm run windows:journey`.
- **Proof.** ARIA snapshot and screenshot; after a save, a second read of the file through the provider.

## Gotchas

- Without `artifactKinds` every file shows as text.
- A plain resource handler has no listing, so no Library; use `createRevisionHandler`.
- A change feed answering 501 ends live updates without retry.
