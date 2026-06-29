# 00 — Overview

Goal: add a new opt-in `plugin-tabs` workspace layout beside the classic layout.

```tsx
<WorkspaceAgentFront workspaceLayout="classic" />      // default
<WorkspaceAgentFront workspaceLayout="plugin-tabs" />  // new layout
```

Architecture boundary:

```txt
WorkspaceAgentFront
  └─ WorkspaceLayoutHost
       ├─ ClassicWorkspaceLayout
       └─ PluginTabsWorkspaceLayout
            ├─ AppLeftPane / CollapsedLeftPaneHandle
            ├─ future PluginsPage / SkillsPage
            └─ PluginTabsWorkspace
                 └─ WorkspaceTabsController
```

Hard rules:

```txt
- Do not mutate SurfaceShell into this layout.
- Do not add plugin-tabs state to classic Dockview code.
- Do not use sidebar/sidebarPolicy concepts in plugin-tabs.
- Use plugin-level workspace capability as canonical metadata.
- Use reducers/controllers for mainMode and workspace tabs.
- Do not extract Filetree/filesystem as plugin dependency in this phase.
- DataExplorer/DataCatalog are reusable plugin/UI composition pieces, not shell capabilities.
```

Future full-layout main modes, introduced after phase 1:

```ts
type MainMode = "chat-workspace" | "plugins-page" | "skills-page"
```

Phase 1 plugin content page does **not** need this. It lives inside the current workspace shell as a plugin-provided `workspace-page`; implementation can host it in the shared Dockview and auto-collapse the current workspace left pane on open/activation.

Implementation order:

```txt
1. Plugin content page inside current workspace, no new app left pane/mainMode yet
2. Left pane
3. Workspace pane
```
