# 05 — State, Persistence, Routing

Cross-cutting state contracts for the plugin-tabs layout.

## Layout reducer

Do not implement shell state as scattered booleans.

```ts
interface PluginTabsLayoutState {
  mainMode: "chat-workspace" | "plugins-page" | "skills-page"
  leftPaneCollapsed: boolean
  workspaceOpen: boolean
  workspaceFullscreen: boolean
}

type PluginTabsLayoutAction =
  | { type: "openNewChat" }
  | { type: "openPluginsPage" }
  | { type: "openSkillsPage" }
  | { type: "collapseLeftPane" }
  | { type: "expandLeftPane" }
  | { type: "openWorkspace" }
  | { type: "closeWorkspace" }
  | { type: "enterWorkspaceFullscreen" }
  | { type: "exitWorkspaceFullscreen" }
  | { type: "agentOpenedWorkspaceTab" }
```

Transition rules:

```txt
openNewChat from plugins-page/skills-page:
  mainMode = chat-workspace
  create/activate chat
  exit workspace fullscreen

openPluginsPage:
  mainMode = plugins-page
  hide chat + workspace
  preserve workspace state

openSkillsPage:
  mainMode = skills-page
  replace chat area
  workspace may remain visible

closeWorkspace while skills-page:
  hide workspace
  keep skills-page visible

agent openFile/openPanel while plugins-page:
  stay plugins-page
  update hidden workspace state
  toast + badge/pulse workspace affordance

agent openFile/openPanel while skills-page:
  stay skills-page
  open/update workspace beside it if action requires workspace
```

## Hidden workspace feedback

When workspace changes while hidden by Plugins page:

```txt
- toast describing what opened
- badge/pulse workspace affordance
```

## Skills source/editability

Skills page uses same skill registry/source as slash command menu.

```ts
type SkillSourceKind = "project" | "user" | "packaged"

interface SkillListItem {
  id: string
  name: string
  sourceKind: SkillSourceKind
  folderPath: string
  mainFilePath?: string
  editable: boolean
}
```

Rules:

```txt
project skills:
  editable

user/global skills:
  read-only in phase 1

packaged skills:
  read-only

missing main markdown file:
  reveal skill folder only
  do not create file
```

Clicking skill:

```txt
- opens main file, normally SKILL.md
- opens Files tab with filetreeOpen = true
- reveals/uncollapses skill folder
- if main file missing, reveal folder only
```

## Persistence

Workspace tabs persist per workspace id.

```ts
interface PersistedPluginTabsWorkspaceStateV1 {
  version: 1
  workspaceId: string
  activeTabId: string | null
  tabs: PersistedWorkspaceTab[]
}
```

Validation:

```txt
unknown version:
  ignore with recoverable warning

malformed tab:
  drop with warning

missing file path:
  drop tab + toast/recoverable notice

missing plugin:
  restore visible "plugin missing" placeholder tab

missing active tab:
  choose first surviving tab or empty workspace page
```

## Auto-save before Files tab replacement

Atomic operation:

```ts
async function navigateFilesTabFromTree(tabId: WorkspaceTabId, targetPath: string) {
  if (targetAlreadyOpenElsewhere(targetPath)) return activateExistingTab(targetPath)
  await saveCurrentIfDirty(tabId)
  replaceTabPath(tabId, targetPath)
}
```

Rules:

```txt
- serialize navigation per Files tab
- if save fails, do not replace path
- show error/recoverable notice
- rapid clicks should not interleave saves/replacements
```

## Search routing

```txt
chat session search result click:
  same as session row default, replace/switch current chat pane

chat session search result hover/focus:
  show split/open-in-new-chat icon

workspace tab search:
  later, not phase 1
```

## Acceptance

```txt
[ ] Shell state lives in PluginTabsLayoutController/reducer
[ ] Workspace tabs live in WorkspaceTabsController/reducer
[ ] Plugins page hidden workspace updates toast + badge/pulse
[ ] Skills source/editability uses typed source model
[ ] Persistence has schema version
[ ] Persistence validates missing files/plugins/malformed tabs
[ ] Filetree navigation serializes auto-save before replacement
[ ] Search result behavior matches session list default + split hover icon
```
