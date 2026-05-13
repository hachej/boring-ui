/**
 * Eval: package-shaped plugin creation and reload via the boring-ui agent.
 *
 * Gated on OPENROUTER_API_KEY — skipped silently in CI without it.
 * Run manually:
 *   OPENROUTER_API_KEY=sk-or-v1-... pnpm --filter @hachej/boring-workspace test src/eval/__tests__/plugin-creation.test.ts
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { evalAgentPrompt, EvalRegex } from "@hachej/boring-agent/eval"
import type { FastifyInstance } from "fastify"
import { createWorkspaceAgentServer } from "../../app/server/createWorkspaceAgentServer"

const EVAL_MODEL = { provider: "openrouter", id: "qwen/qwen3.5-35b-a3b" } as const
const HAS_KEY = !!process.env.OPENROUTER_API_KEY
const describeIf = HAS_KEY ? describe : describe.skip

const WORKSPACE_PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../")
const EVAL_PLUGIN_DIR = join(WORKSPACE_PKG_ROOT, ".pi", "extensions", "eval-task-list")
const EVAL_PLUGIN_FRONT = join(EVAL_PLUGIN_DIR, "front", "index.tsx")
const EVAL_PLUGIN_AGENT = join(EVAL_PLUGIN_DIR, "agent", "index.ts")
const EVAL_PLUGIN_PACKAGE = join(EVAL_PLUGIN_DIR, "package.json")

describeIf("package plugin creation + reload eval (live LLM)", () => {
  let app: FastifyInstance

  beforeAll(async () => {
    rmSync(EVAL_PLUGIN_DIR, { recursive: true, force: true })
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

front/index.tsx requirements:
- default-export a BoringFrontFactory from @hachej/boring-workspace/plugin
- register one panel id "eval-task-list.panel" rendering text "Eval Task List v1"
- register one panel command with id "eval-task-list.open" titled "Open Eval Task List" and panelId "eval-task-list.panel"
- register one left tab id "eval-task-list.tab" titled "Eval Tasks"
- register one surface resolver id "eval-task-list.surface" for kind "eval-task-list.open"
- do NOT use defineFrontPlugin and do NOT put systemPrompt in front code

agent/index.ts requirements:
- default-export a Pi extension function
- register a tool named "task_list_status"
- the tool description must include "eval task list v1"
- execute returns text containing "task-list-agent-v1"

After writing the files, tell me to run /reload.
        `.trim(),
        expect: [
          { tool: "read", params: { path: EvalRegex("plugins\\.md$") } },
          { tool: "read", params: { path: EvalRegex("panels\\.md$") } },
          { tool: "write", params: { path: EvalRegex("eval-task-list/package\\.json$"), content: EvalRegex('"boring"') } },
          { tool: "write", params: { path: EvalRegex("eval-task-list/front/index\\.tsx$"), content: EvalRegex("BoringFrontFactory") } },
          { tool: "write", params: { path: EvalRegex("eval-task-list/agent/index\\.ts$"), content: EvalRegex("task_list_status") } },
        ],
        model: EVAL_MODEL,
        retries: 1,
        timeoutMs: 300_000,
      })

      expect(result.ok, formatFailure(result)).toBe(true)
      expect(result.text).toContain("/reload")
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
})

function formatFailure(result: { ok: boolean; reason?: string; actual: Array<{ tool: string }> }): string {
  return result.reason ?? `tools called: ${result.actual.map((c) => c.tool).join(", ") || "(none)"}`
}
