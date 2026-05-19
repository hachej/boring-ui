// CANONICAL front/index.tsx for a boring-ui plugin.
// Copy this shape — replace <kebab-name> and <Label>.
//
// definePlugin accepts a DECLARATIVE config object (preferred — matches
// the shape most JS plugin systems use). The function form
// `definePlugin("<id>", (api) => { ... })` is also accepted for
// backwards compatibility but the declarative form is what you'll see
// in new code.

import React from "react"
import { definePlugin } from "@hachej/boring-workspace/plugin"

function MyPane() {
  return <div style={{ padding: 16 }}>Hello from &lt;kebab-name&gt;</div>
}

export default definePlugin({
  id: "<kebab-name>",              // MUST match package.json#name (no @scope)
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
  // surfaceResolvers: [
  //   { id: "<kebab-name>.surface", kind: "<kebab-name>.open", resolve(req) { ... } },
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
