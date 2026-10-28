# Agent workspace

`pi-app`'s `AgentWorkspace` is a whole agent page: sessions, chat, Library and artifact viewers over one resource client. It also runs embedded in a shell screen and as a placed workspace.

## Sub-features

- `workspace-page` default three-column layout: sessions, chat, artifact panel. `registry/pi-app/agent-workspace.tsx`.
- `workspace-embedded` `layout="embedded"`: one compact bar (History, Library, New), no sessions pane; inside a shell screen the bar uses the screen header. `registry/pi-app/workspace-bar.tsx`.
- `workspace-placed` `PlacedAgentWorkspace`: one controller in a tab or collapsed beside the app. `registry/placed-agent/placed-agent-workspace.tsx`.
- `workspace-library` Library: files and versions over a revision provider or a discovered endpoint. `registry/pi-app/`, `registry/file-tree/file-tree.tsx`.
- `workspace-artifacts` artifact panel and kinds: `defaultKinds()` from `pi-app-kinds`, own kinds first. `registry/pi-app-kinds/`, `registry/pi-app/artifact-panel.tsx`.
- `workspace-viewers` Markdown, HTML, image, PDF and code viewers loaded by kind. `registry/viewer-markdown/`, `viewer-html/`, `viewer-image/`, `viewer-pdf/`, `viewer-code/`.
- `workspace-documents` `documents`: the Library, a file and its revisions; `DocumentSheet`. `registry/documents/`.
- `workspace-windows` floating utility windows and launcher. `registry/windows/`.

## How to get to it (user POV)

- A full agent page, a nav item in a shell, or the « Agent » tab of a placed workspace.
- Open a file the agent presented from its artifact card; open the Library from the bar.

## Driving it with the example journeys

Preconditions: `npm run build`, Chromium.

- **Page.** `workspace-page`, `workspace-library`, `workspace-artifacts`: `npm run workspace-app:journey`.
- **Embedded.** `workspace-embedded`: `npm run app-shell:journey:workspace`; the bar buttons `workspace-bar-history`, `workspace-bar-library`, `workspace-bar-new` sit in the shell header.
- **Placed.** `workspace-placed`: `npm run app-shell:journey:placed` (wide: floats as ambient; phone: lent to the layer at peek).
- **Viewers.** `workspace-viewers`: `npm run mockup:journey`, `npm run diagram:journey`, `npm run records:journey`.
- **Documents.** `workspace-documents`: `npm run app-shell:journey:documents`.
- **Windows.** `workspace-windows`: `npm run windows:journey`.
- **Proof.** ARIA snapshot and screenshot; after a save, a second read of the file through the provider.

## Gotchas

- Without `artifactKinds` every file shows as text.
- A plain resource handler has no listing, so no Library; use `createRevisionHandler`.
- A change feed answering 501 ends live updates without retry.
