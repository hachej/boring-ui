import { join } from "node:path"
import type { FastifyPluginAsync } from "fastify"
import { defineServerPlugin, type UiBridge, type WorkspaceServerPlugin } from "@hachej/boring-workspace/server"
import { getWorkspaceUiBridge } from "@hachej/boring-workspace/plugin"
import { ASK_USER_PLUGIN_ID, ASK_USER_UI_STATE_SLOTS } from "../shared/constants"
import { AskUserRuntime } from "./askUserRuntime"
import { FileAskUserStore, type AskUserStore } from "./askUserStore"
import { AskUserStatePublisher } from "./askUserStatePublisher"
import { createAskUserTool } from "./createAskUserTool"
import { createAskUserBridgeHandlers } from "./askUserBridgeHandlers"
import { registerQuestionsReadRoutes } from "./questionsRoutes"

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
  if (options.store && options.runtime && options.store !== options.runtime.store) {
    throw new Error("createAskUserServerPlugin requires runtime and bridge handlers to share one AskUserStore")
  }
  const store = options.store ?? options.runtime?.store ?? createDefaultStore(options.workspaceRoot)
  const runtime = options.runtime ?? new AskUserRuntime({ store })
  let stopPublisher: (() => void) | undefined
  const ensurePublisher = () => {
    if (stopPublisher) return
    const bridge = options.bridge ?? getWorkspaceUiBridge()
    if (bridge) stopPublisher = new AskUserStatePublisher(store, bridge).start()
  }
  const lifecycle: FastifyPluginAsync = async (app) => {
    registerQuestionsReadRoutes(app, { store })
    const pending = await store.listPending()
    await runtime.abandonOrphanedPending(pending.map((question) => question.sessionId))
    ensurePublisher()
    app.addHook("onClose", async () => {
      stopPublisher?.()
      options.onClose?.()
    })
  }
  const askUserTool = createAskUserTool({ runtime, sessionId: options.sessionId ?? (() => "default") })
  return defineServerPlugin({
    id: ASK_USER_PLUGIN_ID,
    label: "Questions",
    systemPrompt: [
      "Use `ask_user` only when blocked on a human decision; it creates a blocking Human Intention in Chat and Inbox.",
      "When asking for review or approval, include explicitly known human-facing deliverables in the plural artifacts array.",
      "Do not register routine source edits, lockfiles, caches, logs, or inferred files unless the user explicitly requested them as outputs. Never infer artifacts from prose, git state, branches, titles, prompts, diffs, or filesystem changes.",
    ].join("\n"),
    agentTools: [{
      name: askUserTool.name,
      description: askUserTool.description,
      promptSnippet: askUserTool.promptSnippet,
      parameters: askUserTool.parameters,
      execute(params, ctx) {
        ensurePublisher()
        return askUserTool.execute(ctx.toolCallId, params, ctx.abortSignal, ctx.sessionId, undefined)
      },
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
