"use client"

import { definePlugin, type BoringFrontFactoryWithId } from "@hachej/boring-workspace/plugin"
import { CalendarClock } from "lucide-react"
import { BORING_AUTOMATION_PLUGIN_ID, BORING_AUTOMATION_PLUGIN_LABEL } from "../shared"
import { AutomationPanel } from "./AutomationPanel"
import { AutomationRuntimeProvider } from "./AutomationRuntimeContext"

export const boringAutomationPlugin: BoringFrontFactoryWithId = definePlugin({
  id: BORING_AUTOMATION_PLUGIN_ID,
  label: BORING_AUTOMATION_PLUGIN_LABEL,
  providers: [
    {
      id: `${BORING_AUTOMATION_PLUGIN_ID}.runtime`,
      component: AutomationRuntimeProvider,
    },
  ],
  panels: [
    {
      id: `${BORING_AUTOMATION_PLUGIN_ID}.panel`,
      label: BORING_AUTOMATION_PLUGIN_LABEL,
      icon: CalendarClock,
      component: AutomationPanel,
      placement: "center",
      source: "builtin",
    },
  ],
  commands: [
    {
      id: `${BORING_AUTOMATION_PLUGIN_ID}.open`,
      title: "Open Automations",
      panelId: `${BORING_AUTOMATION_PLUGIN_ID}.panel`,
    },
  ],
})

export default boringAutomationPlugin
export * from "../shared"
export { createAutomationClient, AutomationClientError } from "./client"
