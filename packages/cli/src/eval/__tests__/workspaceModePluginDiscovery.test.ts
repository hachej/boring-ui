import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "vitest"
import { evalAgentPrompt, EvalRegex } from "@hachej/boring-agent/eval"
import { createWorkspacesModeApp } from "../../server/cli.js"
import { createLocalWorkspaceRegistry } from "../../server/localWorkspaces.js"

const FORCED_EVAL_MODEL = process.env.BORING_EVAL_MODEL_PROVIDER && process.env.BORING_EVAL_MODEL_ID
  ? [{ provider: process.env.BORING_EVAL_MODEL_PROVIDER, id: process.env.BORING_EVAL_MODEL_ID }]
  : null

const ENABLED_MODELS = FORCED_EVAL_MODEL ?? (
  [
    process.env.GEMINI_API_KEY ? ({ provider: "google", id: "gemini-2.5-flash" } as const) : null,
    process.env.ANTHROPIC_API_KEY ? ({ provider: "anthropic", id: "claude-sonnet-4-6" } as const) : null,
    process.env.OPENROUTER_API_KEY ? ({ provider: "openrouter", id: process.env.BORING_EVAL_OPENROUTER_MODEL ?? "qwen/qwen3.6-plus" } as const) : null,
  ].filter(Boolean) as Array<{ provider: string; id: string }>
)
const describeIf = ENABLED_MODELS.length > 0
  ? describe.each(ENABLED_MODELS)
  : describe.skip.each([{ provider: "none", id: "none" }] as Array<{ provider: string; id: string }>)

const tempDirs: string[] = []

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describeIf("CLI workspaces-mode plugin discovery eval (live LLM) [$provider/$id]", (EVAL_MODEL) => {
  test("agent-created workspace plugin is detected and loaded after /reload", async () => {
    const workspaceRoot = await makeTempDir("boring-cli-eval-workspace-")
    const registryDir = await makeTempDir("boring-cli-eval-registry-")
    await mkdir(workspaceRoot, { recursive: true })

    const registryPath = join(registryDir, "workspaces.yaml")
    const registry = createLocalWorkspaceRegistry(registryPath)
    const workspace = await registry.add(workspaceRoot)
    const app = await createWorkspacesModeApp({ mode: "direct", registryPath })

    try {
      const result = await evalAgentPrompt({
        app,
        query: { workspaceId: workspace.id },
        prompt: [
          "Create a hot-reloadable boring-ui plugin named `eval-cli-detect`.",
          "First run `boring-ui-plugin status --json` and only continue if workspaceLocalPluginRoots is true.",
          "Then scaffold it with `boring-ui-plugin scaffold eval-cli-detect \"$BORING_AGENT_WORKSPACE_ROOT\"`.",
          "Keep the generated panel simple; it just needs to show the text `Eval CLI Detect`.",
          "When done, ask me to run /reload.",
        ].join("\n"),
        expect: [
          { tool: "bash", params: { command: EvalRegex("boring-ui-plugin\\s+status\\s+--json") } },
          { tool: "bash", params: { command: EvalRegex("boring-ui-plugin\\s+scaffold\\s+eval-cli-detect") } },
        ],
        model: EVAL_MODEL,
        retries: 1,
        timeoutMs: 300_000,
      })

      expect(result.ok, formatFailure(result)).toBe(true)

      const reload = await app.inject({
        method: "POST",
        url: `/api/v1/agent/reload?workspaceId=${encodeURIComponent(workspace.id)}`,
        payload: {},
      })
      expect(reload.statusCode, reload.body).toBe(200)

      const list = await app.inject({
        method: "GET",
        url: `/api/v1/agent-plugins?workspaceId=${encodeURIComponent(workspace.id)}`,
      })
      expect(list.statusCode).toBe(200)
      const plugin = (list.json() as Array<{ id: string; frontTarget?: { entryUrl?: string } }>).find((entry) => entry.id === "eval-cli-detect")
      expect(plugin, JSON.stringify(list.json(), null, 2)).toBeTruthy()
      expect(plugin?.frontTarget?.entryUrl).toBeTruthy()
    } finally {
      await app.close()
    }
  }, 600_000)
})

function formatFailure(result: { reason?: string; text: string; actual: unknown; attempts: number }): string {
  return [
    result.reason ? `reason: ${result.reason}` : undefined,
    `attempts: ${result.attempts}`,
    `text: ${result.text}`,
    `actual: ${JSON.stringify(result.actual, null, 2)}`,
  ].filter(Boolean).join("\n")
}
