import "@openuidev/react-ui/components.css"
import { LayoutDashboard } from "lucide-react"
import { definePlugin } from "@hachej/boring-workspace/plugin"
import { BiDashboardPane } from "./BiDashboardPane"
import { createGeneratedPaneExplorerPane } from "@hachej/boring-generated-pane/front"
import { BI_DASHBOARD_LEFT_TAB_ID, BI_DASHBOARD_PANEL_ID } from "./constants"
import { biDashboardSurfaceResolver } from "./surfaceResolver"

export { BiDashboardPane }
export type { BiDashboardPaneParams } from "./BiDashboardPane"
export { biDashboardGeneratedPaneProfile } from "./profile"
export { BiDashboardRenderProvider, useBiDashboardRenderContext } from "./renderContext"
export type { BiDashboardRenderState } from "./renderContext"
export { sampleBiDashboardSpec } from "./sampleSpec"
export { BI_DASHBOARD_LEFT_TAB_ID, BI_DASHBOARD_PANEL_ID } from "./constants"
export { DashboardFilesPane } from "./DashboardFilesPane"
export { biDashboardSurfaceResolver } from "./surfaceResolver"
export type {
  BslDashboardSpec,
  BslDashboardComponentSpec,
  BslDashboardQuerySpec,
  BslChartSpec,
  BslPerspectiveViewerSpec,
} from "../shared"

export const biDashboardPlugin = definePlugin({
  id: "bi-dashboard",
  label: "BI Dashboard",
  panels: [
    {
      id: BI_DASHBOARD_PANEL_ID,
      label: "BI Dashboard",
      icon: LayoutDashboard,
      component: BiDashboardPane,
      supportsFullPage: true,
    },
  ],
  leftTabs: [
    {
      id: BI_DASHBOARD_LEFT_TAB_ID,
      title: "Dashboards",
      panelId: BI_DASHBOARD_LEFT_TAB_ID,
      icon: LayoutDashboard,
      component: createGeneratedPaneExplorerPane({
        title: "Dashboards",
        patterns: ["**/*.dashboard.json"],
        panelId: BI_DASHBOARD_PANEL_ID,
        itemLabel: "Dashboard",
        emptyDescription: "Create dashboards/*.dashboard.json files to list BI dashboards here.",
      }),
      chromeless: true,
    },
  ],
  surfaceResolvers: [biDashboardSurfaceResolver],
  commands: [
    {
      id: "bi-dashboard.open",
      title: "Open BI Dashboard",
      panelId: BI_DASHBOARD_PANEL_ID,
      keywords: ["bsl", "business intelligence", "dashboard", "perspective", "echarts"],
    },
  ],
})

export default biDashboardPlugin
