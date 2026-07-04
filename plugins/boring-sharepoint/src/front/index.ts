import { definePlugin } from "@hachej/boring-workspace/plugin"
import {
  BORING_SHAREPOINT_OFFICE_PREVIEW_PANEL_ID,
  BORING_SHAREPOINT_PLUGIN_ID,
  BORING_SHAREPOINT_PLUGIN_LABEL,
} from "../shared"
import { OfficePreviewPanel } from "./panels"
import { sharePointOfficeCloudRefSurfaceResolver } from "./surfaceResolver"

export default definePlugin({
  id: BORING_SHAREPOINT_PLUGIN_ID,
  label: BORING_SHAREPOINT_PLUGIN_LABEL,
  panels: [
    {
      id: BORING_SHAREPOINT_OFFICE_PREVIEW_PANEL_ID,
      label: "Office preview",
      component: OfficePreviewPanel,
      placement: "shared-dockview",
    },
  ],
  surfaceResolvers: [sharePointOfficeCloudRefSurfaceResolver],
})

export { OfficePreviewPanel } from "./panels"
export { sharePointOfficeCloudRefSurfaceResolver } from "./surfaceResolver"
export {
  BORING_SHAREPOINT_OFFICE_PREVIEW_PANEL_ID,
  BORING_SHAREPOINT_PLUGIN_ID,
  BORING_SHAREPOINT_PLUGIN_LABEL,
} from "../shared"
