/**
 * Macro Server Plugin
 *
 * Provides agent tools for macro-economic data analysis.
 */

import { readFile } from "node:fs/promises"
import {
  defineServerPlugin,
  type WorkspaceServerPlugin,
} from "@boring/workspace/app/server"
import type { FastifyPluginAsync } from "fastify"
import { loadMacroConfig, type MacroConfig } from "./config"
import { registerMacroRoutes } from "./routes/macro"
import { createMacroTools } from "./tools/macroTools"
import { MACRO_OPEN_SERIES_SURFACE_KIND } from "../constants"

interface MacroProvisioningContribution {
  templateDirs?: Array<{
    id: string
    path: URL
  }>
  python?: Array<{
    id: string
    projectFile: URL
    extraLibs?: string[]
    env?: Record<string, string | URL>
  }>
}

interface CreateMacroServerPluginOptions {
  systemPromptAppend?: string
}

export const macroProvisioning: MacroProvisioningContribution = {
  templateDirs: [
    {
      id: "macro-template",
      path: new URL("../workspace-template", import.meta.url),
    },
  ],
  python: [
    {
      id: "macro-sdk",
      projectFile: new URL("../sdk/pyproject.toml", import.meta.url),
      extraLibs: [],
      env: {
        BORING_MACRO_BUILTINS_ROOT: new URL("../transforms/builtins", import.meta.url),
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

async function readMacroAppPrompt(): Promise<string | undefined> {
  try {
    return await readFile(new URL("../../../../.pi/APPEND_SYSTEM.md", import.meta.url), "utf8")
  } catch {
    return undefined
  }
}

export function makeMacroServerPlugin(
  macroConfig: MacroConfig,
  options: CreateMacroServerPluginOptions = {},
): WorkspaceServerPlugin {
  const tools = createMacroTools(macroConfig.clickhouse)
  const systemPrompt = `
## Macro Plugin Capabilities

You have access to macro-economic timeseries tools and data.

### Available Tools

- execute_sql(query) - Run read-only SQL on ClickHouse (87k+ FRED series)
- macro_search(query, limit) - Search series catalog
- get_series_data(series_id, from, to, limit) - Fetch observations
- persist_derived_series(output_id, title, input_ids, observations) - Save derived data

### Best Practices

1. Search for series before using them
2. Use read-only SQL (SELECT, WITH, EXPLAIN only)
3. Always persist derived series with meaningful IDs
4. To show a series chart, call exec_ui with kind "openSurface" and params
   { kind: "${MACRO_OPEN_SERIES_SURFACE_KIND}", target: series_id, meta: { title } }
`.trim()

  return defineServerPlugin({
    id: "boring-macro",
    label: "Macro",
    agentTools: tools,
    provisioning: macroProvisioning,
    routes: macroRoutes,
    systemPrompt: [options.systemPromptAppend, systemPrompt].filter(Boolean).join("\n\n"),
  })
}

export async function createMacroServerPlugin(
  options: CreateMacroServerPluginOptions = {},
) {
  const macroConfig = await loadMacroConfig()
  const systemPromptAppend = options.systemPromptAppend ?? await readMacroAppPrompt()
  return makeMacroServerPlugin(macroConfig, { systemPromptAppend })
}
