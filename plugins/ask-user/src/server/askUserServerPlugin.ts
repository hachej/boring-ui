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
import {
  AskUserAnswerDelivery,
  createWorkspaceAgentAnswerDeliveryTransport,
  type AskUserAnswerDeliveryTransport,
} from "./askUserAnswerDelivery"

export type AskUserServerPluginOptions = {
  workspaceRoot?: string
  bridge?: UiBridge
  runtime?: AskUserRuntime
  store?: AskUserStore
  sessionId?: string | (() => string)
  agentTypeId?: string
  answerDeliveryTransport?: AskUserAnswerDeliveryTransport
  answerDeliveryRetryMs?: number
  onClose?: () => void
}

type AskUserAgentTool = NonNullable<WorkspaceServerPlugin["agentTools"]>[number]

export function createAskUserServerPlugin(options: AskUserServerPluginOptions): WorkspaceServerPlugin {
  if ((options as { routes?: unknown }).routes) {
    throw new Error("createAskUserServerPlugin no longer registers /api/v1/questions/commands; use WorkspaceBridge ask-user.v1.* handlers or import questionsRoutes for manual legacy wiring")
  }
  if (options.store && options.runtime && options.store !== options.runtime.store) {
    throw new Error("createAskUserServerPlugin requires runtime and bridge handlers to share one AskUserStore")
  }
  const store = options.store ?? options.runtime?.store ?? createDefaultStore(options.workspaceRoot)
  const runtime = options.runtime ?? new AskUserRuntime({ store })
  let stopPublisher: (() => Promise<void>) | undefined
  let stopDelivery: (() => Promise<void>) | undefined
  const ensurePublisher = () => {
    if (stopPublisher) return
    const bridge = options.bridge ?? getWorkspaceUiBridge()
    if (bridge) stopPublisher = new AskUserStatePublisher(store, bridge).start()
  }
  const lifecycle: FastifyPluginAsync = async (app) => {
    // Boot must not touch persisted questions. A `ready` question is a durable
    // decision request owned by the human, not a property of the asking session:
    // sweeping "orphans" here abandoned every pending gate on each hub restart
    // because the in-process waiter map is empty by construction at boot (#1348).
    ensurePublisher()
    if (!stopDelivery && options.answerDeliveryTransport) {
      stopDelivery = new AskUserAnswerDelivery(store, options.answerDeliveryTransport, options.answerDeliveryRetryMs).start()
    }
    app.addHook("onClose", async () => {
      await stopPublisher?.()
      await stopDelivery?.()
      options.onClose?.()
    })
  }
  const askUserTool = createAskUserTool({ runtime, sessionId: options.sessionId ?? (() => "default") })
  const agentTool = (agentTypeId: string): AskUserAgentTool => ({
    name: askUserTool.name,
    description: askUserTool.description,
    promptSnippet: askUserTool.promptSnippet,
    parameters: askUserTool.parameters,
    execute(params, ctx) {
      ensurePublisher()
      return askUserTool.execute(ctx.toolCallId, params, ctx.abortSignal, ctx.sessionId, ctx.userId, {
        agentTypeId,
        workspaceId: ctx.workspaceId,
        userId: ctx.userId,
      })
    },
  })
  return defineServerPlugin({
    id: ASK_USER_PLUGIN_ID,
    label: "Questions",
    systemPrompt: [
      "Use `ask_user` with blocking:false for decisions that should not stop the current turn; the answer arrives later as a follow-up message.",
      "Omit blocking (or use blocking:true) only when work cannot continue without the answer.",
      "When asking for review or approval, include explicitly known human-facing deliverables in the plural artifacts array.",
      "Do not register routine source edits, lockfiles, caches, logs, or inferred files unless the user explicitly requested them as outputs. Never infer artifacts from prose, git state, branches, titles, prompts, diffs, or filesystem changes.",
    ].join("\n"),
    agentToolFactory: ({ agentTypeId }) => [agentTool(agentTypeId)],
    workspaceBridgeHandlers: createAskUserBridgeHandlers({ runtime, store, agentTypeId: options.agentTypeId }),
    routes: lifecycle,
    preservedUiStateKeys: [ASK_USER_UI_STATE_SLOTS.PENDING],
  })
}

function createDefaultStore(workspaceRoot: string | undefined): AskUserStore {
  if (!workspaceRoot) throw new Error("createAskUserServerPlugin requires workspaceRoot when store is not provided")
  return new FileAskUserStore(join(workspaceRoot, ".boring", "ask-user.json"))
}
