import type { WorkspaceServerPlugin } from "@hachej/boring-workspace/server"
import {
  createAskUserServerPlugin,
  type AskUserServerPluginOptions,
} from "./askUserServerPlugin"
import { createWorkspaceAgentAnswerDeliveryTransport } from "./askUserAnswerDelivery"
export * from "./askUserStore"
export * from "./askUserRuntime"
export * from "./questionsBridge"
export * from "./questionsRoutes"
export * from "./askUserBridgeHandlers"
export * from "./createAskUserTool"
export * from "./askUserServerPlugin"
export * from "./askUserStatePublisher"
export * from "./askUserAnswerDelivery"
export { ASK_USER_PLUGIN_ID } from "../shared"

/**
 * Default export — adapter for the standard `defaultPluginPackages`
 * load process. The workspace's `pluginEntryResolver` calls a
 * dir-source plugin's default-exported factory with `(options, ctx)`
 * where `ctx = { workspaceRoot, bridge }`. This adapter forwards
 * runtime context into `createAskUserServerPlugin`, which is the
 * existing rich factory consumers use directly when wiring by hand.
 */
export default function defaultAskUserServerPlugin(
  options: Partial<AskUserServerPluginOptions> | undefined,
  ctx: {
    workspaceRoot: string
    bridge: AskUserServerPluginOptions["bridge"]
    agentTypeId?: string
    trusted?: { workspaceAgentDispatcherResolver: import("@hachej/boring-agent/server").WorkspaceAgentDispatcherResolver }
  },
): WorkspaceServerPlugin {
  return createAskUserServerPlugin({
    ...(options ?? {}),
    workspaceRoot: options?.workspaceRoot ?? ctx.workspaceRoot,
    bridge: options?.bridge ?? ctx.bridge,
    agentTypeId: options?.agentTypeId ?? ctx.agentTypeId,
    answerDeliveryTransport: options?.answerDeliveryTransport
      ?? (ctx.trusted ? createWorkspaceAgentAnswerDeliveryTransport(ctx.trusted.workspaceAgentDispatcherResolver) : undefined),
  })
}
