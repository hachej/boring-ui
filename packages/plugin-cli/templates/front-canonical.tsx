// CANONICAL front/index.tsx for a boring-ui plugin.
// Copy this shape — replace <kebab-name> and <Label>.
//
// definePlugin takes a single DECLARATIVE config object. For
// conditional registration or runtime branching that the declarative
// fields can't express, use the optional `setup: (api) => void`
// escape hatch — it runs LAST, after every declarative field has
// been registered.

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

function MyPane() {
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-background text-foreground">
      <Toolbar className="border-b border-border px-3 py-2">
        <ToolbarGroup>
          <Badge variant="secondary">Runtime plugin</Badge>
        </ToolbarGroup>
      </Toolbar>

      <div className="min-h-0 min-w-0 flex-1 overflow-auto p-4">
        <Card>
          <CardHeader>
            <CardTitle><Label></CardTitle>
            <CardDescription>
              Replace this scaffold with the plugin's real workspace UI.
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
      </div>
    </div>
  )
}

export default definePlugin({
  id: "<kebab-name>",              // contribution namespace; matching package name is recommended
  label: "<Label>",
  panels: [
    { id: "<kebab-name>.panel", label: "<Label>", component: MyPane },
  ],
  commands: [
    { id: "<kebab-name>.open", title: "Open <Label>", panelId: "<kebab-name>.panel" },
  ],
  // Do not add leftTabs by default: left tabs are persistent sidebar
  // navigation. Use them only for always-on tools/catalogs that deserve a
  // permanent sidebar entry; file visualizers should use surfaceResolvers.
  // Keep left-tab panes responsive too: use min-w-0 + overflow-auto, and use
  // containerApi.addPanel(...) from PaneProps when a sidebar button should open
  // a center workbench pane.
  // leftTabs: [
  //   { id: "<kebab-name>.tab", title: "<Label>", panelId: "<kebab-name>.panel" },
  // ],
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
