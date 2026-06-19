import type { BoringFrontSurfaceResolverRegistration } from "@hachej/boring-workspace/plugin"
import { BORING_FEEDBACK_PANEL_ID, BORING_FEEDBACK_SURFACE_KIND } from "../shared/constants"

export const boringFeedbackSurfaceResolver: BoringFrontSurfaceResolverRegistration = {
  id: "boring-feedback",
  kind: BORING_FEEDBACK_SURFACE_KIND,
  source: "app",
  resolve(request) {
    if (request.kind !== BORING_FEEDBACK_SURFACE_KIND) return undefined
    return {
      id: `boring-feedback:${request.target}`,
      component: BORING_FEEDBACK_PANEL_ID,
      title: request.target,
      params: { report: request.target, source: request.kind },
      score: 0,
    }
  },
}
