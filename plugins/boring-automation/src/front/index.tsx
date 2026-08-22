"use client"

import { lazy, Suspense } from "react"
import { definePlugin, type BoringFrontAppLeftOverlayProps, type BoringFrontFactoryWithId } from "@hachej/boring-workspace/plugin"
import { CalendarClock } from "lucide-react"
import { BORING_AUTOMATION_PLUGIN_ID, BORING_AUTOMATION_PLUGIN_LABEL } from "../shared"
import { AutomationRuntimeProvider } from "./AutomationRuntimeContext"

const LazyAutomationPanel = lazy(async () => {
  const module = await import("./AutomationPanel")
  return { default: module.AutomationPanel }
})

function AutomationPanelFallback() {
  return <div className="grid h-full place-items-center text-sm text-muted-foreground">Loading Automations…</div>
}

function AutomationOverlay({ onClose }: BoringFrontAppLeftOverlayProps) {
  return (
    <div data-boring-workspace-part="automation-overlay" className="h-full min-h-0">
      <Suspense fallback={<AutomationPanelFallback />}><LazyAutomationPanel onClose={onClose} /></Suspense>
    </div>
  )
}

function AutomationCenterPanel() {
  return <Suspense fallback={<AutomationPanelFallback />}><LazyAutomationPanel /></Suspense>
}

export const boringAutomationPlugin: BoringFrontFactoryWithId = definePlugin({
  id: "boring-automation",
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
