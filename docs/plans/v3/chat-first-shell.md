# Chat-first shell: one conversation, one artifact, a Library behind it

Status: workspace-package redesign direction, owner-reviewed 2026-09-18. Partly overtaken by
the v3 direction ([`README.md`](README.md)): the boring-hub ship branch now has its own shell
with the same shape, so for one-chat the v2 shell is redundant. The analysis and the module
split remain the reference for what the workspace package should become.
Interactive version with the mockup and diagrams:
[`artifacts/chat-first-shell.html`](artifacts/chat-first-shell.html)
(published copy: https://claude.ai/artifact/YP2qfVagAJ9GiX5mUbkJA8).

## Diagnosis

The building blocks in `packages/workspace` are sound. The assembly is wrong: the chat lives
inside the dock and every host has to subtract chrome to get a simple app.

Inside the package (audit 2026-09-18):
- **No slot API.** `WorkspaceAgentFrontProps` has about 95 props. It `Omit`s every layout slot
  of `ChatLayout` (nav, center, surface, sidebar, chatPanes) at
  `WorkspaceAgentFront.tsx:234-251`, then hardcodes them at `:2744-2766`. Seven props are typed
  as public API and never read.
- **Layout is owned in five places** (PluginTabsWorkspaceShell, ChatLayout, ChatPaneStageDock,
  SurfaceShell, DockviewShell) with about fifteen localStorage keys and three resize-handle
  implementations. `ChatLayout.tsx:566-576` re-opens the chat whenever the workbench closes.
- **The 2,991-line front is thirteen subsystems**, not a composition root. 167 commits in six
  months.
- **Two layout systems are dead but exported** (`IdeLayout`, `buildChatLayout`,
  `ResponsiveDockviewShell`) while the clean slot component `PluginTabsWorkspaceShell` and
  the pure-props `AppLeftPane` are not exported. The default `workspaceLayout="classic"` is
  used by no real host.
- **Plugin ids are hardcoded in chrome**: "files" pinned and force-selected, "skills" and
  "plugins" reserved, "agent" in a global shortcut, four core panels registered
  unconditionally.
- Good news: `FileTree` is fully standalone; `DockviewShell` needs only `RegistryProvider`
  and one `bindStore()`; `FileTreeView` needs only `DataProvider`; the surface-resolver
  indirection is clean.

Across the consumers:

| App | Wants | Pays with |
| --- | --- | --- |
| one-chat | Apps column, one conversation, one self-opening screen | Runs only off an unpushed local branch of the package (+1,262 lines, ten new props). Six vite aliases. 102 lines of `!important`. Private types crossed via `any`. Context broken across the package's own entry points. |
| boring-clinic | Custom nav and one workbench of clinic panes | Bypasses the front for its real route. Four pnpm patches, 2,210 lines against dist. Version-locked at 0.1.103. |
| seneca | Default shell plus a chrome-free hero | Patched minified `dist/app-front.js`. Hero strips chrome with `!important`. |
| constellation, full-app, cli | The package default | Nothing. This is why the composition seam never grew. |

Prior art: `docs/plans/multiagent-shell/shell-plan.md:296-330` (layout traits), open beads
`wt-391-forward-shell-ngfs.2` and `se-0 gahn.1`.

## Target

Three surfaces, not one shell:
1. **Left nav.** New thread, Library, the thread list. Nothing else.
2. **Thread route.** Transcript plus artifact cards. Clicking a card opens one artifact in a
   viewer beside the chat (breadcrumb, zoom, download, open in Library, close). No dockview.
3. **Library route.** Today's file tree plus dockview, mounted as a destination, file-tree rail
   on the left.

Ratified nouns: Thread is the durable job root (RECONCILIATION §9a); the artifact viewer is
the "inside a Thread" mount of one-workbench-many-mounts (§8a); Library is the standalone
mount; chat-first Experiences are explicitly allowed. Cards list artifacts, not Views (§8c
forbids minting a View descriptor in the product layer). The nav must say Threads, never
sessions.

### An app and its Thread are one whole

Layout is a property of the Thread, chosen by the app, not a mode of the shell:
- `layout: "thread" | "app"`. Thread = transcript plus one artifact viewer. App = the app's
  screen fills the main area as a full-bleed iframe (the existing html viewer, header hidden).
- `chatMount: "column" | "floating" | "in-app"`. Both persist on the Thread record.
- In an app layout the agent is just a backend and the chat is just a frontend component.

Chat inside the app, in two steps:
1. **Portal.** The app declares a chat slot over an iframe-to-shell `postMessage` channel
   (`chat-slot`, `chat-slot-resize`); the shell positions its own chat panel over the iframe.
   The parent validates `event.source`, since a sandboxed srcDoc has origin "null". Both
   server bridges (UI bridge, workspace bridge) stay as they are.
2. **Native.** A chat web component shipped into the sandbox, transport relayed through the
   bridge with a scoped token. Rendering and transport only; pi keeps the brain.

### The chat is a viewer of the Thread

The chat panel is a viewer whose target is a Thread instead of a path, resolved through the
same registry from an open request of kind `thread`. Column, floating and in-app become
placements that work for any viewer; the portal declares `slot: { viewer, rect }`. Two things
stay on the Thread adapter: only one instance per Thread accepts input at a time, and session
lifecycle (ask_user, attention) belongs to the shell.

## Three options

| Option | Cost | Risk | Verdict |
| --- | --- | --- | --- |
| Patch WorkspaceAgentFront | Days | The 25th and 26th mode props on a 3k-line file. The road that produced today. | no |
| Rebuild from scratch | Months | Throws away FileTreeView, DockviewShell, MarkdownEditor, HtmlViewer, session store, bridge. | no |
| **New layout layer** | 3 to 4 weeks to one-chat | The blocks are cleaner than feared; the entanglement is in the legacy front, which this option never touches. | recommended |

## Package split (phase 5)

`boring-workspace` keeps its name and becomes the shell: AppShell, NavRail, ThreadRoute,
ArtifactViewer, Thread adapter, chat mounts, iframe portal protocol, the plugin model
(`definePlugin`, panels, surface resolver registry), the built-in viewer plugins (code, csv,
markdown, image, pdf, html, media, url pane), minimal provider, createWorkspaceAgentServer,
both bridges, ui-control tools. New `boring-library`: FileTree with its data provider,
DockviewShell, LibraryRoute; depends on boring-workspace; the host wires it in with
`routes={{ library: LibraryRoute }}`. `plugins/*` unchanged: heavy or domain viewers with
their agent tools (deck, diagram, excalidraw, bi-dashboard).

Viewers are plugin contributions, not a package: a panel plus a surface resolver with
patterns and a score. Diagram and deck already work this way. The filesystem plugin's seven
viewers become built-ins in the shell; tree and dock go to the Library. The ArtifactViewer and
the Library dock ask the same resolver registry, so any viewer plugin works in a chat card, in
the Library and in an evidence popover. No React context crosses a package line.

## Plan

0. **Prove the blocks are free-standing** (2 days, gate). Render `FileTree`, `DockviewShell`
   and one viewer with no `WorkspaceAgentFront` and no `ChatLayout`. Export
   `PluginTabsWorkspaceShell`, `AppLeftPane`, `ChatPaneStage`; stop exporting the dead layout
   API. Land the one-chat branch's package changes on main first.
1. **Artifact events and cards** (4 days). Session-scoped `artifact` event from `openFile`,
   `writeFile` and the ui-control open tool; `useSessionArtifacts` hook and `ArtifactCard`.
2. **ArtifactViewer** (3 days). One component, path in, rendered through the shared resolver.
3. **AppShell and ThreadRoute** (5 days, gate). Positive props only. Chat mounts column and
   floating. Gate: one-chat's `App.tsx` under sixty lines, zero `display:none` in `app.css`.
4. **LibraryRoute** (3 days). Rail side as a prop, default left.
   4b. **App layout and in-app chat (portal)** (4 days).
5. **Migrate first-party hosts, then delete** (2 weeks). Delete WorkspaceAgentFront,
   ChatLayout, ChatPaneStageDock, SurfaceShell's second rail and the dead layout exports.
   Done when the largest front file is under 800 lines and no consumer patches dist.
6. **Native in-app chat** (later).

## Benchmark: the one-chat mount

Today: about twenty negation props on `WorkspaceAgentFront` plus ten `display:none
!important` rules. Target:

```tsx
<AppShell
  workspaceId="one-chat"
  agentTypeId="colleague"
  labels={{ threads: 'My apps', newThread: 'New app' }}
  routes={{
    thread: { transcript: 'messages-only', visibleTools: ['ask_user'] },
    library: LibraryRoute,   // from boring-library
  }}
  renderNavItem={AppRow}
  plugins={[createAskUserPlugin()]}
/>
```
