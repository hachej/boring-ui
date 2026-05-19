import { definePlugin, type BoringFrontFactoryWithId } from "@hachej/boring-workspace/plugin"
import { SAMPLE_PLUGIN_ID } from "../shared/constants"
import { SAMPLE_PANEL_ID, SamplePanel } from "./panels"
import { sampleSurfaceResolver } from "./surfaceResolver"

/**
 * Default-exported `BoringFrontFactoryWithId`. The workspace shell
 * accepts this directly in `WorkspaceProvider.plugins`; on bootstrap,
 * it dispatches each declarative field to the corresponding
 * `api.register*` method.
 *
 * `definePlugin(config)` accepts a declarative config object. The
 * function form `definePlugin(id, (api) => void, { label? })` also
 * works for backwards compatibility but the declarative form is
 * preferred for new plugins.
 *
 * Plugins in `.pi/extensions/<name>/` also get hot-reloaded — the
 * workspace dynamically re-imports this module and re-runs the
 * factory.
 */
const samplePlugin: BoringFrontFactoryWithId = definePlugin({
  id: SAMPLE_PLUGIN_ID,
  label: "Sample",
  panels: [
    {
      id: SAMPLE_PANEL_ID,
      label: "Sample",
      component: SamplePanel,
      placement: "center",
      source: "app",
    },
  ],
  commands: [
    {
      id: "sample.open",
      title: "Open Sample",
      panelId: SAMPLE_PANEL_ID,
    },
  ],
  surfaceResolvers: [sampleSurfaceResolver],
})

export default samplePlugin

export { SamplePanel, SAMPLE_PANEL_ID } from "./panels"
export { sampleSurfaceResolver } from "./surfaceResolver"
