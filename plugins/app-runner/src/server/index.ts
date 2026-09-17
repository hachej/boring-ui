import type { WorkspaceServerPlugin } from "@hachej/boring-workspace/server"
import {
  createAppRunnerServerPlugin,
  type AppRunnerServerPluginOptions,
} from "./appRunnerServerPlugin"

export * from "./appRunnerClient"
export * from "./appRunnerStore"
export * from "./collectAppFiles"
export * from "./createAppRunnerTools"
export * from "./appRunnerServerPlugin"
export { APP_RUNNER_PLUGIN_ID } from "../shared/constants"

/**
 * Default export — adapter for the standard `defaultPluginPackages` load
 * process. The workspace's dir-source plugin resolver calls this with
 * `(options, ctx)` where `ctx = { workspaceRoot, bridge }` (see
 * `plugins/ask-user/src/server/index.ts` for the reference pattern).
 */
export default function defaultAppRunnerServerPlugin(
  options: Partial<AppRunnerServerPluginOptions> | undefined,
  ctx: { workspaceRoot: string },
): WorkspaceServerPlugin {
  return createAppRunnerServerPlugin({
    ...(options ?? {}),
    workspaceRoot: options?.workspaceRoot ?? ctx.workspaceRoot,
  })
}
