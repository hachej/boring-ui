import { join } from "node:path"
import type { FastifyPluginAsync } from "fastify"
import { defineServerPlugin, type WorkspaceServerPlugin } from "@hachej/boring-workspace/server"
import { APP_RUNNER_PLUGIN_ID } from "../shared/constants"
import { AppRunnerClient, type AppRunnerClientOptions } from "./appRunnerClient"
import { FileAppRunnerStore, type AppRunnerStore } from "./appRunnerStore"
import { appRunnerRoutes } from "./appRunnerRoutes"
import { createAppRunnerTools } from "./createAppRunnerTools"
import { createPublishedToolsProvider } from "./createPublishedTools"

export type AppRunnerServerPluginOptions = {
  workspaceRoot: string
  client?: AppRunnerClient
  clientOptions?: AppRunnerClientOptions
  store?: AppRunnerStore
}

export function createAppRunnerServerPlugin(options: AppRunnerServerPluginOptions): WorkspaceServerPlugin {
  const client = options.client ?? new AppRunnerClient(options.clientOptions)
  const store = options.store ?? new FileAppRunnerStore(join(options.workspaceRoot, ".boring", "app-runner.json"))

  const routes: FastifyPluginAsync = async (app) => {
    app.register(appRunnerRoutes, { workspaceRoot: options.workspaceRoot, client, store })
  }

  return defineServerPlugin({
    id: APP_RUNNER_PLUGIN_ID,
    label: "Apps",
    systemPrompt: [
      "An \"app\" is the app/ folder in the workspace: index.js (an ES module, Cloudflare-Worker-style, exporting a `fetch(request, env, ctx)` handler — env.APPDATA is an RPC-based data store, env.IDENTITY is the current user) plus index.html and any static assets it needs.",
      "Call publish_app to deploy the app/ folder and get back a live URL. Use list_app_versions, rollback_app, and activate_app_version to manage published versions. Use get_app_logs and get_app_usage to check on a published app.",
      "An optional app/tools.json manifest ({ tools: [{ name, description, input, route }], bindings }) lets an app expose its own callable tools; they're auto-registered after publish and callable with call_app_tool.",
      "After publishing, call exec_ui with { kind: 'openSurface', params: { kind: 'app-runner', target: '<appName>' } } to open the Apps panel focused on that app.",
    ].join("\n"),
    agentTools: createAppRunnerTools({ workspaceRoot: options.workspaceRoot, client, store }),
    agentToolsDynamic: createPublishedToolsProvider({ client, store }),
    routes,
  })
}
