# Agent workspace

`pi-app`'s `AgentWorkspace` is a whole agent page: sessions, chat, Library and artifact viewers over one resource client. It also runs embedded in a shell screen and as a placed workspace.

## Sub-features

- `workspace-page` default three-column layout: sessions, chat, artifact panel. `registry/pi-app/agent-workspace.tsx`.
- `workspace-embedded` `layout="embedded"`: one compact bar (History, Library, New), no sessions pane; inside a shell screen the bar uses the screen header. Host `barPanels` supply content/dot/open-state observation; `barOptions.panelsFirst` leads with those panels and `newChat: false` places New inside History. Defaults are unchanged. `registry/pi-app/workspace-bar.tsx`.
- `workspace-chat-only`: omit both resource props for a real chat-only workspace, without a fake filesystem or file endpoint. No Library or automatic file viewer is offered.
- `workspace-placed` `PlacedAgentWorkspace`: one controller in a tab or collapsed beside the app. `registry/placed-agent/placed-agent-workspace.tsx`.
- `workspace-library` Library: files and versions over a revision provider or a discovered endpoint. `registry/pi-app/`, `registry/file-tree/file-tree.tsx`.
- `workspace-library-folders` the file tree renames, moves and deletes a folder through the row's menu, F2 and Delete, one file at a time; a refusal says how many files were changed, and trying again finishes; a rename onto an existing folder is refused. No New folder: a folder exists through its files. `packages/ui/src/file-tree.ts`, `file-tree-view.tsx`.
- `workspace-artifacts` artifact panel and kinds: `defaultKinds()` from `pi-app-kinds`, own kinds first. `registry/pi-app-kinds/`, `registry/pi-app/artifact-panel.tsx`.
- `workspace-viewers` Markdown, HTML, image, PDF and code viewers loaded by kind. `registry/viewer-markdown/`, `viewer-html/`, `viewer-image/`, `viewer-pdf/`, `viewer-code/`.
- `workspace-documents` `documents`: the Library, a file and its revisions; `DocumentSheet`. `registry/documents/`.
- `workspace-windows` floating utility windows and launcher. `registry/windows/`.

## How to get to it (user POV)

- A full agent page, a nav item in a shell, or the « Agent » tab of a placed workspace.
- Open a file the agent presented from its artifact card; open the Library from the bar.

## Driving it with the example journeys

Preconditions: `npm run build`, Chromium.

- **Folders.** `workspace-library-folders`: `node --test test/ui/file-tree.mjs` renames, moves and deletes a folder against a fictional sqlite workspace, with a refusal halfway and a retry.
- **Page.** `workspace-page`, `workspace-library`, `workspace-artifacts`: `npm run workspace-app:journey`.
- **Embedded.** `workspace-embedded`: `npm run app-shell:journey:workspace`; the bar buttons `workspace-bar-history`, `workspace-bar-library`, `workspace-bar-new` sit in the shell header. `node examples/pm-panel/journey.mjs` drives the optional host-first Tasks panel and New inside History.
- **Chat only.** `workspace-chat-only`: `node --test test/contracts/pm-panel-thread.test.mjs` mounts both PM placements without resources and drives the actual regular workspace and native-question composer.
- **Placed.** `workspace-placed`: `npm run app-shell:journey:placed` (wide: floats as ambient; phone: lent to the layer at peek).
- **Viewers.** `workspace-viewers`: `npm run mockup:journey`, `npm run diagram:journey`, `npm run records:journey`.
- **Documents.** `workspace-documents`: `npm run app-shell:journey:documents`.
- **Windows.** `workspace-windows`: `npm run windows:journey`.
- **Proof.** ARIA snapshot and screenshot; after a save, a second read of the file through the provider.

## Gotchas

- Without `artifactKinds` every file shows as text.
- A plain resource handler has no listing, so no Library; use `createRevisionHandler`.
- A change feed answering 501 ends live updates without retry.
