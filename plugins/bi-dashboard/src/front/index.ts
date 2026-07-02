import { LayoutDashboard } from "lucide-react"
import { definePlugin } from "@hachej/boring-workspace/plugin"
import { BiDashboardPane } from "./BiDashboardPane"
import { DashboardFilesPane } from "./DashboardFilesPane"
import { BI_DASHBOARD_LEFT_TAB_ID, BI_DASHBOARD_PANEL_ID } from "./constants"
import { biDashboardSurfaceResolver } from "./surfaceResolver"

export { BiDashboardPane }
export type { BiDashboardPaneParams } from "./BiDashboardPane"
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
  workspaceSources: [
    {
      id: BI_DASHBOARD_LEFT_TAB_ID,
      label: "Dashboards",
      icon: LayoutDashboard,
      component: DashboardFilesPane,
      defaultPanelId: BI_DASHBOARD_PANEL_ID,
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
