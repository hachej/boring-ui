import { definePlugin } from "@hachej/boring-workspace/plugin"
import { UrlPane } from "./UrlPane"

export const URL_PANE_PANEL_ID = "url-pane.panel"

export const urlPanePlugin = definePlugin({
  id: "url-pane",
  label: "URL Pane",
  panels: [
    {
      id: URL_PANE_PANEL_ID,
      label: "URL Pane",
      component: UrlPane,
      placement: "shared-dockview",
    },
  ],
  commands: [
    {
      id: "url-pane.open",
      title: "Open URL Pane",
      panelId: URL_PANE_PANEL_ID,
      keywords: ["browser", "iframe", "web", "url"],
    },
  ],
})

export default urlPanePlugin
export { UrlPane } from "./UrlPane"
