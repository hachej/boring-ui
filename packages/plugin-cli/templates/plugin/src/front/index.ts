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
 * `definePlugin(config)` takes a single declarative config object.
 * For imperative composition (calling an external factory), use the
 * `setup: (api) => void` escape hatch — see SKILL.md.
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
      placement: "workspace-page",
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
