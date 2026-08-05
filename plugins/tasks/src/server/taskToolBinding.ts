import { TASK_ERROR_CODES } from "../shared"
import type { ToolExecContext } from "@hachej/boring-workspace"
import type { WorkspaceAgentServerPluginContext } from "@hachej/boring-workspace/app/server"
import { taskSessionLinkStoreForWorkspace, type TaskSessionLinkStore, type TaskSessionLinkWorkspace } from "./taskSessionLinkStore"
import { taskSessionLinkStoreWithEvents, type TaskSessionLinkEvents } from "./taskSessionLinkEvents"

type TaskSessionLinkTrustedContext = NonNullable<WorkspaceAgentServerPluginContext["trusted"]>

export type TaskToolBindingErrorCode = typeof TASK_ERROR_CODES.TOOL_CONTEXT_UNAVAILABLE | typeof TASK_ERROR_CODES.TOOL_FORBIDDEN

export class TaskToolBindingError extends Error {
  constructor(readonly code: TaskToolBindingErrorCode, message: string) {
    super(message)
    this.name = "TaskToolBindingError"
  }
}

export interface TrustedTaskToolBinding {
  actor: { workspaceId: string; userId: string }
  agentTypeId: string
  workspace: TaskSessionLinkWorkspace
  linkStore: TaskSessionLinkStore
  authorizeSession(sessionId: string): Promise<void>
}

export interface TrustedTaskToolBindingResolver {
  run<T>(ctx: ToolExecContext, operation: (binding: TrustedTaskToolBinding) => Promise<T>): Promise<T>
}

/** Executes each tool call inside the Host-owned workspace/Agent lease. */
export function createTrustedTaskToolBindingResolver(
  trusted: TaskSessionLinkTrustedContext | undefined,
  agentTypeId: string,
  events?: TaskSessionLinkEvents,
): TrustedTaskToolBindingResolver {
  return {
    async run<T>(ctx: ToolExecContext, operation: (binding: TrustedTaskToolBinding) => Promise<T>): Promise<T> {
      const workspaceId = ctx.workspaceId?.trim()
      const userId = ctx.userId?.trim()
      if (!workspaceId || !userId) {
        throw new TaskToolBindingError(TASK_ERROR_CODES.TOOL_CONTEXT_UNAVAILABLE, "Authenticated task tool context is unavailable.")
      }
      const resolver = trusted?.workspaceAgentDispatcherResolver
      if (!resolver?.runWithWorkspaceAgent) {
        throw new TaskToolBindingError(TASK_ERROR_CODES.TOOL_CONTEXT_UNAVAILABLE, "Trusted task tool workspace resolution is unavailable.")
      }
      const actor = { workspaceId, userId }
      try {
        if (trusted?.actorVerifier && !await trusted.actorVerifier(actor)) throw new Error("actor verification failed")
        let result: T | undefined
        await resolver.runWithWorkspaceAgent({
          agentTypeId,
          context: actor,
          requestId: ctx.requestId?.trim() || ctx.toolCallId,
        }, async (lease) => {
          const workspace: TaskSessionLinkWorkspace = lease.workspace
          result = await operation({
            actor,
            agentTypeId,
            workspace,
            linkStore: events
              ? taskSessionLinkStoreWithEvents(taskSessionLinkStoreForWorkspace(workspace), actor.workspaceId, events)
              : taskSessionLinkStoreForWorkspace(workspace),
            authorizeSession: async (sessionId) => {
              if (!resolver.authorizeSession) throw new TaskToolBindingError(TASK_ERROR_CODES.TOOL_CONTEXT_UNAVAILABLE, "Trusted task session authorization is unavailable.")
              try {
                await resolver.authorizeSession(actor, { agentTypeId, sessionId })
              } catch {
                throw new TaskToolBindingError(TASK_ERROR_CODES.TOOL_FORBIDDEN, "Task session access is forbidden.")
              }
            },
          })
        })
        return result as T
      } catch (cause) {
        if (cause instanceof TaskToolBindingError) throw cause
        throw new TaskToolBindingError(TASK_ERROR_CODES.TOOL_FORBIDDEN, "Task tool access is forbidden.")
      }
    },
  }
}
