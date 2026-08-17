import { randomUUID } from "node:crypto"
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
import { DispatchRunExecutor, type VerifiedAutomationActor } from "./dispatchRunExecutor"
import { resolveAutomationOperationsForActor, type AutomationRunTranscriptReader, type AutomationSessionController, type AutomationStoreMode } from "./operations"
import { InMemoryAutomationRunEventBus, PostgresAutomationRunEventBus, type AutomationRunEventBus } from "./runEventBus"
import { automationRoutes } from "./routes"
import type { AutomationStore } from "./store"
import { seedStandingAutomations } from "./standingAutomations"

export interface BoringAutomationServerPluginOptions {
  agentTypeId: string
  availableAgentTypeIds?: readonly string[]
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
  /** Server-owned seat grant for raw run transcripts. Defaults to boring-orchestrator only. */
  rawRunTranscriptAgentTypeIds?: readonly string[]
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
  const dispatchRunExecutor = options.dispatcherResolver && options.actorResolver
      ? new DispatchRunExecutor({
        agentTypeId: options.agentTypeId,
        availableAgentTypeIds: options.availableAgentTypeIds,
        store,
        storeForRequest: options.storeForRequest,
        dispatcherResolver: options.dispatcherResolver,
        actorResolver: options.actorResolver,
        eventPublisher: eventBus,
      })
    : undefined
  const dueRunService = dispatchRunExecutor && !options.storeForRequest
    ? new DueRunService({ store, executor: dispatchRunExecutor })
    : undefined
  const hostedDueCoordinator = options.hostedDueRunService
    ? new HostedDueCoordinator(options.hostedDueRunService)
    : undefined
  const hostedSchedulerEnabled = Boolean(hostedDueCoordinator) && options.hostedSchedulerEnabled !== false
  let scheduler: HostedAutomationScheduler | undefined
  const rawRunTranscriptAgentTypeIds = options.rawRunTranscriptAgentTypeIds ?? ["boring-orchestrator"]
  const agentTools = options.agentToolEnabled === false ? [] : [createBoringAutomationTool({
    rawRunTranscriptAgentTypeIds,
    resolveOperationsForActor: async (actorContext) => resolveAutomationOperationsForActor({
      mode: options.storeMode ?? "local",
      resolveStore: async (actor) => options.storeForActor ? options.storeForActor(actor) : store,
      defaultAgentTypeId: options.agentTypeId,
      sessionController: options.dispatcherResolver
        ? createAutomationSessionController(options.dispatcherResolver, actorContext)
        : undefined,
      resolveTranscriptReader: options.dispatcherResolver?.readSessionJsonlPage
        ? () => createAutomationTranscriptReader(
            options.dispatcherResolver!,
            actorContext,
          )
        : undefined,
      resolveExecutor: options.dispatcherResolver
        ? async (actor, actorStore) => new DispatchRunExecutor({
            agentTypeId: options.agentTypeId,
            availableAgentTypeIds: options.availableAgentTypeIds,
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
      dispatchRunExecutor,
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

    app.addHook("onReady", async () => {
      if (!options.storeForRequest) await seedStandingAutomations(store)
      if (hostedDueCoordinator && hostedSchedulerEnabled) {
        scheduler = new HostedAutomationScheduler({
          runDue: async () => await hostedDueCoordinator.runDue(),
          logger: app.log,
        })
        scheduler.start()
      }
    })
  }
  return defineServerPlugin({
    id: BORING_AUTOMATION_PLUGIN_ID,
    label: BORING_AUTOMATION_PLUGIN_LABEL,
    agentTools,
    routes,
  })
}


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
    let result: T | undefined
    await resolver.runWithWorkspaceAgent({ agentTypeId, context, requestId }, async (binding) => {
      result = await operation(binding)
    })
    return result as T
  }
  return {
    async list(agentTypeId) {
      const page = await withBinding(agentTypeId, `list:${randomUUID()}`, async (binding) => await requireLeaseMethod(binding.listSessions, "listSessions").call(binding, 100))
      return page.sessions
    },
    async nudge(agentTypeId, sessionId, message, requestId) {
      await withBinding(agentTypeId, requestId, async (binding) => {
        await requireLeaseMethod(binding.sendIfIdle, "sendIfIdle").call(binding, sessionId, message, requestId)
      })
    },
    async cancel(agentTypeId, sessionId, requestId) {
      await withBinding(agentTypeId, requestId, async (binding) => {
        await binding.stop(sessionId, requestId)
      })
    },
  }
}


function createAutomationTranscriptReader(
  resolver: WorkspaceAgentDispatcherResolver,
  actorContext: { workspaceId?: string; userId?: string },
): AutomationRunTranscriptReader {
  const context = {
    workspaceId: actorContext.workspaceId?.trim() ?? "",
    userId: actorContext.userId?.trim() ?? "",
  }
  return {
    async read({ automation, run, cursor, limit, maxBytes, signal }) {
      const agentTypeId = run.dispatchReceipt!.ref.agentTypeId
      const sessionId = run.dispatchReceipt!.ref.sessionId
      if (run.sessionId !== sessionId) {
        throw new Error("automation run dispatch receipt does not match its session")
      }
      return await resolver.readSessionJsonlPage!(
        context,
        { agentTypeId, sessionId },
        { cursor, limit, maxBytes, signal },
      )
    },
  }
}

function requireLeaseMethod<T extends (...args: never[]) => unknown>(method: T | undefined, name: string): T {
  if (!method) throw new Error(`workspace agent lease does not support ${name}`)
  return method
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
  ctx?: Pick<WorkspaceAgentServerPluginContext, "workspaceRoot"> & Partial<Pick<WorkspaceAgentServerPluginContext, "agentTypeId" | "availableAgentTypeIds" | "trusted">>,
): WorkspaceServerPlugin {
  const agentTypeId = options?.agentTypeId ?? ctx?.agentTypeId
  if (!agentTypeId) throw new Error("boring automation requires a host-selected agentTypeId")
  const resolvedOptions: BoringAutomationServerPluginOptions = {
    ...options,
    agentTypeId,
    availableAgentTypeIds: options?.availableAgentTypeIds ?? ctx?.availableAgentTypeIds,
  }
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
      storeForRequest: async (request, actor) => {
        const actorStore = await createHostedStore(sql, actor, dispatcherResolver, agentTypeId, request)
        await seedStandingAutomations(actorStore)
        return actorStore
      },
      storeForActor: async (actor) => {
        const actorStore = await createHostedStore(sql, actor, dispatcherResolver, agentTypeId)
        await seedStandingAutomations(actorStore)
        return actorStore
      },
      dispatcherResolver,
      actorResolver: resolvedOptions.actorResolver ?? trusted.actorResolver,
      actorVerifier: resolvedOptions.actorVerifier ?? trusted.actorVerifier,
      hostedTriggerToken: resolvedOptions.hostedTriggerToken ?? trusted.hostedAutomationTriggerToken,
      hostedDueRunService: resolvedOptions.hostedDueRunService ?? new HostedDueRunService({
        agentTypeId,
        availableAgentTypeIds: resolvedOptions.availableAgentTypeIds,
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
export * from "./dispatchRunExecutor"
export { ManualRunExecutor, type ManualRunExecutorOptions, type ManualRunInput } from "./manualRunExecutor"
export * from "./migrations"
export * from "./standingAutomations"
export * from "./operations"
export * from "./postgresStore"
export * from "./routes"
export * from "./runEventBus"
export * from "./store"
export * from "../shared"
