import { join } from "node:path"
import type { FastifyPluginAsync } from "fastify"
import { defineServerPlugin, type UiBridge, type WorkspaceServerPlugin } from "@hachej/boring-workspace/server"
import { HANDOVER_OPERATION_DETAIL_KINDS } from "@hachej/boring-workspace/shared"
import { getWorkspaceUiBridge } from "@hachej/boring-workspace/plugin"
import { ASK_USER_PLUGIN_ID, ASK_USER_UI_STATE_SLOTS } from "../shared/constants"
import { AskUserRuntime } from "./askUserRuntime"
import { FileAskUserStore, type AskUserStore } from "./askUserStore"
import { AskUserStatePublisher } from "./askUserStatePublisher"
import { createAskUserTool } from "./createAskUserTool"
import { createManageHandoverTool } from "./createManageHandoverTool"
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
  ensurePublisher()
  const lifecycle: FastifyPluginAsync = async (app) => {
    ensurePublisher()
    app.addHook("onClose", async () => {
      stopPublisher?.()
      options.onClose?.()
    })
  }
  const askUserTool = createAskUserTool({ runtime, sessionId: options.sessionId ?? (() => "default") })
  const manageHandoverTool = createManageHandoverTool()
  return defineServerPlugin({
    id: ASK_USER_PLUGIN_ID,
    label: "Questions",
    systemPrompt: [
      "Use `ask_user` only when blocked on a human decision; it creates a blocking Human Intention in Chat and Inbox.",
      "Use non-blocking `manage_handover` to curate intentional human-facing deliverables produced during normal work.",
      "Register plans, reports, screenshots, demos, generated documents, and other reviewable outputs by stable ID; upsert updates and remove stale registrations as work evolves.",
      "Do not register routine source edits, lockfiles, caches, logs, or inferred files unless the user explicitly requested them as outputs. Never infer artifacts from prose, git state, branches, titles, prompts, diffs, or filesystem changes.",
      "Keep the curated set concise (normally under ten). Artifact-producing successful runs must register their outputs; runs without human-facing deliverables do not call manage_handover.",
      "Final prose summarizes the outcome and does not repeat the registered artifact list.",
    ].join("\n"),
    agentTools: [{
      name: askUserTool.name,
      description: askUserTool.description,
      promptSnippet: askUserTool.promptSnippet,
      executionMode: askUserTool.executionMode,
      currentRunDetailKinds: HANDOVER_OPERATION_DETAIL_KINDS,
      parameters: askUserTool.parameters,
      execute(params, ctx) {
        ensurePublisher()
        return askUserTool.execute(ctx.toolCallId, params, ctx.abortSignal, ctx.sessionId, ctx.currentRunStructuredDetails, ctx.userId)
      },
    }, {
      name: manageHandoverTool.name,
      description: manageHandoverTool.description,
      promptSnippet: manageHandoverTool.promptSnippet,
      executionMode: manageHandoverTool.executionMode,
      currentRunDetailKinds: HANDOVER_OPERATION_DETAIL_KINDS,
      parameters: manageHandoverTool.parameters,
      execute(params, ctx) { return manageHandoverTool.execute(params, ctx.currentRunStructuredDetails) },
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
