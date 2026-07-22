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
import { HostedDueCoordinator } from "./hostedDueCoordinator"
import { HostedDueRunService } from "./hostedDueRunService"
import { HostedAutomationScheduler } from "./hostedScheduler"
import { PostgresAutomationStore } from "./postgresStore"
import { createBoringAutomationTool } from "./automationTool"
import { ManualRunExecutor, type VerifiedAutomationActor } from "./manualRunExecutor"
import { resolveAutomationOperationsForActor, type AutomationStoreMode } from "./operations"
import { automationRoutes } from "./routes"
import type { AutomationStore } from "./store"

export interface BoringAutomationServerPluginOptions {
  workspaceRoot?: string
  store?: AutomationStore
  dispatcherResolver?: WorkspaceAgentDispatcherResolver
  actorResolver?: (request: FastifyRequest) => Promise<VerifiedAutomationActor> | VerifiedAutomationActor
  storeForRequest?: (request: FastifyRequest, actor: VerifiedAutomationActor) => Promise<AutomationStore> | AutomationStore
  /** Trusted actor-scoped store resolver used only by the boot-time agent tool. */
  storeForActor?: (actor: VerifiedAutomationActor) => Promise<AutomationStore> | AutomationStore
  storeMode?: AutomationStoreMode
  /** Boot-time gate. Disabling removes only the tool; routes and UI remain available. */
  agentToolEnabled?: boolean
  actorVerifier?: (actor: VerifiedAutomationActor) => Promise<boolean> | boolean
  hostedTriggerToken?: string
  hostedDueRunService?: Pick<HostedDueRunService, "runDue">
  /** Defaults to true when hosted due execution is composed. Disable when an external scheduler owns wake-ups. */
  hostedSchedulerEnabled?: boolean
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
  const hostedDueCoordinator = options.hostedDueRunService
    ? new HostedDueCoordinator(options.hostedDueRunService)
    : undefined
  const hostedSchedulerEnabled = Boolean(hostedDueCoordinator) && options.hostedSchedulerEnabled !== false
  let scheduler: HostedAutomationScheduler | undefined
  const agentTools = options.agentToolEnabled === false ? [] : [createBoringAutomationTool({
    resolveOperationsForActor: async (actorContext) => resolveAutomationOperationsForActor({
      mode: options.storeMode ?? "local",
      resolveStore: async (actor) => options.storeForActor ? options.storeForActor(actor) : store,
      resolveExecutor: options.dispatcherResolver
        ? async (actor, actorStore) => new ManualRunExecutor({
            store: actorStore,
            dispatcherResolver: options.dispatcherResolver!,
            actorResolver: () => actor,
          })
        : undefined,
    }, actorContext),
  })]
  const routes = async (app: Parameters<NonNullable<WorkspaceServerPlugin["routes"]>>[0]) => {
    await automationRoutes(app, {
      store,
      storeForRequest: options.storeForRequest ? async (request) => {
        const actor = options.actorResolver ? await options.actorResolver(request) : undefined
        if (!actor) throw new Error("automation actor resolver is unavailable")
        return await options.storeForRequest!(request, actor)
      } : undefined,
      manualRunExecutor,
      dueRunService,
      hostedDueRunService: hostedDueCoordinator,
      hostedTriggerToken: options.hostedTriggerToken,
    })

    if (hostedDueCoordinator && hostedSchedulerEnabled) {
      scheduler = new HostedAutomationScheduler({
        runDue: async () => await hostedDueCoordinator.runDue(),
        logger: app.log,
      })
      app.addHook("onReady", async () => scheduler?.start())
      app.addHook("onClose", async () => await scheduler?.stop())
    }
  }
  return defineServerPlugin({
    id: BORING_AUTOMATION_PLUGIN_ID,
    label: BORING_AUTOMATION_PLUGIN_LABEL,
    agentTools,
    routes,
    ...(hostedSchedulerEnabled ? {
      shutdown: {
        begin: () => scheduler?.beginShutdown(),
        drain: async () => await scheduler?.drain(),
      },
    } : {}),
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
      hostedSchedulerEnabled: options?.hostedSchedulerEnabled ?? process.env.BORING_AUTOMATION_INTERNAL_SCHEDULER !== "false",
      store: fallbackStore,
      storeMode: "hosted",
      storeForRequest: async (_request, actor) => new PostgresAutomationStore(sql, actor),
      storeForActor: async (actor) => new PostgresAutomationStore(sql, actor),
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

export * from "./automationTool"
export * from "./dueRunService"
export * from "./fileStore"
export * from "./hostedDueRunService"
export * from "./manualRunExecutor"
export * from "./migrations"
export * from "./operations"
export * from "./postgresStore"
export * from "./routes"
export * from "./store"
export * from "../shared"
