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
import { createLeaseBoundHostedAutomationStore } from "./hostedStore"
import { createBoringAutomationTool } from "./automationTool"
import { ManualRunExecutor, type VerifiedAutomationActor } from "./manualRunExecutor"
import { resolveAutomationOperationsForActor, type AutomationStoreMode } from "./operations"
import { InMemoryAutomationRunEventBus, PostgresAutomationRunEventBus, type AutomationRunEventBus } from "./runEventBus"
import { automationRoutes } from "./routes"
import type { AutomationStore } from "./store"

export interface BoringAutomationServerPluginOptions {
  agentTypeId: string
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
  eventBus?: AutomationRunEventBus
  /** Injected buses default to caller-owned; plugin-created buses close with the plugin. */
  eventBusOwner?: "plugin" | "caller"
  /** Defaults to true when hosted due execution is composed. Disable when an external scheduler owns wake-ups. */
  hostedSchedulerEnabled?: boolean
}

export function createBoringAutomationServerPlugin(options: BoringAutomationServerPluginOptions): WorkspaceServerPlugin {
  const store = options.store ?? createDefaultStore(options.workspaceRoot)
  const eventBus = options.eventBus ?? new InMemoryAutomationRunEventBus()
  const eventBusOwner = options.eventBusOwner ?? (options.eventBus ? "caller" : "plugin")
  const manualRunExecutor = options.dispatcherResolver && options.actorResolver
      ? new ManualRunExecutor({
        agentTypeId: options.agentTypeId,
        store,
        storeForRequest: options.storeForRequest,
        dispatcherResolver: options.dispatcherResolver,
        actorResolver: options.actorResolver,
        eventPublisher: eventBus,
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
            agentTypeId: options.agentTypeId,
            store: actorStore,
            dispatcherResolver: options.dispatcherResolver!,
            actorResolver: () => actor,
            eventPublisher: eventBus,
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
      actorResolver: options.actorResolver,
      eventBus,
    })
    app.addHook("preClose", async () => {
      // Durable leases and stale-run reconciliation own interrupted execution.
      // Shutdown only fences future timer ticks; it never delays AgentHost close.
      scheduler?.beginShutdown()
    })
    app.addHook("onClose", async () => {
      // A final invalidation may race shutdown; durable run state remains authoritative.
      if (eventBusOwner === "plugin") await eventBus.close()
    })

    if (hostedDueCoordinator && hostedSchedulerEnabled) {
      scheduler = new HostedAutomationScheduler({
        runDue: async () => await hostedDueCoordinator.runDue(),
        logger: app.log,
      })
      app.addHook("onReady", async () => scheduler?.start())
    }
  }
  return defineServerPlugin({
    id: BORING_AUTOMATION_PLUGIN_ID,
    label: BORING_AUTOMATION_PLUGIN_LABEL,
    agentTools,
    routes,
  })
}

function createDefaultStore(workspaceRoot: string | undefined): AutomationStore {
  if (!workspaceRoot) throw new Error("createBoringAutomationServerPlugin requires workspaceRoot when store is not provided")
  return new FileAutomationStore(workspaceRoot)
}

async function createHostedStore(
  sql: postgres.Sql,
  actor: VerifiedAutomationActor,
  dispatcherResolver: WorkspaceAgentDispatcherResolver,
  agentTypeId: string,
  request?: FastifyRequest,
): Promise<AutomationStore> {
  return createLeaseBoundHostedAutomationStore(sql, actor, dispatcherResolver, agentTypeId, request)
}

export default function defaultBoringAutomationServerPlugin(
  options: BoringAutomationServerPluginOptions | undefined,
  ctx?: Pick<WorkspaceAgentServerPluginContext, "workspaceRoot"> & Partial<Pick<WorkspaceAgentServerPluginContext, "agentTypeId" | "trusted">>,
): WorkspaceServerPlugin {
  const agentTypeId = options?.agentTypeId ?? ctx?.agentTypeId
  if (!agentTypeId) throw new Error("boring automation requires a host-selected agentTypeId")
  const resolvedOptions: BoringAutomationServerPluginOptions = { ...options, agentTypeId }
  const trusted = ctx?.trusted
  if (!resolvedOptions.store && trusted?.sql && trusted.workspaceAgentDispatcherResolver && trusted.actorResolver) {
    const sql = trusted.sql as postgres.Sql
    const dispatcherResolver = resolvedOptions.dispatcherResolver ?? trusted.workspaceAgentDispatcherResolver
    const eventBus = resolvedOptions.eventBus ?? new PostgresAutomationRunEventBus(sql)
    const eventBusOwner = resolvedOptions.eventBusOwner ?? (resolvedOptions.eventBus ? "caller" : "plugin")
    const fallbackStore = new PostgresAutomationStore(sql, { workspaceId: "unbound", userId: "unbound" })
    return createBoringAutomationServerPlugin({
      ...resolvedOptions,
      hostedSchedulerEnabled: resolvedOptions.hostedSchedulerEnabled ?? process.env.BORING_AUTOMATION_INTERNAL_SCHEDULER !== "false",
      store: fallbackStore,
      storeMode: "hosted",
      eventBus,
      eventBusOwner,
      storeForRequest: async (request, actor) => await createHostedStore(sql, actor, dispatcherResolver, agentTypeId, request),
      storeForActor: async (actor) => await createHostedStore(sql, actor, dispatcherResolver, agentTypeId),
      dispatcherResolver,
      actorResolver: resolvedOptions.actorResolver ?? trusted.actorResolver,
      actorVerifier: resolvedOptions.actorVerifier ?? trusted.actorVerifier,
      hostedTriggerToken: resolvedOptions.hostedTriggerToken ?? trusted.hostedAutomationTriggerToken,
      hostedDueRunService: resolvedOptions.hostedDueRunService ?? new HostedDueRunService({
        agentTypeId,
        sql,
        dispatcherResolver,
        verifyActor: resolvedOptions.actorVerifier ?? trusted.actorVerifier!,
        eventPublisher: eventBus,
      }),
    })
  }
  return createBoringAutomationServerPlugin({
    ...resolvedOptions,
    workspaceRoot: resolvedOptions.workspaceRoot ?? ctx?.workspaceRoot,
    dispatcherResolver: resolvedOptions.dispatcherResolver ?? trusted?.workspaceAgentDispatcherResolver,
    actorResolver: resolvedOptions.actorResolver ?? trusted?.actorResolver,
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
export * from "./runEventBus"
export * from "./store"
export * from "../shared"
