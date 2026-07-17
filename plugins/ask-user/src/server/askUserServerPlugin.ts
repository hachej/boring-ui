import { join } from "node:path"
import type { FastifyPluginAsync } from "fastify"
import { defineServerPlugin, type UiBridge, type WorkspaceServerPlugin } from "@hachej/boring-workspace/server"
import { ASK_USER_PLUGIN_ID, ASK_USER_UI_STATE_SLOTS } from "../shared/constants"
import { AskUserRuntime } from "./askUserRuntime"
import { FileAskUserStore, type AskUserStore } from "./askUserStore"
import { AskUserStatePublisher } from "./askUserStatePublisher"
import { createAskUserTool } from "./createAskUserTool"
import { createAskUserBridgeHandlers } from "./askUserBridgeHandlers"

export type AskUserServerPluginOptions = {
  workspaceRoot?: string
  bridge?: UiBridge
  runtime?: AskUserRuntime
  store?: AskUserStore
  sessionId?: string | (() => string)
  onClose?: () => void
}

export function createAskUserServerPlugin(options: AskUserServerPluginOptions): WorkspaceServerPlugin {
  if ((options as { routes?: unknown }).routes) {
    throw new Error("createAskUserServerPlugin no longer registers /api/v1/questions/commands; use WorkspaceBridge ask-user.v1.* handlers or import questionsRoutes for manual legacy wiring")
  }
  const store = options.store ?? createDefaultStore(options.workspaceRoot)
  const runtime = options.runtime ?? new AskUserRuntime({ store })
  const stopPublisher = options.bridge ? new AskUserStatePublisher(store, options.bridge).start() : undefined
  const lifecycle: FastifyPluginAsync = async (app) => {
    app.addHook("onClose", async () => {
      stopPublisher?.()
      options.onClose?.()
    })
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
    workspaceBridgeHandlers: createAskUserBridgeHandlers({ runtime, store }),
    routes: lifecycle,
    preservedUiStateKeys: [ASK_USER_UI_STATE_SLOTS.PENDING],
  })
}

function createDefaultStore(workspaceRoot: string | undefined): AskUserStore {
  if (!workspaceRoot) throw new Error("createAskUserServerPlugin requires workspaceRoot when store is not provided")
  return new FileAskUserStore(join(workspaceRoot, ".boring", "ask-user.json"))
}
