"use client"

import { definePlugin, type BoringFrontAppLeftOverlayProps, type BoringFrontFactoryWithId } from "@hachej/boring-workspace/plugin"
import { CalendarClock } from "lucide-react"
import { BORING_AUTOMATION_PLUGIN_ID, BORING_AUTOMATION_PLUGIN_LABEL } from "../shared"
import { AutomationCountBadge } from "./AutomationCountBadge"
import { AutomationPanel } from "./AutomationPanel"
import { AutomationRuntimeProvider } from "./AutomationRuntimeContext"

function AutomationOverlay({ onClose }: BoringFrontAppLeftOverlayProps) {
  return <div data-boring-workspace-part="automation-overlay" className="h-full min-h-0"><AutomationPanel onClose={onClose} /></div>
}

function AutomationCenterPanel() {
  return <AutomationPanel />
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
      trailing: AutomationCountBadge,
      overlay: AutomationOverlay,
      order: 45,
    },
  ],
  panels: [
    {
      id: `${BORING_AUTOMATION_PLUGIN_ID}.panel`,
      label: BORING_AUTOMATION_PLUGIN_LABEL,
      icon: CalendarClock,
      component: AutomationCenterPanel,
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
