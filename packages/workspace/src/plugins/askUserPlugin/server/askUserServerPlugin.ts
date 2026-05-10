import type { FastifyPluginAsync } from "fastify"
import { defineServerPlugin, type WorkspaceServerPlugin } from "../../../server/plugins/bootstrapServer"
import { ASK_USER_PLUGIN_ID } from "../shared/constants"
import type { AskUserRuntime } from "./AskUserRuntime"
import type { AskUserStore } from "./AskUserStore"
import { createAskUserPiExtensionFactory } from "./createAskUserPiExtensionFactory"
import { questionsRoutes, type QuestionsRoutesOptions } from "./questionsRoutes"

export type AskUserServerPluginOptions = {
  runtime: AskUserRuntime
  store: AskUserStore
  sessionId: string | (() => string)
  routes?: Omit<QuestionsRoutesOptions, "runtime" | "store">
}

export function createAskUserServerPlugin(options: AskUserServerPluginOptions): WorkspaceServerPlugin {
  const routes: FastifyPluginAsync = async (app) => {
    await app.register(questionsRoutes, { ...options.routes, runtime: options.runtime, store: options.store })
  }
  return defineServerPlugin({
    id: ASK_USER_PLUGIN_ID,
    label: "Questions",
    routes,
    extensionFactories: [createAskUserPiExtensionFactory({ runtime: options.runtime, sessionId: options.sessionId })],
  })
}
