// CANONICAL front/index.tsx for a boring-ui runtime plugin.
// Copy this shape — replace <kebab-name> and <Label>.
//
// Structure rule:
// - Use placement: "workspace-page" for full plugin pages/dashboards.
// - Use placement: "shared-dockview" for artifacts/details/results.
// - If your plugin needs side navigation, render it inside your page as normal React.

import React from "react"
import { definePlugin } from "@hachej/boring-workspace/plugin"
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

const MAIN_PANEL_ID = "<kebab-name>.page"

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
                This is the full workspace page. Put detailed views, tables, charts,
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


export default definePlugin({
  id: "<kebab-name>",              // contribution namespace; matching package name is recommended
  label: "<Label>",
  panels: [
    { id: MAIN_PANEL_ID, label: "<Label>", placement: "workspace-page", component: MainPane },
  ],
  commands: [
    { id: "<kebab-name>.open", title: "Open <Label>", panelId: MAIN_PANEL_ID },
  ],
  // If this plugin needs navigation/facets/lists, render them inside MainPane
  // as regular React/shadcn layout. Do not register shell left tabs.
  //
  // For generated artifacts/details, add a separate panel with
  // placement: "shared-dockview" and open it with containerApi.addPanel(...).
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

// Responsive pane rule: plugin pages and panels live inside resizable dock regions.
// Avoid fixed large widths; prefer w-full/min-w-0 layouts and responsive chart
// wrappers such as Recharts ResponsiveContainer.
//
// All available `definePlugin` config fields:
//   id            (required, string)
//   label         (optional, string)
//   panels        [{ id, label, placement, component }]
//   commands      [{ id, title, panelId }]
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
