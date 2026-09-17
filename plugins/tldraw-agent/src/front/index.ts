import { definePlugin, type BoringFrontFactoryWithId } from "@hachej/boring-workspace/plugin"
import { TLDRAW_AGENT_PLUGIN_ID } from "../shared/constants"
import { TLDRAW_AGENT_PANEL_ID, TldrawAgentPanel } from "./panels"
import { tldrawAgentSurfaceResolver } from "./surfaceResolver"

/**
 * Default-exported `BoringFrontFactoryWithId`. The workspace shell
 * accepts this directly in `WorkspaceProvider.plugins`; on bootstrap,
 * it dispatches each declarative field to the corresponding
 * `api.register*` method.
 *
 * `definePlugin(config)` takes a single declarative config object.
 * For imperative composition (calling an external factory), use the
 * `setup: (api) => void` escape hatch — see SKILL.md.
 *
 * Plugins in `.pi/extensions/<name>/` also get hot-reloaded — the
 * workspace dynamically re-imports this module and re-runs the
 * factory.
 */
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
