import { createElement } from "react"
import { definePlugin } from "../../shared/plugins/definePlugin"
import type { LeftTabParams, Plugin } from "../../shared/plugins/types"
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

  function StaticDataPane({ params }: PaneProps<LeftTabParams>) {
    return createElement(DataExplorer, {
      adapter: opts.adapter,
      onActivate: opts.onActivate,
      query: params?.query ?? "",
      searchable: false,
    })
  }

  return definePlugin({
    id,
    label,
    outputs: [
      {
        type: "left-tab",
        id: `${id}-tab`,
        title: label,
        component: StaticDataPane,
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
