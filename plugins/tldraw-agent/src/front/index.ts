import { definePlugin, type BoringFrontFactoryWithId } from "@hachej/boring-workspace/plugin"
import { TLDRAW_AGENT_PLUGIN_ID } from "../shared/constants"
import { TLDRAW_AGENT_PANEL_ID, TldrawAgentPanel } from "./panels"
import { tldrawAgentSurfaceResolver } from "./surfaceResolver"

const tldrawAgentPlugin: BoringFrontFactoryWithId = definePlugin({
  id: TLDRAW_AGENT_PLUGIN_ID,
  label: "tldraw Canvas",
  panels: [
    {
      id: TLDRAW_AGENT_PANEL_ID,
      label: "tldraw Canvas",
      component: TldrawAgentPanel,
      placement: "shared-dockview",
      source: "app",
      supportsFullPage: true,
    },
  ],
  commands: [
    {
      id: "tldraw-agent.open",
      title: "Open tldraw Canvas",
      panelId: TLDRAW_AGENT_PANEL_ID,
    },
  ],
  surfaceResolvers: [tldrawAgentSurfaceResolver],
})

export default tldrawAgentPlugin
export { tldrawAgentPlugin }

export { TldrawAgentPanel, TLDRAW_AGENT_PANEL_ID } from "./panels"
export { tldrawAgentSurfaceResolver } from "./surfaceResolver"
