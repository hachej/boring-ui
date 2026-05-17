import { definePlugin, type BoringFrontFactoryWithId } from "@hachej/boring-workspace/plugin"
import { SAMPLE_PLUGIN_ID } from "../shared/constants"
import { SAMPLE_PANEL_ID, SamplePanel } from "./panels"
import { sampleSurfaceResolver } from "./surfaceResolver"

/**
 * Default-exported `BoringFrontFactoryWithId`. The workspace shell
 * accepts this directly in `WorkspaceProvider.plugins`; on bootstrap,
 * it calls the factory once with `api` and you register panels, panel
 * commands, left tabs, surface resolvers, catalogs, bindings, and
 * providers imperatively.
 *
 * `definePlugin(id, factory, { label? })` attaches the id/label as
 * static fields on the factory so the workspace can identify it.
 *
 * Plugins in `.pi/extensions/<name>/` also get hot-reloaded — the
 * workspace dynamically re-imports this module and re-runs the
 * factory.
 *
 * See `@hachej/boring-workspace/plugin#BoringFrontAPI` for every
 * available `api.registerXxx(...)` method.
 */
const samplePlugin: BoringFrontFactoryWithId = definePlugin(
  SAMPLE_PLUGIN_ID,
  (api) => {
    api.registerPanel({
      id: SAMPLE_PANEL_ID,
      label: "Sample",
      component: SamplePanel,
      placement: "center",
      source: "app",
    })
    api.registerPanelCommand({
      id: "sample.open",
      title: "Open Sample",
      panelId: SAMPLE_PANEL_ID,
    })
    api.registerSurfaceResolver(sampleSurfaceResolver)
  },
  { label: "Sample" },
)

export default samplePlugin

export { SamplePanel, SAMPLE_PANEL_ID } from "./panels"
export { sampleSurfaceResolver } from "./surfaceResolver"
