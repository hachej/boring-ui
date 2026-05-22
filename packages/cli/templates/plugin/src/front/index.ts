import { defineFrontPlugin } from "@hachej/boring-workspace"
import { SAMPLE_PLUGIN_ID } from "../shared/constants"
import { samplePanel } from "./panels"
import { sampleSurfaceResolver } from "./surfaceResolver"

export function createSamplePlugin() {
  return defineFrontPlugin({
    id: SAMPLE_PLUGIN_ID,
    label: "Sample",
    outputs: [
      { type: "panel", panel: samplePanel },
      { type: "surface-resolver", resolver: sampleSurfaceResolver },
    ],
  })
}

export { samplePanel } from "./panels"
export { sampleSurfaceResolver } from "./surfaceResolver"
export { SampleBinding } from "./bindings"
export { createSampleCatalog } from "./catalogs"
