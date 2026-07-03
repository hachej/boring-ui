import { definePlugin } from "@hachej/boring-workspace/plugin"
import {
  BORING_SHAREPOINT_APP_LEFT_ACTION_ID,
  BORING_SHAREPOINT_OFFICE_PREVIEW_PANEL_ID,
  BORING_SHAREPOINT_PLUGIN_ID,
  BORING_SHAREPOINT_PLUGIN_LABEL,
  BORING_SHAREPOINT_SETTINGS_COMMAND_ID,
  BORING_SHAREPOINT_SETTINGS_PANEL_ID,
} from "../shared"
import { OfficePreviewPanel, SharePointSettingsOverlay, SharePointSettingsPanel } from "./panels"
import { sharePointOfficeCloudRefSurfaceResolver } from "./surfaceResolver"

export default definePlugin({
  id: BORING_SHAREPOINT_PLUGIN_ID,
  label: BORING_SHAREPOINT_PLUGIN_LABEL,
  panels: [
    {
      id: BORING_SHAREPOINT_OFFICE_PREVIEW_PANEL_ID,
      label: "Office preview",
      component: OfficePreviewPanel,
      placement: "center",
    },
    {
      id: BORING_SHAREPOINT_SETTINGS_PANEL_ID,
      label: "SharePoint settings",
      component: SharePointSettingsPanel,
      placement: "center",
    },
  ],
  commands: [
    {
      id: BORING_SHAREPOINT_SETTINGS_COMMAND_ID,
      title: "SharePoint: Open settings/status",
      panelId: BORING_SHAREPOINT_SETTINGS_PANEL_ID,
      keywords: ["sharepoint", "microsoft 365", "office", "integration", "settings", "status"],
    },
  ],
  appLeftActions: [
    {
      id: BORING_SHAREPOINT_APP_LEFT_ACTION_ID,
      label: "SharePoint",
      overlay: SharePointSettingsOverlay,
      order: 60,
    },
  ],
  surfaceResolvers: [sharePointOfficeCloudRefSurfaceResolver],
})

export { OfficePreviewPanel, SharePointSettingsOverlay, SharePointSettingsPanel } from "./panels"
export { sharePointOfficeCloudRefSurfaceResolver } from "./surfaceResolver"
export {
  BORING_SHAREPOINT_APP_LEFT_ACTION_ID,
  BORING_SHAREPOINT_OFFICE_PREVIEW_PANEL_ID,
  BORING_SHAREPOINT_PLUGIN_ID,
  BORING_SHAREPOINT_PLUGIN_LABEL,
  BORING_SHAREPOINT_SETTINGS_COMMAND_ID,
  BORING_SHAREPOINT_SETTINGS_PANEL_ID,
} from "../shared"
