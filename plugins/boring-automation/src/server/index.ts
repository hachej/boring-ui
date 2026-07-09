import { join } from "node:path"
import { defineServerPlugin, type WorkspaceServerPlugin } from "@hachej/boring-workspace/server"
import {
  BORING_AUTOMATION_PLUGIN_ID,
  BORING_AUTOMATION_PLUGIN_LABEL,
} from "../shared"
import { FileAutomationStore } from "./fileStore"
import { automationRoutes } from "./routes"
import type { AutomationStore } from "./store"

export interface BoringAutomationServerPluginOptions {
  workspaceRoot?: string
  store?: AutomationStore
  defaultWorkspaceId?: string
}

export function createBoringAutomationServerPlugin(options: BoringAutomationServerPluginOptions = {}): WorkspaceServerPlugin {
  const store = options.store ?? createDefaultStore(options.workspaceRoot)
  return defineServerPlugin({
    id: BORING_AUTOMATION_PLUGIN_ID,
    label: BORING_AUTOMATION_PLUGIN_LABEL,
    routes: async (app) => {
      await automationRoutes(app, { store, defaultWorkspaceId: options.defaultWorkspaceId })
    },
  })
}

function createDefaultStore(workspaceRoot: string | undefined): AutomationStore {
  if (!workspaceRoot) throw new Error("createBoringAutomationServerPlugin requires workspaceRoot when store is not provided")
  return new FileAutomationStore(join(workspaceRoot, ".pi", "automation"))
}

export default function defaultBoringAutomationServerPlugin(
  options?: BoringAutomationServerPluginOptions,
  ctx?: { workspaceRoot?: string },
): WorkspaceServerPlugin {
  return createBoringAutomationServerPlugin({
    ...options,
    workspaceRoot: options?.workspaceRoot ?? ctx?.workspaceRoot,
  })
}

export * from "./fileStore"
export * from "./routes"
export * from "./store"
export * from "../shared"
