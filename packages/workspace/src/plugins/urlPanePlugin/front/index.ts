import { createElement } from "react"
import { MonitorPlay } from "lucide-react"
import { definePlugin } from "../../../shared/plugins/frontFactory"
import type { PaneProps } from "../../../shared/types/panel"
import { URL_PANE_PANEL_ID, URL_PANE_PLUGIN_ID, type UrlPanePaneParams } from "../../../shared/urlPane"
import { UrlPane } from "./UrlPane"

export type UrlPanePaneProps = PaneProps<UrlPanePaneParams>

export function UrlPanePane({ params, className }: UrlPanePaneProps) {
  return createElement(UrlPane, {
    url: params?.url,
    title: params?.title,
    className,
  })
}

/**
 * The live-demo half of the factory's two-artifact worker handoff (gh-1187 S3):
 * a worker points this pane at its running dev server, the owner reviews it
 * next to the present-pr page in the HTML viewer. Origins are allowlisted
 * server-side — see `shared/urlPane.ts`.
 */
export const urlPanePlugin = definePlugin({
  id: URL_PANE_PLUGIN_ID,
  label: "URL pane",
  panels: [
    {
      id: URL_PANE_PANEL_ID,
      label: "Live demo",
      icon: MonitorPlay,
      component: UrlPanePane,
      placement: "center",
      supportsFullPage: true,
      source: "builtin",
    },
  ],
})

export { UrlPane } from "./UrlPane"
export default urlPanePlugin
