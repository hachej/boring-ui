import type { WorkspaceServerPlugin } from "@hachej/boring-workspace/server"
import {
  createObjectivesServerPlugin,
  type ObjectivesServerPluginOptions,
} from "./objectivesServerPlugin"
export * from "./objectiveStore"
export * from "./objectiveBridgeHandlers"
export * from "./objectiveTools"
export * from "./objectivesServerPlugin"
export { OBJECTIVES_PLUGIN_ID } from "../shared"

/**
 * Default export — adapter for the standard `defaultPluginPackages` load
 * process. The workspace's `pluginEntryResolver` calls a dir-source
 * plugin's default-exported factory with `(options, ctx)` where
 * `ctx = { workspaceRoot }`.
 */
export default function defaultObjectivesServerPlugin(
  options: Partial<ObjectivesServerPluginOptions> | undefined,
  ctx: { workspaceRoot: string },
): WorkspaceServerPlugin {
  return createObjectivesServerPlugin({
    ...(options ?? {}),
    workspaceRoot: options?.workspaceRoot ?? ctx.workspaceRoot,
  })
}
