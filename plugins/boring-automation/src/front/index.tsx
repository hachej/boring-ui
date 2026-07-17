"use client"

import { IconButton } from "@hachej/boring-ui-kit"
import { definePlugin, useAppLeftOverlayChrome, type BoringFrontAppLeftOverlayProps, type BoringFrontFactoryWithId } from "@hachej/boring-workspace/plugin"
import { CalendarClock, X } from "lucide-react"
import { BORING_AUTOMATION_PLUGIN_ID, BORING_AUTOMATION_PLUGIN_LABEL } from "../shared"
import { AutomationPanel } from "./AutomationPanel"
import { AutomationRuntimeProvider } from "./AutomationRuntimeContext"

function AutomationOverlay({ onClose }: BoringFrontAppLeftOverlayProps) {
  const { headerInsetStart, headerInsetEnd } = useAppLeftOverlayChrome()
  return (
    <div data-boring-workspace-part="automation-overlay" className="flex h-full min-h-0 flex-col bg-background">
      <header className={[
        "flex h-12 shrink-0 items-center justify-between border-b border-border/60",
        headerInsetStart ? "pl-12" : "pl-4",
        headerInsetEnd ? "pr-16" : "pr-4",
      ].join(" ")}
      >
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <CalendarClock className="size-4 text-primary" />
          {BORING_AUTOMATION_PLUGIN_LABEL}
        </div>
        <IconButton type="button" variant="ghost" size="icon-xs" onClick={onClose} aria-label="Close automations" title="Close">
          <X className="size-3" strokeWidth={1.75} />
        </IconButton>
      </header>
      <div className="min-h-0 flex-1 overflow-auto">
        <AutomationPanel />
      </div>
    </div>
  )
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
