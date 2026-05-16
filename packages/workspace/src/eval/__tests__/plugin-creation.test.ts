/**
 * Eval: package-shaped plugin creation and reload via the boring-ui agent.
 *
 * Gated on GEMINI_API_KEY, ANTHROPIC_API_KEY, or OPENROUTER_API_KEY — skipped silently in CI without one.
 * Run manually:
 *   GEMINI_API_KEY=... pnpm --filter @hachej/boring-workspace test src/eval/__tests__/plugin-creation.test.ts
 *   ANTHROPIC_API_KEY=sk-ant-... pnpm --filter @hachej/boring-workspace test src/eval/__tests__/plugin-creation.test.ts
 *   OPENROUTER_API_KEY=sk-or-v1-... pnpm --filter @hachej/boring-workspace test src/eval/__tests__/plugin-creation.test.ts
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { evalAgentPrompt, EvalRegex } from "@hachej/boring-agent/eval"
import type { FastifyInstance } from "fastify"
import { createWorkspaceAgentServer } from "../../app/server/createWorkspaceAgentServer"

const EVAL_MODEL = process.env.GEMINI_API_KEY
  ? ({ provider: "google", id: "gemini-2.5-flash" } as const)
  : process.env.ANTHROPIC_API_KEY
    ? ({ provider: "anthropic", id: "claude-sonnet-4-6" } as const)
    : ({ provider: "openrouter", id: "qwen/qwen3.6-plus" } as const)
const HAS_KEY = !!(process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.OPENROUTER_API_KEY)
const describeIf = HAS_KEY ? describe : describe.skip

const WORKSPACE_PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../")
const EVAL_PLUGIN_DIR = join(WORKSPACE_PKG_ROOT, ".pi", "extensions", "eval-task-list")
const EVAL_PLUGIN_FRONT = join(EVAL_PLUGIN_DIR, "front", "index.tsx")
const EVAL_PLUGIN_AGENT = join(EVAL_PLUGIN_DIR, "agent", "index.ts")
const EVAL_PLUGIN_PACKAGE = join(EVAL_PLUGIN_DIR, "package.json")

const EVAL_CSV_PLUGIN_DIR = join(WORKSPACE_PKG_ROOT, ".pi", "extensions", "eval-csv-viz")
const EVAL_CSV_PLUGIN_PACKAGE = join(EVAL_CSV_PLUGIN_DIR, "package.json")

describeIf("package plugin creation + reload eval (live LLM)", () => {
  let app: FastifyInstance

  beforeAll(async () => {
    rmSync(EVAL_PLUGIN_DIR, { recursive: true, force: true })
    rmSync(EVAL_CSV_PLUGIN_DIR, { recursive: true, force: true })
    app = await createWorkspaceAgentServer({
      workspaceRoot: WORKSPACE_PKG_ROOT,
      mode: "direct",
      logger: false,
      provisionWorkspace: false,
    })
  }, 30_000)

  afterAll(async () => {
    if (app) await app.close()
    rmSync(EVAL_PLUGIN_DIR, { recursive: true, force: true })
    rmSync(EVAL_CSV_PLUGIN_DIR, { recursive: true, force: true })
  })

  test(
    "agent creates a package plugin, /reload discovers it, and later front/agent metadata changes reload",
    async () => {
      const result = await evalAgentPrompt({
        app,
        prompt: `
Create a hot-reloadable boring-ui package plugin called "eval-task-list" at:
  .pi/extensions/eval-task-list/

Read docs/plugins.md and docs/panels.md before writing code.

Create exactly these files:
1. .pi/extensions/eval-task-list/package.json
2. .pi/extensions/eval-task-list/front/index.tsx
3. .pi/extensions/eval-task-list/agent/index.ts

package.json requirements:
- name: "eval-task-list"
- version: "1.0.0"
- boring.label: "Eval Task List"
- boring.front: "front/index.tsx"
- boring.server: false
- pi.extensions: ["agent/index.ts"]
- pi.systemPrompt: "Eval task list plugin v1: use task_list_status for task list status."

front/index.tsx requirements — the factory is IMPERATIVE (\`(api) => void\`),
NOT a declarative object. Do NOT export \`{ panels: [...], commands: [...] }\` —
call \`api.registerPanel(...)\` etc. Skeleton:

\`\`\`tsx
import type { BoringFrontFactory } from "@hachej/boring-workspace/plugin"

const factory: BoringFrontFactory = (api) => {
  api.registerPanel({ id: "eval-task-list.panel", label: "Eval Task List", component: () => <div>Eval Task List v1</div> })
  api.registerPanelCommand({ id: "eval-task-list.open", title: "Open Eval Task List", panelId: "eval-task-list.panel" })
  api.registerLeftTab({ id: "eval-task-list.tab", title: "Eval Tasks", panelId: "eval-task-list.panel" })
  api.registerSurfaceResolver({ id: "eval-task-list.surface", kind: "eval-task-list.open", resolve: () => ({ id: "eval-task-list", component: "eval-task-list.panel", title: "Eval Task List" }) })
}
export default factory
\`\`\`

Do NOT use defineFrontPlugin and do NOT put systemPrompt in front code.

agent/index.ts requirements:
- default-export a Pi extension function
- register a tool named "task_list_status"
- the tool description must include "eval task list v1"
- execute returns text containing "task-list-agent-v1"

After writing the files, tell me to run /reload.
        `.trim(),
        // Outcome-based: the prompt suggests reading docs, but with the
        // bundled boring-plugin-authoring skill the agent may go straight
        // to writing. The post-write assertions below verify correctness
        // of the produced files, which is what actually matters.
        expect: [
          { tool: "write", params: { path: EvalRegex("eval-task-list/package\\.json$"), content: EvalRegex('"boring"') } },
          { tool: "write", params: { path: EvalRegex("eval-task-list/front/index\\.tsx$"), content: EvalRegex("BoringFrontFactory") } },
          { tool: "write", params: { path: EvalRegex("eval-task-list/agent/index\\.ts$"), content: EvalRegex("task_list_status") } },
        ],
        model: EVAL_MODEL,
        retries: 1,
        timeoutMs: 300_000,
      })

      expect(result.ok, formatFailure(result)).toBe(true)
      expect(existsSync(EVAL_PLUGIN_PACKAGE)).toBe(true)
      expect(existsSync(EVAL_PLUGIN_FRONT)).toBe(true)
      expect(existsSync(EVAL_PLUGIN_AGENT)).toBe(true)

      const packageJson = JSON.parse(readFileSync(EVAL_PLUGIN_PACKAGE, "utf8"))
      expect(packageJson).toMatchObject({
        boring: { front: "front/index.tsx", server: false },
        pi: {
          extensions: ["agent/index.ts"],
          systemPrompt: expect.stringContaining("v1"),
        },
      })

      const frontSource = readFileSync(EVAL_PLUGIN_FRONT, "utf8")
      expect(frontSource).toContain("BoringFrontFactory")
      expect(frontSource).toContain("registerPanel")
      expect(frontSource).toContain("registerPanelCommand")
      expect(frontSource).toContain("registerLeftTab")
      expect(frontSource).toContain("registerSurfaceResolver")
      expect(frontSource).not.toContain("defineFrontPlugin")

      const agentSource = readFileSync(EVAL_PLUGIN_AGENT, "utf8")
      expect(agentSource).toContain("task_list_status")
      expect(agentSource).toContain("task-list-agent-v1")

      const reloadOne = await app.inject({ method: "POST", url: "/api/v1/agent/reload", payload: {} })
      expect(reloadOne.statusCode).toBe(200)
      const listOne = await app.inject({ method: "GET", url: "/api/agent-plugins" })
      const pluginOne = listOne.json().find((plugin: { id: string }) => plugin.id === "eval-task-list")
      expect(pluginOne).toMatchObject({
        boring: { front: "front/index.tsx", server: false },
        pi: { systemPrompt: expect.stringContaining("v1") },
        revision: expect.any(Number),
      })
      expect(pluginOne.frontUrl).toContain("/@fs/")

      // Scenario A: front behavior changes and reload publishes a new revision.
      writeFileSync(
        EVAL_PLUGIN_FRONT,
        frontSource
          .replaceAll("Eval Task List v1", "Eval Task List v2")
          .replaceAll("Open Eval Task List", "Open Eval Task List v2"),
        "utf8",
      )
      const reloadFront = await app.inject({ method: "POST", url: "/api/v1/agent/reload", payload: {} })
      expect(reloadFront.statusCode).toBe(200)
      const pluginAfterFront = (await app.inject({ method: "GET", url: "/api/agent-plugins" }))
        .json()
        .find((plugin: { id: string }) => plugin.id === "eval-task-list")
      expect(pluginAfterFront.revision).toBeGreaterThan(pluginOne.revision)

      // Scenario B: agent-facing package metadata changes and reload reflects it.
      packageJson.pi.systemPrompt = "Eval task list plugin v2: use task_list_status for updated task list status."
      writeFileSync(EVAL_PLUGIN_PACKAGE, JSON.stringify(packageJson, null, 2), "utf8")
      writeFileSync(
        EVAL_PLUGIN_AGENT,
        agentSource.replaceAll("task-list-agent-v1", "task-list-agent-v2").replaceAll("eval task list v1", "eval task list v2"),
        "utf8",
      )
      const reloadAgent = await app.inject({ method: "POST", url: "/api/v1/agent/reload", payload: {} })
      expect(reloadAgent.statusCode).toBe(200)
      const pluginAfterAgent = (await app.inject({ method: "GET", url: "/api/agent-plugins" }))
        .json()
        .find((plugin: { id: string }) => plugin.id === "eval-task-list")
      expect(pluginAfterAgent.pi.systemPrompt).toContain("v2")
      expect(pluginAfterAgent.revision).toBeGreaterThan(pluginAfterFront.revision)
    },
    600_000,
  )

  test(
    "agent creates a CSV visualizer plugin with a table and chart that reloads cleanly",
    async () => {
      const result = await evalAgentPrompt({
        app,
        prompt: `
Create a hot-reloadable boring-ui CSV viewer plugin. Write exactly these files
under .pi/extensions/eval-csv-viz/ (do NOT run npm init / npm install / create
node_modules — this is a directory-source plugin):

1. .pi/extensions/eval-csv-viz/package.json with:
   { "name": "eval-csv-viz", "version": "1.0.0",
     "boring": { "front": "front/index.tsx", "server": false },
     "pi": { "systemPrompt": "CSV viewer plugin: opens .csv files in a panel." } }

2. .pi/extensions/eval-csv-viz/front/index.tsx — a BoringFrontFactory.
   The factory has the imperative signature \`(api) => void\` and calls
   \`api.registerPanel(...)\` and \`api.registerSurfaceResolver(...)\`. It
   must NOT return an object literal with "panels"/"surfaceResolvers"
   keys — the declarative shape is not supported.

   Example skeleton (fill in component body):
   \`\`\`tsx
   import React, { useState, useEffect } from "react"
   import {
     WORKSPACE_OPEN_PATH_SURFACE_KIND,
     type BoringFrontFactory,
     type PaneProps,
   } from "@hachej/boring-workspace"

   function CsvPane({ params }: PaneProps<{ path: string }>) {
     const [rows, setRows] = useState<string[][]>([])
     useEffect(() => {
       fetch(\`/api/v1/files/raw?path=\${encodeURIComponent(params.path)}\`)
         .then((r) => r.text())
         .then((text) => setRows(text.split(/\\r?\\n/).map((line) => line.split(","))))
     }, [params.path])
     // …render <table>…</table> and a simple <svg>…</svg> chart…
   }

   const factory: BoringFrontFactory = (api) => {
     api.registerPanel({ id: "eval-csv-viz.panel", label: "CSV Viz", component: CsvPane })
     api.registerSurfaceResolver({
       id: "eval-csv-viz.surface",
       kind: WORKSPACE_OPEN_PATH_SURFACE_KIND,
       resolve(req) {
         if (!req.path?.endsWith(".csv")) return null
         return { panelId: "eval-csv-viz.panel", params: { path: req.path } }
       },
     })
   }
   export default factory
   \`\`\`

   The panel must render the parsed rows as an HTML <table> AND a simple
   SVG bar/line chart below it (plain <svg> with <rect>/<line>/<polyline>
   — no external chart library). Do NOT use defineFrontPlugin, do NOT use
   globalThis.React, do NOT use <iframe>, do NOT import recharts.

After writing the files, tell me to run /reload.
        `.trim(),
        expect: [
          { tool: "write", params: { path: EvalRegex("eval-csv-viz/"), content: EvalRegex("BoringFrontFactory|boring") } },
        ],
        model: EVAL_MODEL,
        retries: 0,
        timeoutMs: 600_000,
      })

      expect(result.ok, formatFailure(result)).toBe(true)
      expect(existsSync(EVAL_CSV_PLUGIN_PACKAGE)).toBe(true)

      const packageJson = JSON.parse(readFileSync(EVAL_CSV_PLUGIN_PACKAGE, "utf8"))
      expect(packageJson.name).toBe("eval-csv-viz")
      expect(packageJson.boring ?? {}).not.toHaveProperty("panels")
      expect(packageJson.boring ?? {}).not.toHaveProperty("commands")

      // Manifest-first OR convention: skill allows omitting boring.front
      // when the template layout (front/index.tsx) is used.
      const declaredFront: string | undefined = packageJson.boring?.front
      const candidateFronts = declaredFront
        ? [declaredFront]
        : ["front/index.tsx", "front/index.ts", "src/front/index.tsx", "src/front/index.ts"]
      const frontPath = candidateFronts.map((p) => join(EVAL_CSV_PLUGIN_DIR, p)).find((p) => existsSync(p))
      expect(frontPath, `no front entry found (tried: ${candidateFronts.join(", ")})`).toBeTruthy()
      const frontSource = readFileSync(frontPath!, "utf8")
      expect(frontSource).toContain("BoringFrontFactory")
      expect(frontSource).toContain("useState")
      expect(frontSource).toContain("useEffect")
      expect(frontSource).toContain("/api/v1/files/raw")
      expect(frontSource).toContain("WORKSPACE_OPEN_PATH_SURFACE_KIND")
      expect(frontSource).toContain("registerPanel")
      expect(frontSource).toContain("registerSurfaceResolver")
      expect(frontSource).toMatch(/registerPanel\s*\(\s*\{/)
      expect(frontSource).toMatch(/<table|React\.createElement\(["']table["']/)
      expect(frontSource).toMatch(/CSV Chart|chart/i)
      expect(frontSource).not.toContain("defineFrontPlugin")
      expect(frontSource).not.toContain("@hachej/boring-workspace/shared")
      expect(frontSource).not.toContain("globalThis.React")
      expect(frontSource).not.toContain("extends React.Component")
      expect(frontSource).not.toContain("<iframe")
      expect(frontSource).not.toContain("recharts")

      const reload = await app.inject({ method: "POST", url: "/api/v1/agent/reload", payload: {} })
      expect(reload.statusCode).toBe(200)
      const list = await app.inject({ method: "GET", url: "/api/agent-plugins" })
      const plugin = list.json().find((entry: { id: string }) => entry.id === "eval-csv-viz")
      expect(plugin).toBeTruthy()
      expect(plugin.revision).toEqual(expect.any(Number))
      expect(plugin.frontUrl).toContain("/@fs/")
    },
    600_000,
  )

  test(
    "agent recovers a plugin from a /reload error (malformed package.json)",
    async () => {
      // Plant a working plugin first.
      const pluginDir = join(WORKSPACE_PKG_ROOT, ".pi", "extensions", "eval-recover")
      const pkgPath = join(pluginDir, "package.json")
      const frontPath = join(pluginDir, "front", "index.tsx")
      rmSync(pluginDir, { recursive: true, force: true })
      const { mkdirSync } = await import("node:fs")
      mkdirSync(join(pluginDir, "front"), { recursive: true })
      writeFileSync(
        pkgPath,
        JSON.stringify({
          name: "eval-recover",
          version: "1.0.0",
          boring: { front: "front/index.tsx", server: false },
          pi: { systemPrompt: "Eval recover plugin." },
        }),
        "utf8",
      )
      writeFileSync(
        frontPath,
        "export default function (api) { api.registerPanel({ id: 'eval-recover.panel', label: 'Recover', component: () => null }) }",
        "utf8",
      )

      // Baseline reload works.
      const baseline = await app.inject({ method: "POST", url: "/api/v1/agent/reload", payload: {} })
      expect(baseline.statusCode).toBe(200)

      // Corrupt package.json — asset manager's preflight catches this on
      // /reload and surfaces it as a 422 with a structured diagnostic
      // (INVALID_PACKAGE_JSON) the agent can read.
      writeFileSync(pkgPath, "{ not json at all", "utf8")
      const failed = await app.inject({ method: "POST", url: "/api/v1/agent/reload", payload: {} })
      expect(failed.statusCode).toBe(422)
      const failedBody = failed.json() as { error?: string }
      expect(failedBody.error).toMatch(/INVALID_PACKAGE_JSON|eval-recover/i)

      // Ask the agent to fix it.
      const result = await evalAgentPrompt({
        app,
        prompt: `
The plugin at .pi/extensions/eval-recover/package.json is malformed.
/reload returned this error:

  ${failedBody.error}

Replace package.json with a valid JSON matching this shape:
  { "name": "eval-recover", "version": "1.0.0",
    "boring": { "front": "front/index.tsx", "server": false },
    "pi": { "systemPrompt": "Eval recover plugin." } }
Then run /reload to verify.
        `.trim(),
        expect: [
          { tool: "write", params: { path: EvalRegex("eval-recover/package\\.json$"), content: EvalRegex('"name"') } },
        ],
        model: EVAL_MODEL,
        retries: 1,
        timeoutMs: 300_000,
      })
      expect(result.ok, formatFailure(result)).toBe(true)

      // Reload after the fix succeeds.
      const recovered = await app.inject({ method: "POST", url: "/api/v1/agent/reload", payload: {} })
      expect(recovered.statusCode).toBe(200)

      rmSync(pluginDir, { recursive: true, force: true })
    },
    600_000,
  )
})

function formatFailure(result: { ok: boolean; reason?: string; text?: string; actual: Array<{ tool: string }> }): string {
  const tools = result.actual.map((c) => c.tool).join(", ") || "(none)"
  const text = result.text ? `; text: ${result.text.slice(0, 500)}` : ""
  return result.reason ? `${result.reason}${text}` : `tools called: ${tools}${text}`
}
