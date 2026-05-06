/**
 * Eval: plugin creation via the boring-ui agent.
 *
 * Three properties verified end-to-end:
 *
 *   1. Doc access — agent reads plugins.md / bridge.md when asked domain
 *      questions (proves the boring-ui system prompt is live and paths resolve).
 *
 *   2. Comprehensive plugin creation — agent builds a plugin covering every
 *      boring-ui output type: panel, command, left-tab, surface-resolver, and
 *      systemPrompt. Doc reads are required before writing.
 *
 *   3. Compilation — after the agent writes the file, tsc --noEmit runs against
 *      the actual workspace tsconfig.front.json. A pass means the plugin is
 *      real TypeScript that the workspace can consume, not just plausible text.
 *
 * The plugin is written into src/plugins/evalTaskListPlugin/ inside the actual
 * workspace package so the TypeScript compiler sees the real @boring/workspace
 * types. It is deleted in afterAll regardless of pass/fail.
 *
 * Gated on OPENROUTER_API_KEY — skipped silently in CI without it.
 * Run manually:
 *   OPENROUTER_API_KEY=sk-or-v1-... pnpm --filter @boring/workspace test src/eval/__tests__/plugin-creation.test.ts
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest"
import { existsSync, readFileSync, rmSync } from "node:fs"
import { execSync } from "node:child_process"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { createAgentApp } from "@boring/agent/server"
import { evalAgentPrompt, EvalRegex } from "@boring/agent/eval"
import type { FastifyInstance } from "fastify"
import { buildBoringSystemPrompt } from "../../server/boringSystemPrompt"

const EVAL_MODEL = { provider: "openrouter", id: "qwen/qwen3.5-35b-a3b" } as const

const HAS_KEY = !!process.env.OPENROUTER_API_KEY
const describeIf = HAS_KEY ? describe : describe.skip

// The workspace package root — agent writes plugin source here so tsc can
// resolve @boring/workspace relative imports with real types.
const WORKSPACE_PKG_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../",
)
const EVAL_PLUGIN_DIR = join(
  WORKSPACE_PKG_ROOT,
  "src/plugins/evalTaskListPlugin",
)

describeIf("plugin-creation eval (live LLM)", () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await createAgentApp({
      workspaceRoot: WORKSPACE_PKG_ROOT,
      mode: "direct",
      logger: false,
      systemPromptAppend: buildBoringSystemPrompt(),
    })
    return async () => {
      await app.close()
    }
  }, 30_000)

  afterAll(() => {
    // Clean up regardless of test outcome
    if (existsSync(EVAL_PLUGIN_DIR)) {
      rmSync(EVAL_PLUGIN_DIR, { recursive: true, force: true })
    }
  })

  // ── 1. Doc pointer: plugins.md ─────────────────────────────────────────────

  test(
    "reads plugins.md when asked about plugin creation",
    async () => {
      const result = await evalAgentPrompt({
        app,
        prompt:
          "I want to understand the boring-ui plugin API. " +
          "Read the plugin documentation before answering.",
        expect: { tool: "read", params: { path: EvalRegex("plugins\\.md$") } },
        model: EVAL_MODEL,
        retries: 1,
        timeoutMs: 60_000,
      })
      expect(result.ok, formatFailure(result)).toBe(true)
    },
    120_000,
  )

  // ── 2. Doc pointer: bridge.md ──────────────────────────────────────────────

  test(
    "reads bridge.md when asked how to open a panel from the agent",
    async () => {
      const result = await evalAgentPrompt({
        app,
        prompt:
          "How do I open a panel from the agent using exec_ui? " +
          "Read the docs first, then explain.",
        expect: { tool: "read", params: { path: EvalRegex("bridge\\.md$") } },
        model: EVAL_MODEL,
        retries: 1,
        timeoutMs: 60_000,
      })
      expect(result.ok, formatFailure(result)).toBe(true)
    },
    120_000,
  )

  // ── 3. Full plugin: all output types + compilation ─────────────────────────

  test(
    "creates a complete plugin with all output types and it compiles",
    async () => {
      // Step 1 — agent writes the plugin
      const result = await evalAgentPrompt({
        app,
        prompt: `
Create a new boring-ui plugin called "task-list" at:
  src/plugins/evalTaskListPlugin/front/index.tsx

Read docs/plugins.md and docs/panels.md before writing any code.

The plugin must include ALL of the following:
1. A center panel (id: "task-list-panel", component: TaskListPane) that renders a basic task list
2. A command palette entry that opens the panel (title: "Open Task List")
3. A left sidebar tab (id: "task-list-tab") with a list icon
4. A surface-resolver that maps kind "task-list.open" to the task-list-panel
5. A systemPrompt field that teaches the agent how to open the panel

IMPORTANT — import paths: the file is at src/plugins/evalTaskListPlugin/front/index.tsx.
To reach workspace internals use THREE levels up (../../../), not two:
  - ../../../front/registry/types   → for definePanel, PaneProps
  - ../../../shared/plugins/defineFrontPlugin → for defineFrontPlugin
  - ../../../shared/plugins/types   → for PluginOutput
Export the plugin as a named export: export const taskListPlugin.
        `.trim(),
        expect: [
          { tool: "read", params: { path: EvalRegex("plugins\\.md$") } },
          { tool: "read", params: { path: EvalRegex("panels\\.md$") } },
          {
            tool: "write",
            params: {
              path: EvalRegex("evalTaskListPlugin"),
              content: EvalRegex("defineFrontPlugin"),
            },
          },
        ],
        model: EVAL_MODEL,
        retries: 1,
        timeoutMs: 240_000,
      })

      expect(result.ok, formatFailure(result)).toBe(true)

      // Step 2 — verify the file was written
      const pluginFile = join(EVAL_PLUGIN_DIR, "front", "index.tsx")
      expect(existsSync(pluginFile), `plugin file not found at ${pluginFile}`).toBe(true)

      // Step 3 — verify all output types are present in the source
      const content = readFileSync(pluginFile, "utf8")
      const checks: Array<[string, RegExp]> = [
        ["defineFrontPlugin call",   /defineFrontPlugin/],
        ["definePanel call",         /definePanel/],
        ["panel output type",        /type:\s*["']panel["']/],
        ["command output type",      /type:\s*["']command["']/],
        ["left-tab output type",     /type:\s*["']left-tab["']/],
        ["surface-resolver type",    /type:\s*["']surface-resolver["']/],
        ["systemPrompt field",       /systemPrompt/],
        ["taskListPlugin export",    /taskListPlugin/],
      ]
      for (const [label, pattern] of checks) {
        expect(content, `missing: ${label}`).toMatch(pattern)
      }

      // Step 4 — compile with the real workspace tsconfig.
      // Filter output to only evalTaskListPlugin errors — pre-existing
      // failures elsewhere in the workspace are not this eval's concern.
      let tscError: string | undefined
      try {
        execSync("pnpm exec tsc --noEmit -p tsconfig.front.json", {
          cwd: WORKSPACE_PKG_ROOT,
          stdio: "pipe",
          timeout: 60_000,
        })
      } catch (err) {
        const e = err as { stdout?: Buffer; stderr?: Buffer }
        const raw = [e.stdout?.toString(), e.stderr?.toString()]
          .filter(Boolean)
          .join("\n")
        const pluginErrors = raw
          .split("\n")
          .filter((line) => line.includes("evalTaskListPlugin"))
          .join("\n")
          .trim()
        if (pluginErrors) tscError = pluginErrors
      }

      expect(
        tscError,
        `plugin does not type-check:\n${tscError}`,
      ).toBeUndefined()
    },
    480_000,
  )
})

// ── helpers ────────────────────────────────────────────────────────────────

function formatFailure(result: {
  ok: boolean
  reason?: string
  actual: Array<{ tool: string }>
}): string {
  return (
    result.reason ??
    `tools called: ${result.actual.map((c) => c.tool).join(", ") || "(none)"}`
  )
}
