import type { FastifyPluginAsync } from "fastify"
import { defineServerPlugin, type WorkspaceServerPlugin } from "../../../server/plugins/bootstrapServer"
import { ASK_USER_PLUGIN_ID, ASK_USER_UI_STATE_SLOTS } from "../shared/constants"
import type { AskUserRuntime } from "./AskUserRuntime"
import type { AskUserStore } from "./AskUserStore"
import { createAskUserTool } from "./createAskUserTool"
import { questionsRoutes, type QuestionsRoutesOptions } from "./questionsRoutes"

export type AskUserServerPluginOptions = {
  runtime: AskUserRuntime
  store: AskUserStore
  sessionId: string | (() => string)
  routes?: Omit<QuestionsRoutesOptions, "runtime" | "store">
  onClose?: () => void
}

export function createAskUserServerPlugin(options: AskUserServerPluginOptions): WorkspaceServerPlugin {
  const routes: FastifyPluginAsync = async (app) => {
    if (options.onClose) app.addHook("onClose", async () => options.onClose?.())
    await app.register(questionsRoutes, { ...options.routes, runtime: options.runtime, store: options.store })
  }
  const askUserTool = createAskUserTool({ runtime: options.runtime, sessionId: options.sessionId })
  return defineServerPlugin({
    id: ASK_USER_PLUGIN_ID,
    label: "Questions",
    systemPrompt: "When you need a blocking decision from the user, call the `ask_user` tool. Do not roleplay or simulate the form in chat; the active form appears in the Workspace Questions pane.",
    agentTools: [{
      name: askUserTool.name,
      description: askUserTool.description,
      promptSnippet: askUserTool.promptSnippet,
      parameters: askUserTool.parameters,
      execute(params, ctx) { return askUserTool.execute(ctx.toolCallId, params, ctx.abortSignal, ctx.sessionId) },
    }],
    routes,
    preservedUiStateKeys: [ASK_USER_UI_STATE_SLOTS.PENDING],
  })
}
