import { TASK_ERROR_CODES } from "../shared"
import type { ToolExecContext } from "@hachej/boring-workspace"
import type { WorkspaceAgentServerPluginContext } from "@hachej/boring-workspace/app/server"
import { FileTaskSessionLinkStore, type TaskSessionLinkStore, type TaskSessionLinkWorkspace } from "./taskSessionLinkStore"

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
  workspace: TaskSessionLinkWorkspace & { readonly root: string }
  linkStore: TaskSessionLinkStore
  authorizeSession(sessionId: string): Promise<void>
}

export interface TrustedTaskToolBindingResolver {
  resolve(ctx: ToolExecContext): Promise<TrustedTaskToolBinding>
}

/**
 * Resolves a tool call from server-injected run context. Tool parameters never
 * participate in actor or workspace selection.
 */
export function createTrustedTaskToolBindingResolver(
  trusted: TaskSessionLinkTrustedContext | undefined,
): TrustedTaskToolBindingResolver {
  const stores = new Map<string, FileTaskSessionLinkStore>()

  return {
    async resolve(ctx) {
      const workspaceId = ctx.workspaceId?.trim()
      const userId = ctx.userId?.trim()
      if (!workspaceId || !userId) {
        throw new TaskToolBindingError(
          TASK_ERROR_CODES.TOOL_CONTEXT_UNAVAILABLE,
          "Authenticated task tool context is unavailable.",
        )
      }

      const resolver = trusted?.workspaceAgentDispatcherResolver
      const actorVerifier = trusted?.actorVerifier
      if (!resolver?.resolveWithWorkspace) {
        throw new TaskToolBindingError(
          TASK_ERROR_CODES.TOOL_CONTEXT_UNAVAILABLE,
          "Trusted task tool workspace resolution is unavailable.",
        )
      }

      const actor = { workspaceId, userId }
      try {
        if (actorVerifier && !await actorVerifier(actor)) {
          throw new Error("actor verification failed")
        }
        const binding = await resolver.resolveWithWorkspace(actor)
        const workspace = binding.workspace as TaskSessionLinkWorkspace & { readonly root: string }
        let linkStore = stores.get(actor.workspaceId)
        if (!linkStore) {
          linkStore = new FileTaskSessionLinkStore(workspace)
          stores.set(actor.workspaceId, linkStore)
        }
        return {
          actor,
          workspace,
          linkStore,
          authorizeSession: async (sessionId: string) => {
            if (!resolver.authorizeSession) {
              throw new TaskToolBindingError(
                TASK_ERROR_CODES.TOOL_CONTEXT_UNAVAILABLE,
                "Trusted task session authorization is unavailable.",
              )
            }
            try {
              await resolver.authorizeSession(actor, sessionId)
            } catch {
              throw new TaskToolBindingError(
                TASK_ERROR_CODES.TOOL_FORBIDDEN,
                "Task session access is forbidden.",
              )
            }
          },
        }
      } catch (cause) {
        if (cause instanceof TaskToolBindingError) throw cause
        throw new TaskToolBindingError(TASK_ERROR_CODES.TOOL_FORBIDDEN, "Task tool access is forbidden.")
      }
    },
  }
}
