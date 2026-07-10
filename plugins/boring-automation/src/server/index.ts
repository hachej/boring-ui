import { join } from "node:path"
import type { WorkspaceAgentDispatcherResolver } from "@hachej/boring-agent/server"
import type { FastifyRequest } from "fastify"
import type { WorkspaceAgentServerPluginContext } from "@hachej/boring-workspace/app/server"
import { defineServerPlugin, type WorkspaceServerPlugin } from "@hachej/boring-workspace/server"
import {
  BORING_AUTOMATION_PLUGIN_ID,
  BORING_AUTOMATION_PLUGIN_LABEL,
} from "../shared"
import { FileAutomationStore } from "./fileStore"
import { ManualRunExecutor, type VerifiedAutomationActor } from "./manualRunExecutor"
import { automationRoutes } from "./routes"
import type { AutomationStore } from "./store"

export interface BoringAutomationServerPluginOptions {
  workspaceRoot?: string
  store?: AutomationStore
  dispatcherResolver?: WorkspaceAgentDispatcherResolver
  actorResolver?: (request: FastifyRequest) => Promise<VerifiedAutomationActor> | VerifiedAutomationActor
}

export function createBoringAutomationServerPlugin(options: BoringAutomationServerPluginOptions = {}): WorkspaceServerPlugin {
  const store = options.store ?? createDefaultStore(options.workspaceRoot)
  const manualRunExecutor = options.dispatcherResolver && options.actorResolver
    ? new ManualRunExecutor({ store, dispatcherResolver: options.dispatcherResolver, actorResolver: options.actorResolver })
    : undefined
  return defineServerPlugin({
    id: BORING_AUTOMATION_PLUGIN_ID,
    label: BORING_AUTOMATION_PLUGIN_LABEL,
    routes: async (app) => {
      await automationRoutes(app, { store, manualRunExecutor })
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
  return createBoringAutomationServerPlugin({
    ...options,
    workspaceRoot: options?.workspaceRoot ?? ctx?.workspaceRoot,
    dispatcherResolver: options?.dispatcherResolver ?? trusted?.workspaceAgentDispatcherResolver,
    actorResolver: options?.actorResolver ?? trusted?.actorResolver,
  })
}

export * from "./fileStore"
export * from "./manualRunExecutor"
export * from "./routes"
export * from "./store"
export * from "../shared"
