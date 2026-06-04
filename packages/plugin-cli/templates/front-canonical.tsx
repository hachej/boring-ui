// CANONICAL front/index.tsx for a boring-ui runtime plugin.
// Copy this shape — replace <kebab-name> and <Label>.
//
// Structure rule:
// - Commands open full-size center panes for detailed work.
// - Left tabs are compact, persistent sidebar/navigator panes.
// - If a plugin has both, do NOT render the same component in both places.
//   Register a small LeftPane and a separate MainPane.

import React from "react"
import { definePlugin, type PaneProps } from "@hachej/boring-workspace/plugin"
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Toolbar,
  ToolbarGroup,
} from "@hachej/boring-ui-kit"

const MAIN_PANEL_ID = "<kebab-name>.panel"
const LEFT_PANEL_ID = "<kebab-name>.left"

function MainPane() {
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-background text-foreground">
      <Toolbar className="border-b border-border px-3 py-2">
        <ToolbarGroup>
          <Badge variant="secondary">Runtime plugin</Badge>
          <Badge variant="outline"><Label></Badge>
        </ToolbarGroup>
        <ToolbarGroup className="ml-auto">
          <Button size="sm" variant="secondary">Refresh</Button>
        </ToolbarGroup>
      </Toolbar>

      <div className="min-h-0 min-w-0 flex-1 overflow-auto p-4">
        <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
          <Card className="min-w-0">
            <CardHeader>
              <CardTitle><Label></CardTitle>
              <CardDescription>
                This is the full center pane. Put detailed views, tables, charts,
                editors, previews, and multi-step workflows here.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <EmptyState
                title="Nothing to show yet"
                description="Connect data, register a surface resolver, or add actions for this plugin."
                actions={<Button size="sm">Primary action</Button>}
              />
            </CardContent>
          </Card>

          <Card className="min-w-0">
            <CardHeader>
              <CardTitle className="text-sm">Details</CardTitle>
              <CardDescription>Use side cards for metadata or secondary controls.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 text-sm text-muted-foreground">
                <div className="flex items-center justify-between gap-3">
                  <span>Status</span>
                  <Badge variant="outline">Ready</Badge>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>Items</span>
                  <span>0</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

function LeftPane({ containerApi }: PaneProps) {
  const openMainPane = () => {
    containerApi.addPanel({
      id: `${MAIN_PANEL_ID}.from-left`,
      component: MAIN_PANEL_ID,
      title: "<Label>",
      params: { source: "left-tab" },
    })
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-background text-foreground">
      <div className="border-b border-border/60 px-3 py-2">
        <div className="text-sm font-medium"><Label></div>
        <div className="text-xs text-muted-foreground">Compact sidebar navigator</div>
      </div>

      <div className="min-h-0 min-w-0 flex-1 overflow-auto p-3">
        <div className="space-y-3">
          <Card className="min-w-0">
            <CardHeader className="space-y-1 p-3">
              <CardTitle className="text-sm">Overview</CardTitle>
              <CardDescription className="text-xs">
                Keep left tabs small: summary, filters, navigation, and actions.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-3 pt-0">
              <Button size="sm" className="w-full" onClick={openMainPane}>
                Open main pane
              </Button>
            </CardContent>
          </Card>

          <div className="space-y-1 text-xs text-muted-foreground">
            <div className="rounded-md border border-border bg-card px-2 py-1.5">Recent item</div>
            <div className="rounded-md border border-border bg-card px-2 py-1.5">Saved filter</div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default definePlugin({
  id: "<kebab-name>",              // contribution namespace; matching package name is recommended
  label: "<Label>",
  panels: [
    { id: MAIN_PANEL_ID, label: "<Label>", component: MainPane },
    // Optional left-tab component. Register separately from the main panel so
    // the sidebar does not duplicate a full workbench view.
    { id: LEFT_PANEL_ID, label: "<Label>", component: LeftPane },
  ],
  commands: [
    { id: "<kebab-name>.open", title: "Open <Label>", panelId: MAIN_PANEL_ID },
  ],
  // Do not add leftTabs just because a plugin has a panel. A left tab is a
  // permanent sidebar category. Keep it compact, and use its buttons/rows to
  // open the full center panel via containerApi.addPanel(...).
  //
  // If this plugin should have persistent sidebar navigation, uncomment this:
  // leftTabs: [
  //   { id: "<kebab-name>.tab", title: "<Label>", panelId: LEFT_PANEL_ID },
  // ],
  //
  // File visualizer example: import WORKSPACE_OPEN_PATH_SURFACE_KIND from
  // "@hachej/boring-workspace/plugin", import useApiBaseUrl/useWorkspaceRequestId
  // from "@hachej/boring-workspace", set kind: WORKSPACE_OPEN_PATH_SURFACE_KIND,
  // check request.target (e.g. .endsWith(".csv")), and fetch raw file bytes
  // from `${apiBaseUrl}/api/v1/files/raw?path=${encodeURIComponent(path)}` with
  // x-boring-workspace-id when useWorkspaceRequestId() returns one.
  // surfaceResolvers: [
  //   { id: "<kebab-name>.surface", kind: WORKSPACE_OPEN_PATH_SURFACE_KIND, resolve(request) { ... } },
  // ],
  //
  // Escape hatch for conditional registration:
  // setup: (api) => { if (env.beta) api.registerPanel(betaPanel) },
})

// Responsive pane rule: panels and left tabs live inside resizable dock regions.
// Avoid fixed large widths; prefer w-full/min-w-0 layouts and responsive chart
// wrappers such as Recharts ResponsiveContainer.
//
// All available `definePlugin` config fields:
//   id            (required, string)
//   label         (optional, string)
//   panels        [{ id, label, component }]
//   commands      [{ id, title, panelId }]
//   leftTabs      [{ id, title, panelId }]
//   surfaceResolvers [{ id, kind, resolve(request) }]
//   providers     (rare — context wrappers)
//   bindings      (rare — same as provider)
//   catalogs      (rare)
//   setup         (escape hatch — called last, gets the imperative api)
//
// Composition is JS spread + concat:
//   import { baseConfig } from "@hachej/some-base"
//   definePlugin({
//     ...baseConfig,
//     id: "my-extended",
//     commands: [...baseConfig.commands, myExtraCommand],
//   })
