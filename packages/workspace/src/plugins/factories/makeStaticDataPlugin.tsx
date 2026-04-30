import { createElement } from "react"
import { definePlugin } from "../../shared/plugins/definePlugin"
import type { Plugin } from "../../shared/plugins/types"
import { DataExplorer } from "../../front/components/DataExplorer"
import type { ExplorerAdapter, ExplorerRow } from "../../front/components/DataExplorer/types"
import type { PaneProps } from "../../front/registry/types"

export interface StaticDataPluginOpts {
  id?: string
  label?: string
  adapter: ExplorerAdapter
  onActivate?: (row: ExplorerRow) => void
}

export function makeStaticDataPlugin(opts: StaticDataPluginOpts): Plugin {
  const id = opts.id ?? "static-data"
  const label = opts.label ?? "Data"

  function StaticDataPane(_props: PaneProps) {
    return createElement(DataExplorer, {
      adapter: opts.adapter,
      onActivate: opts.onActivate,
    })
  }

  return definePlugin({
    id,
    label,
    panels: [
      {
        id: `${id}-tab`,
        title: label,
        component: StaticDataPane,
        placement: "left-tab",
        source: "app",
      },
    ],
    catalogs: [
      {
        id,
        label,
        adapter: opts.adapter,
        onSelect: opts.onActivate ?? (() => {}),
      },
    ],
  })
}
