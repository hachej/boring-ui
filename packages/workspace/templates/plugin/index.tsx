import { definePlugin } from "@boring/workspace"
import { SAMPLE_PLUGIN_ID } from "./constants"
import { samplePanel } from "./panels"
import { sampleSurfaceResolver } from "./surfaceResolver"

export function createSamplePlugin() {
  return definePlugin({
    id: SAMPLE_PLUGIN_ID,
    label: "Sample",
    outputs: [
      { type: "panel", panel: samplePanel },
      { type: "surface-resolver", resolver: sampleSurfaceResolver },
    ],
  })
}

