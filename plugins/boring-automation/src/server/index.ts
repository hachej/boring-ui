import { join } from "node:path"
import type { WorkspaceAgentDispatcherResolver } from "@hachej/boring-agent/server"
import type { FastifyRequest } from "fastify"
import type postgres from "postgres"
import type { WorkspaceAgentServerPluginContext } from "@hachej/boring-workspace/app/server"
import { defineServerPlugin, type WorkspaceServerPlugin } from "@hachej/boring-workspace/server"
import {
  BORING_AUTOMATION_PLUGIN_ID,
  BORING_AUTOMATION_PLUGIN_LABEL,
} from "../shared"
import { DueRunService } from "./dueRunService"
import { FileAutomationStore } from "./fileStore"
import { HostedDueRunService } from "./hostedDueRunService"
import { PostgresAutomationStore } from "./postgresStore"
import { ManualRunExecutor, type VerifiedAutomationActor } from "./manualRunExecutor"
import { automationRoutes } from "./routes"
import type { AutomationStore } from "./store"

export interface BoringAutomationServerPluginOptions {
  workspaceRoot?: string
  store?: AutomationStore
  dispatcherResolver?: WorkspaceAgentDispatcherResolver
  actorResolver?: (request: FastifyRequest) => Promise<VerifiedAutomationActor> | VerifiedAutomationActor
  storeForRequest?: (request: FastifyRequest, actor: VerifiedAutomationActor) => Promise<AutomationStore> | AutomationStore
  actorVerifier?: (actor: VerifiedAutomationActor) => Promise<boolean> | boolean
  hostedTriggerToken?: string
  hostedDueRunService?: Pick<HostedDueRunService, "runDue">
}

export function createBoringAutomationServerPlugin(options: BoringAutomationServerPluginOptions = {}): WorkspaceServerPlugin {
  const store = options.store ?? createDefaultStore(options.workspaceRoot)
  const manualRunExecutor = options.dispatcherResolver && options.actorResolver
    ? new ManualRunExecutor({
        store,
        storeForRequest: options.storeForRequest,
        dispatcherResolver: options.dispatcherResolver,
        actorResolver: options.actorResolver,
      })
    : undefined
  const dueRunService = manualRunExecutor && !options.storeForRequest
    ? new DueRunService({ store, executor: manualRunExecutor })
    : undefined
  return defineServerPlugin({
    id: BORING_AUTOMATION_PLUGIN_ID,
    label: BORING_AUTOMATION_PLUGIN_LABEL,
    routes: async (app) => {
      await automationRoutes(app, {
        store,
        storeForRequest: options.storeForRequest ? async (request) => {
          const actor = options.actorResolver ? await options.actorResolver(request) : undefined
          if (!actor) throw new Error("automation actor resolver is unavailable")
          return await options.storeForRequest!(request, actor)
        } : undefined,
        manualRunExecutor,
        dueRunService,
        hostedDueRunService: options.hostedDueRunService,
        hostedTriggerToken: options.hostedTriggerToken,
      })
    },
  })
}

function createDefaultStore(workspaceRoot: string | undefined): AutomationStore {
  if (!workspaceRoot) throw new Error("createBoringAutomationServerPlugin requires workspaceRoot when store is not provided")
  return new FileAutomationStore(join(workspaceRoot, ".pi", "automation"))
}

export default function defaultBoringAutomationServerPlugin(
  options?: BoringAutomationServerPluginOptions,
  ctx?: Pick<WorkspaceAgentServerPluginContext, "workspaceRoot"> & Partial<Pick<WorkspaceAgentServerPluginContext, "trusted">>,
): WorkspaceServerPlugin {
  const trusted = ctx?.trusted
  if (!options?.store && trusted?.sql && trusted.workspaceAgentDispatcherResolver && trusted.actorResolver) {
    const sql = trusted.sql as postgres.Sql
    const fallbackStore = new PostgresAutomationStore(sql, { workspaceId: "unbound", userId: "unbound" })
    return createBoringAutomationServerPlugin({
      ...options,
      store: fallbackStore,
      storeForRequest: async (_request, actor) => new PostgresAutomationStore(sql, actor),
      dispatcherResolver: options?.dispatcherResolver ?? trusted.workspaceAgentDispatcherResolver,
      actorResolver: options?.actorResolver ?? trusted.actorResolver,
      actorVerifier: options?.actorVerifier ?? trusted.actorVerifier,
      hostedTriggerToken: options?.hostedTriggerToken ?? trusted.hostedAutomationTriggerToken,
      hostedDueRunService: options?.hostedDueRunService ?? new HostedDueRunService({
        sql,
        dispatcherResolver: options?.dispatcherResolver ?? trusted.workspaceAgentDispatcherResolver,
        verifyActor: options?.actorVerifier ?? trusted.actorVerifier!,
      }),
    })
  }
  return createBoringAutomationServerPlugin({
    ...options,
    workspaceRoot: options?.workspaceRoot ?? ctx?.workspaceRoot,
    dispatcherResolver: options?.dispatcherResolver ?? trusted?.workspaceAgentDispatcherResolver,
    actorResolver: options?.actorResolver ?? trusted?.actorResolver,
  })
}

export * from "./dueRunService"
export * from "./fileStore"
export * from "./hostedDueRunService"
export * from "./manualRunExecutor"
export * from "./migrations"
export * from "./postgresStore"
export * from "./routes"
export * from "./store"
export * from "../shared"
