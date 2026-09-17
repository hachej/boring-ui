import type { BoringFrontSurfaceResolverRegistration } from "@hachej/boring-workspace/plugin"
import { APP_RUNNER_PANEL_ID, APP_RUNNER_SURFACE_KIND } from "../shared/constants"

/**
 * Lets an agent call `exec_ui({ kind: 'openSurface', params: { kind:
 * 'app-runner', target: '<appName>' } })` after publishing an app, opening
 * the Apps panel focused on that app.
 */
export const appRunnerSurfaceResolver: BoringFrontSurfaceResolverRegistration = {
  id: "app-runner.open-app",
  kind: APP_RUNNER_SURFACE_KIND,
  title: "Open published app",
  description: "Open the Apps panel focused on a published workspace app.",
  targetHint: "<appName>",
  source: "app",
  resolve(request) {
    if (request.kind !== APP_RUNNER_SURFACE_KIND) return null
    const appName = request.target
    if (!appName) return null
    return {
      component: APP_RUNNER_PANEL_ID,
      title: `App: ${appName}`,
      params: { appName },
      score: 100,
    }
  },
}
