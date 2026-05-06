/**
 * Macro Server Plugin
 *
 * Provides agent tools for macro-economic data analysis.
 */

import { readFile } from "node:fs/promises"
import {
  defineServerPlugin,
  type WorkspaceServerPlugin,
} from "@hachej/boring-workspace/app/server"
import type { FastifyPluginAsync } from "fastify"
import { loadMacroConfig, type MacroConfig } from "./config"
import { registerMacroRoutes } from "./routes/macro"
import { createMacroTools } from "./tools/macroTools"
import { MACRO_OPEN_SERIES_SURFACE_KIND } from "../shared/constants"

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
      path: new URL("./workspace-template", import.meta.url),
    },
  ],
  python: [
    {
      id: "macro-sdk",
      projectFile: new URL("./sdk/pyproject.toml", import.meta.url),
      extraLibs: [],
      env: {
        BORING_MACRO_BUILTINS_ROOT: new URL("./transforms/builtins", import.meta.url),
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
## Environment

Your workspace root is available via the \`BORING_AGENT_WORKSPACE_ROOT\` environment variable (also \`$(pwd)\` when you run bash commands). In production this is a subdirectory of \`/data/workspace/\`.

- Skill files live at \`$BORING_AGENT_WORKSPACE_ROOT/.agents/skills/\`
- The \`bm\` CLI and Python venv are at \`$BORING_AGENT_WORKSPACE_ROOT/.venv/\`
- Deck files go in \`$BORING_AGENT_WORKSPACE_ROOT/deck/\`

## Macro Plugin Capabilities

You have access to macro-economic timeseries tools and data.

### Available Tools

- execute_sql(query) - Run read-only SQL on ClickHouse (87k+ FRED series)
- macro_search(query, limit) - Search series catalog
- get_series_data(series_id, from, to, limit) - Fetch observations
- persist_derived_series(output_id, title, input_ids, observations) - Save derived data

### Derived Series — use the macro-transform skill

For any derived/transformed series (YoY, MA, diff, custom index, etc.), always use the **macro-transform skill** via the \`bm\` CLI:

- **Builtins** (yoy, qoq_annualized, hp_filter, etc.): \`bm run --tool builtin:yoy --input GDPC1 --output GDPC1_YOY --title "Real GDP YoY"\`
- **New custom transform** (anything not in builtins): scaffold it first, then run it:
  bm scaffold --name gdp_stability_index
  # edit transforms/custom/gdp_stability_index.py
  bm run --tool custom:gdp_stability_index --input GDPC1 --output GDPC1_GSI --title "GDP Stability Index"
- **List all available transforms**: \`bm list\`

Never hand-compute observation arrays in chat. Always use \`bm scaffold\` + \`bm run\` for new custom transforms — this makes them reusable and reproducible. \`persist_derived_series\` is a last-resort fallback only.

### Best Practices

1. Search for series before using them
2. Use read-only SQL (SELECT, WITH, EXPLAIN only)
3. Always persist derived series via \`bm run\` (not by hand)
4. To show a series chart, call exec_ui with kind "openSurface" and params
   { kind: "${MACRO_OPEN_SERIES_SURFACE_KIND}", target: series_id, meta: { title } }

### Deck Slide Format Rules

When writing a deck file (*.md in the deck/ directory), follow these rules strictly:

- Separate slides with a line containing ONLY \`---\` (three dashes, nothing else on the line)
- Each slide fits a fixed 16:9 viewport — keep content SHORT or it will be scaled down to unreadable size
- Max 1 heading + 4–6 bullet points per slide, OR 1 heading + 1 short paragraph, OR a single chart embed
- Headings should be ≤ 6 words. Bullets should be ≤ 12 words each
- Do NOT write walls of text. No multi-paragraph prose inside a single slide
- Use \`{{TimeSeries ids="ID1,ID2"}}\` on its own line to embed a chart — counts as most of the slide content
- Frontmatter title sets the cover slide: start the file with \`---\\ntitle: My Title\\n---\` if you want a cover
- Never use nested bullet lists deeper than one level
`.trim()

  return defineServerPlugin({
    id: "boring-macro",
    label: "Macro",
    piPackages: ["npm:pi-web-access"],
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
