"use client"

import { Pane, PaneBody, PaneHeader, PaneTitle } from "@hachej/boring-ui-kit"
import type { PaneProps } from "@hachej/boring-workspace"
import { definePlugin, type BoringFrontFactoryWithId } from "@hachej/boring-workspace/plugin"
import { Sparkles } from "lucide-react"

export const DEMO_PANEL_ID = "demo.panel"
export const DEMO_PLUGIN_ID = "demo"

/** Center panel rendered by the demo plugin. */
function DemoPanel(_props: PaneProps) {
  return (
    <Pane>
      <PaneHeader>
        <PaneTitle>Demo</PaneTitle>
      </PaneHeader>
      <PaneBody>
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8, fontSize: 14 }}>
          <p>👋 This is the full-app demo plugin — a real plugin with a front panel and a backend provisioning contribution.</p>
          <p>
            A demo CLI <code>democli</code> is preinstalled in this workspace. Ask the agent to run{" "}
            <code>democli info</code> or <code>democli echo hello</code>.
          </p>
          <p>
            Python is provisioned via <code>uv</code>; the agent knows to use <code>uv pip install</code>.
          </p>
        </div>
      </PaneBody>
    </Pane>
  )
}

/** Front half of the demo plugin: a panel + a command-palette entry to open it. */
export const demoFrontPlugin: BoringFrontFactoryWithId = definePlugin({
  id: DEMO_PLUGIN_ID,
  label: "Demo",
  panels: [
    {
      id: DEMO_PANEL_ID,
      label: "Demo",
      icon: Sparkles,
      component: DemoPanel,
      placement: "center",
      source: "builtin",
    },
  ],
  commands: [
    {
      id: "demo.open",
      title: "Open Demo panel",
      panelId: DEMO_PANEL_ID,
      keywords: ["demo", "democli"],
    },
  ],
})
