import { randomUUID } from "node:crypto"

import type { WorkspaceAgentDispatcherResolver } from "@hachej/boring-agent/server"
import type { FastifyRequest } from "fastify"
import type postgres from "postgres"
import { PostgresAutomationStore, type HostedAutomationActor } from "./postgresStore"
import type { AutomationStore } from "./store"

/**
 * Actor-scoped hosted store whose Workspace-dependent operations execute only
 * while the canonical AgentHost Environment lease is held.
 */
export function createLeaseBoundHostedAutomationStore(
  sql: postgres.Sql,
  actor: HostedAutomationActor,
  dispatcherResolver: WorkspaceAgentDispatcherResolver,
  agentTypeId: string,
  request?: FastifyRequest,
): AutomationStore {
  const runWithWorkspaceAgent = dispatcherResolver.runWithWorkspaceAgent
  if (!runWithWorkspaceAgent) throw new Error("workspace-bound automation storage is unavailable")

  return new Proxy({} as AutomationStore, {
    get(_target, property) {
      // Promise resolution probes `then`; this proxy is a store, not a thenable.
      if (property === "then") return undefined
      return async (...args: unknown[]) => {
        let result: unknown
        await runWithWorkspaceAgent.call(dispatcherResolver, {
          agentTypeId,
          context: actor,
          requestId: randomUUID(),
          ...(request ? { request } : {}),
        }, async ({ workspace }) => {
          const store = new PostgresAutomationStore(sql, actor, undefined, workspace)
          const method = Reflect.get(store, property)
          if (typeof method !== "function") throw new TypeError(`Unknown automation store operation: ${String(property)}`)
          result = await Reflect.apply(method, store, args)
        })
        return result
      }
    },
  })
}
