import { randomUUID } from "node:crypto"
import type { WorkspaceAgentDispatcherResolver } from "@hachej/boring-agent/server"
import { BORING_AUTOMATION_ERROR_CODES } from "../shared/error-codes"
import type { AutomationSessionController } from "./operations"
import { AutomationStoreError } from "./store"

export function createAutomationSessionController(
  resolver: WorkspaceAgentDispatcherResolver,
  actorContext: { workspaceId?: string; userId?: string },
): AutomationSessionController {
  const context = {
    workspaceId: actorContext.workspaceId?.trim() ?? "",
    userId: actorContext.userId?.trim() ?? "",
  }
  const withBinding = async <T>(
    agentTypeId: string,
    requestId: string,
    operation: (binding: Parameters<Parameters<WorkspaceAgentDispatcherResolver["runWithWorkspaceAgent"]>[1]>[0]) => Promise<T>,
  ): Promise<T> => {
    let outcome: { value: T } | undefined
    await resolver.runWithWorkspaceAgent({ agentTypeId, context, requestId, fundingPolicy: "api-key-only" }, async (binding) => {
      outcome = { value: await operation(binding) }
    })
    if (!outcome) {
      throw new AutomationStoreError(
        BORING_AUTOMATION_ERROR_CODES.TOOL_CONTEXT_UNAVAILABLE,
        "workspace agent resolver returned without binding an automation session controller",
      )
    }
    return outcome.value
  }
  return {
    async list(agentTypeId) {
      return await withBinding(agentTypeId, `list:${randomUUID()}`, async (binding) => {
        // Fleet inspection is intentionally bounded. The newest page contains
        // the active/recent sessions relevant to the bounded run projection;
        // never walk an untrusted cursor chain inside one tool call.
        const page = await binding.listSessions(100)
        return page.sessions
      })
    },
    async nudge(agentTypeId, sessionId, message, requestId) {
      return await withBinding(agentTypeId, requestId, async (binding) => await binding.sendIfIdle(sessionId, message, requestId))
    },
    async cancel(agentTypeId, sessionId, requestId) {
      return await withBinding(agentTypeId, requestId, async (binding) => await binding.stop(sessionId, requestId))
    },
  }
}
