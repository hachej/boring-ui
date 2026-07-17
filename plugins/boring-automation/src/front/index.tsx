"use client"

import { definePlugin, type BoringFrontAppLeftOverlayProps, type BoringFrontFactoryWithId, type PaneProps } from "@hachej/boring-workspace/plugin"
import { CalendarClock } from "lucide-react"
import { BORING_AUTOMATION_PLUGIN_ID, BORING_AUTOMATION_PLUGIN_LABEL } from "../shared"
import { AutomationPanel } from "./AutomationPanel"
import { AutomationRuntimeProvider } from "./AutomationRuntimeContext"

function AutomationOverlay({ onClose }: BoringFrontAppLeftOverlayProps) {
  return <div data-boring-workspace-part="automation-overlay" className="h-full min-h-0"><AutomationPanel {...({ onClose } as PaneProps & { onClose: () => void })} /></div>
}

export const boringAutomationPlugin: BoringFrontFactoryWithId = definePlugin({
  id: BORING_AUTOMATION_PLUGIN_ID,
  label: BORING_AUTOMATION_PLUGIN_LABEL,
  providers: [
    {
      id: `${BORING_AUTOMATION_PLUGIN_ID}.runtime`,
      component: AutomationRuntimeProvider,
    },
  ],
  appLeftActions: [
    {
      id: "automations",
      label: BORING_AUTOMATION_PLUGIN_LABEL,
      icon: CalendarClock,
      overlay: AutomationOverlay,
      order: 45,
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
