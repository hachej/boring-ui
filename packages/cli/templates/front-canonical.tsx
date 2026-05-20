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

function MyPane() {
  return <div style={{ padding: 16 }}>Hello from &lt;kebab-name&gt;</div>
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
  leftTabs: [
    { id: "<kebab-name>.tab", title: "<Label>", panelId: "<kebab-name>.panel" },
  ],
  // File visualizer example: import WORKSPACE_OPEN_PATH_SURFACE_KIND from
  // "@hachej/boring-workspace", set kind: WORKSPACE_OPEN_PATH_SURFACE_KIND,
  // check request.target (e.g. .endsWith(".csv")), and fetch raw file bytes
  // from /api/v1/files/raw?path=${encodeURIComponent(request.target)}.
  // surfaceResolvers: [
  //   { id: "<kebab-name>.surface", kind: WORKSPACE_OPEN_PATH_SURFACE_KIND, resolve(request) { ... } },
  // ],
  //
  // Escape hatch for conditional registration:
  // setup: (api) => { if (env.beta) api.registerPanel(betaPanel) },
})

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
