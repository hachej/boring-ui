"use client"

import { definePlugin, type BoringFrontFactoryWithId } from "@hachej/boring-workspace/plugin"
import { CalendarClock } from "lucide-react"
import { BORING_AUTOMATION_PLUGIN_ID, BORING_AUTOMATION_PLUGIN_LABEL } from "../shared"

function AutomationPanel() {
  return (
    <div className="flex h-full min-h-0 flex-col bg-background p-4 text-sm text-foreground">
      <div className="flex items-center gap-2 font-medium">
        <CalendarClock className="h-4 w-4 text-muted-foreground" />
        {BORING_AUTOMATION_PLUGIN_LABEL}
      </div>
      <p className="mt-2 max-w-prose text-sm text-muted-foreground">
        Automation UI is implemented in the next slice. Slice 1 provides the trusted plugin shell, file-backed store, and CRUD routes.
      </p>
    </div>
  )
}

export const boringAutomationPlugin: BoringFrontFactoryWithId = definePlugin({
  id: BORING_AUTOMATION_PLUGIN_ID,
  label: BORING_AUTOMATION_PLUGIN_LABEL,
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
