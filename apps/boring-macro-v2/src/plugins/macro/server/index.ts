import {
  defineServerPlugin,
  type WorkspaceServerPlugin,
} from "@boring/workspace/app/server"
import type { BoringServerFactory } from "@boring/workspace/server"
import type { FastifyPluginAsync } from "fastify"
import { fileURLToPath } from "node:url"
import { loadMacroConfig, type MacroConfig } from "./config"
import { registerMacroRoutes } from "./routes/macro"

const macroAgentExtensionPath = fileURLToPath(new URL("../agent/index.ts", import.meta.url))

export const macroProvisioning = {
  templateDirs: [
    {
      id: "macro-template",
      path: new URL("./template", import.meta.url),
    },
  ],
  python: [
    {
      id: "macro-sdk",
      projectFile: new URL("../sdk/pyproject.toml", import.meta.url),
      extraLibs: [],
      env: {
        BORING_MACRO_BUILTINS_ROOT: new URL("../agent/transforms/builtins", import.meta.url),
      },
    },
  ],
}

export const macroRoutes: FastifyPluginAsync = async (app) => {
  app.get("/info", async () => ({
    name: "boring.macro",
    version: "0.2.0",
  }))

  await app.register(registerMacroRoutes)
}

// Dynamic boring server assets currently support exact method/path handlers,
// not full Fastify plugins with scoped prefixes, params, hooks, and schemas.
// Keep the canonical macro HTTP API on `macroRoutes` above; this minimal
// factory exists so the asset manager can validate and hot-reload the plugin
// server entry without breaking `/api/boring.reload`. Expand it when the
// dynamic route API reaches Fastify parity.
const macroBoringServer: BoringServerFactory = (api) => {
  api.get("/info", async () => ({
    name: "boring.macro",
    version: "0.2.0",
  }))
}

export default macroBoringServer

export function makeMacroServerPlugin(_macroConfig: MacroConfig): WorkspaceServerPlugin {
  return defineServerPlugin({
    id: "boring-macro",
    label: "Macro",
    extensionPaths: [macroAgentExtensionPath],
    provisioning: macroProvisioning,
    routes: macroRoutes,
  })
}

export async function createMacroServerPlugin(): Promise<WorkspaceServerPlugin> {
  const macroConfig = await loadMacroConfig()
  return makeMacroServerPlugin(macroConfig)
}
