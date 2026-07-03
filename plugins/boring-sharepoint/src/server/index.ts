import { defineServerPlugin } from "@hachej/boring-workspace/server"
import {
  BORING_SHAREPOINT_PLUGIN_ID,
  BORING_SHAREPOINT_PLUGIN_LABEL,
} from "../shared"

export default defineServerPlugin({
  id: BORING_SHAREPOINT_PLUGIN_ID,
  label: BORING_SHAREPOINT_PLUGIN_LABEL,
  systemPrompt:
    "SharePoint plugin shell is installed. Future versions will preview and agent-edit SharePoint-hosted Excel and PowerPoint documents.",
})

export {
  BORING_SHAREPOINT_PLUGIN_ID,
  BORING_SHAREPOINT_PLUGIN_LABEL,
} from "../shared"
