import { join } from "node:path"
import type { FastifyPluginAsync } from "fastify"
import { defineServerPlugin, type WorkspaceBridge, type WorkspaceServerPlugin } from "@hachej/boring-workspace/server"
import { ASK_USER_PLUGIN_ID, ASK_USER_UI_STATE_SLOTS } from "../shared/constants"
import { AskUserRuntime } from "./askUserRuntime"
import { FileAskUserStore, type AskUserStore } from "./askUserStore"
import { AskUserStatePublisher } from "./askUserStatePublisher"
import { createAskUserTool } from "./createAskUserTool"
import { questionsRoutes, type QuestionsRoutesOptions } from "./questionsRoutes"

export type AskUserServerPluginOptions = {
  workspaceRoot?: string
  bridge?: WorkspaceBridge
  runtime?: AskUserRuntime
  store?: AskUserStore
  sessionId?: string | (() => string)
  routes?: Omit<QuestionsRoutesOptions, "runtime" | "store">
  onClose?: () => void
}

export function createAskUserServerPlugin(options: AskUserServerPluginOptions): WorkspaceServerPlugin {
  const store = options.store ?? createDefaultStore(options.workspaceRoot)
  const runtime = options.runtime ?? new AskUserRuntime({ store, uiBridge: options.bridge })
  const stopPublisher = options.bridge ? new AskUserStatePublisher(store, options.bridge).start() : undefined
  const routes: FastifyPluginAsync = async (app) => {
    app.addHook("onClose", async () => {
      stopPublisher?.()
      options.onClose?.()
    })
    await app.register(questionsRoutes, { ...defaultRoutes, ...options.routes, runtime, store })
  }
  const askUserTool = createAskUserTool({ runtime, sessionId: options.sessionId ?? (() => "default") })
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

const defaultRoutes: Omit<QuestionsRoutesOptions, "runtime" | "store"> = {
  // No-auth playground/default shells still need the browser command channel to
  // bind to the question's owning session. The answerToken remains the terminal
  // mutation secret; this context only prevents the default anonymous session
  // sentinel from rejecting legitimate no-auth submits as SESSION_MISMATCH.
  getAuthContext: (request) => {
    const body = request.body as { params?: { sessionId?: unknown } } | undefined
    return {
      sessionId: typeof body?.params?.sessionId === "string" ? body.params.sessionId : "anonymous",
      principalId: "anonymous",
    }
  },
}

function createDefaultStore(workspaceRoot: string | undefined): AskUserStore {
  if (!workspaceRoot) throw new Error("createAskUserServerPlugin requires workspaceRoot when store is not provided")
  return new FileAskUserStore(join(workspaceRoot, ".boring", "ask-user.json"))
}
