import { definePlugin } from "@hachej/boring-workspace/plugin"
import {
  BORING_SHAREPOINT_PLUGIN_ID,
  BORING_SHAREPOINT_PLUGIN_LABEL,
} from "../shared"

export default definePlugin({
  id: BORING_SHAREPOINT_PLUGIN_ID,
  label: BORING_SHAREPOINT_PLUGIN_LABEL,
})

export {
  BORING_SHAREPOINT_PLUGIN_ID,
  BORING_SHAREPOINT_PLUGIN_LABEL,
} from "../shared"
