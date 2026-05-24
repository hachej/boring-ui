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

export function createAskUserServerPlugin(_options: AskUserServerPluginOptions): WorkspaceServerPlugin {
  throw new Error(
    "@hachej/boring-ask-user/server has been removed. " +
      "Use @hachej/boring-ask-user/front with the bridge-backed @hachej/boring-ask-user/agent Pi extension; " +
      "answers now flow through human-input.v1.* WorkspaceBridge operations.",
  )
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
