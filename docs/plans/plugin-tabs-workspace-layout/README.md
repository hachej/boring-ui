# Plugin Tabs Workspace Layout — Split Specs

Status: production architecture spec split from the original monolithic plan.

Implementation order:

```txt
1. Plugin content page inside current workspace, no new app left pane/mainMode yet
2. App left pane
3. Workspace pane / tabbed workspace
```

Specs:

```txt
00-overview.md
01-plugin-content-page.md
02-left-pane.md
03-workspace-pane.md
04-plugin-pane-contract.md
05-state-persistence-routing.md
06-plugin-dependencies-and-shared-panes.md
07-agent-ui-capabilities.md
08-dockview-ownership.md
09-two-plugin-display-modes.md
```

Core alignment:

```txt
left pane = app/session navigation
main content = current chat/workspace now; future modes later
workspace pane = current workspace now; future tabbed Files/plugin host later
plugin content page = regular React page; phase 1 hosted in shared Dockview with current left pane auto-collapsed
shared Dockview = one workspace-owned Dockview for plugin pages/panels/artifacts
data catalog = reusable plugin builder/component, not shell capability
agent UI capability = surface resolver kind + metadata + exec_ui openSurface
filetree = current/built-in behavior for now, not extracted as plugin dependency
```
