import type { BoringFrontSurfaceResolverRegistration } from "@hachej/boring-workspace/plugin"
import { SAMPLE_SURFACE_KIND } from "../shared/constants"
import { SAMPLE_PANEL_ID } from "./panels"

export const sampleSurfaceResolver: BoringFrontSurfaceResolverRegistration = {
  id: "sample",
  kind: SAMPLE_SURFACE_KIND,
  source: "app",
  resolve(request) {
    if (request.kind !== SAMPLE_SURFACE_KIND) return undefined
    return {
      id: `sample:${request.target}`,
      component: SAMPLE_PANEL_ID,
      title: request.target,
      params: { id: request.target },
      score: 0,
    }
  },
}
