import type { BoringFrontFactory } from "@hachej/boring-workspace/plugin"
import { SAMPLE_PANEL_ID, SamplePanel } from "./panels"
import { sampleSurfaceResolver } from "./surfaceResolver"

/**
 * Default-exported `BoringFrontFactory`. The workspace shell calls this
 * once with `api`; you register panels, panel commands, left tabs,
 * surface resolvers, catalogs, bindings, and providers imperatively.
 *
 * Plugins in `.pi/extensions/<name>/` get hot-reloaded — the workspace
 * dynamically re-imports this module and re-runs the factory.
 *
 * See `@hachej/boring-workspace/plugin#BoringFrontAPI` for every
 * available `api.registerXxx(...)` method.
 */
const samplePlugin: BoringFrontFactory = (api) => {
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
}

export default samplePlugin

export { SamplePanel, SAMPLE_PANEL_ID } from "./panels"
export { sampleSurfaceResolver } from "./surfaceResolver"
