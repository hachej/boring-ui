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
import { InMemoryAutomationRunEventBus, PostgresAutomationRunEventBus, type AutomationRunEventBus } from "./runEventBus"
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
  eventBus?: AutomationRunEventBus
  /** Explicit resource ownership; injected buses default to caller-owned. */
  eventBusOwner?: "composition" | "caller"
  /** Defaults to true when hosted due execution is composed. Disable when an external scheduler owns wake-ups. */
  hostedSchedulerEnabled?: boolean
}

export function createBoringAutomationServerPlugin(options: BoringAutomationServerPluginOptions = {}): WorkspaceServerPlugin {
  const store = options.store ?? createDefaultStore(options.workspaceRoot)
  const eventBus = options.eventBus ?? new InMemoryAutomationRunEventBus()
  const eventBusOwner = options.eventBusOwner ?? (options.eventBus ? "caller" : "composition")
  const manualRunExecutor = options.dispatcherResolver && options.actorResolver
    ? new ManualRunExecutor({
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
  const hostWorkers: NonNullable<WorkspaceServerPlugin["hostWorkers"]> = hostedSchedulerEnabled || eventBusOwner === "composition"
    ? [{
        id: "hosted-scheduler",
        async run({ signal, logger }) {
          const scheduler = hostedDueCoordinator && hostedSchedulerEnabled
            ? new HostedAutomationScheduler({
                runDue: async () => await hostedDueCoordinator.runDue(),
                logger,
              })
            : undefined
          try {
            scheduler?.start()
            await waitForAbort(signal)
          } finally {
            await scheduler?.stop()
            if (eventBusOwner === "composition") await eventBus.close()
          }
        },
      }]
    : []
  const agentTools = options.agentToolEnabled === false ? [] : [createBoringAutomationTool({
    resolveOperationsForActor: async (actorContext) => resolveAutomationOperationsForActor({
      mode: options.storeMode ?? "local",
      resolveStore: async (actor) => options.storeForActor ? options.storeForActor(actor) : store,
      resolveExecutor: options.dispatcherResolver
        ? async (actor, actorStore) => new ManualRunExecutor({
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
  }
  return defineServerPlugin({
    id: BORING_AUTOMATION_PLUGIN_ID,
    label: BORING_AUTOMATION_PLUGIN_LABEL,
    agentTools,
    routes,
    ...(hostWorkers.length > 0 ? { hostWorkers } : {}),
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
  request?: FastifyRequest,
): Promise<PostgresAutomationStore> {
  if (!dispatcherResolver.resolveWithWorkspace) throw new Error("workspace-bound automation storage is unavailable")
  const binding = await dispatcherResolver.resolveWithWorkspace(actor, request ? { request } : undefined)
  return new PostgresAutomationStore(sql, actor, undefined, binding.workspace)
}

export default function defaultBoringAutomationServerPlugin(
  options?: BoringAutomationServerPluginOptions,
  ctx?: Pick<WorkspaceAgentServerPluginContext, "workspaceRoot"> & Partial<Pick<WorkspaceAgentServerPluginContext, "trusted">>,
): WorkspaceServerPlugin {
  const trusted = ctx?.trusted
  if (!options?.store && trusted?.sql && trusted.workspaceAgentDispatcherResolver && trusted.actorResolver) {
    const sql = trusted.sql as postgres.Sql
    const dispatcherResolver = options?.dispatcherResolver ?? trusted.workspaceAgentDispatcherResolver
    const eventBus = options?.eventBus ?? new PostgresAutomationRunEventBus(sql)
    const eventBusOwner = options?.eventBusOwner ?? (options?.eventBus ? "caller" : "composition")
    const fallbackStore = new PostgresAutomationStore(sql, { workspaceId: "unbound", userId: "unbound" })
    return createBoringAutomationServerPlugin({
      ...options,
      hostedSchedulerEnabled: options?.hostedSchedulerEnabled ?? process.env.BORING_AUTOMATION_INTERNAL_SCHEDULER !== "false",
      store: fallbackStore,
      storeMode: "hosted",
      eventBus,
      eventBusOwner,
      storeForRequest: async (request, actor) => await createHostedStore(sql, actor, dispatcherResolver, request),
      storeForActor: async (actor) => await createHostedStore(sql, actor, dispatcherResolver),
      dispatcherResolver,
      actorResolver: options?.actorResolver ?? trusted.actorResolver,
      actorVerifier: options?.actorVerifier ?? trusted.actorVerifier,
      hostedTriggerToken: options?.hostedTriggerToken ?? trusted.hostedAutomationTriggerToken,
      hostedDueRunService: options?.hostedDueRunService ?? new HostedDueRunService({
        sql,
        dispatcherResolver,
        verifyActor: options?.actorVerifier ?? trusted.actorVerifier!,
        eventPublisher: eventBus,
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

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
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
