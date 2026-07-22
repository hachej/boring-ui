"use client"

import { definePlugin, type BoringFrontAppLeftOverlayProps, type BoringFrontFactoryWithId } from "@hachej/boring-workspace/plugin"
import { CalendarClock, FileText } from "lucide-react"
import { BORING_AUTOMATION_PLUGIN_ID, BORING_AUTOMATION_PLUGIN_LABEL } from "../shared"
import { AutomationPanel } from "./AutomationPanel"
import { AutomationPromptPanel } from "./AutomationPromptPanel"
import { AutomationRuntimeProvider } from "./AutomationRuntimeContext"
import { AUTOMATION_PROMPT_PANEL_ID } from "./constants"

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
    {
      id: AUTOMATION_PROMPT_PANEL_ID,
      label: "Automation prompt",
      icon: FileText,
      component: AutomationPromptPanel,
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
export { AUTOMATION_PROMPT_PANEL_ID } from "./constants"
