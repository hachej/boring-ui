import type { SurfaceResolverConfig } from "@boring/workspace"
import { SAMPLE_SURFACE_KIND } from "../shared/constants"

export const sampleSurfaceResolver: SurfaceResolverConfig = {
  id: "sample",
  source: "app",
  resolve(request) {
    if (request.kind !== SAMPLE_SURFACE_KIND) return undefined
    return {
      id: `sample:${request.target}`,
      component: "sample-panel",
      title: request.target,
      params: { id: request.target },
      score: 0,
    }
  },
}

