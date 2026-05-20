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

// Matrix mode: iterate over EVERY provider whose API key is present.
// Previously priority-based (Gemini > Anthropic > OpenRouter), which
// meant CI with both keys set only exercised one model — the dual-
// provider eval claim in the PR description was vacuous. Now each
// provider becomes its own describe.each row, so CI runs the whole
// suite under each model.
const ENABLED_MODELS = (
  [
    process.env.GEMINI_API_KEY ? ({ provider: "google", id: "gemini-2.5-flash" } as const) : null,
    process.env.ANTHROPIC_API_KEY ? ({ provider: "anthropic", id: "claude-sonnet-4-6" } as const) : null,
    process.env.OPENROUTER_API_KEY ? ({ provider: "openrouter", id: "qwen/qwen3.6-plus" } as const) : null,
  ].filter(Boolean) as Array<{ provider: string; id: string }>
)
const HAS_KEY = ENABLED_MODELS.length > 0
const describeIf = HAS_KEY ? describe.each(ENABLED_MODELS) : describe.skip.each([{ provider: "none", id: "none" }] as Array<{ provider: string; id: string }>)

const WORKSPACE_PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../")
const EVAL_PLUGIN_DIR = join(WORKSPACE_PKG_ROOT, ".pi", "extensions", "eval-task-list")
const EVAL_PLUGIN_FRONT = join(EVAL_PLUGIN_DIR, "front", "index.tsx")
const EVAL_PLUGIN_AGENT = join(EVAL_PLUGIN_DIR, "agent", "index.ts")
const EVAL_PLUGIN_PACKAGE = join(EVAL_PLUGIN_DIR, "package.json")

const EVAL_CSV_PLUGIN_DIR = join(WORKSPACE_PKG_ROOT, ".pi", "extensions", "eval-csv-viz")
const EVAL_CSV_PLUGIN_PACKAGE = join(EVAL_CSV_PLUGIN_DIR, "package.json")

const EVAL_MIN_PLUGIN_DIR = join(WORKSPACE_PKG_ROOT, ".pi", "extensions", "eval-min-tasks")
const EVAL_MIN_PLUGIN_PACKAGE = join(EVAL_MIN_PLUGIN_DIR, "package.json")

const EVAL_SPLIT_DIR = join(WORKSPACE_PKG_ROOT, ".pi", "extensions", "eval-split-files")
const EVAL_SPLIT_PACKAGE = join(EVAL_SPLIT_DIR, "package.json")

const EVAL_REFINE_DIR = join(WORKSPACE_PKG_ROOT, ".pi", "extensions", "eval-refine")
const EVAL_REFINE_PACKAGE = join(EVAL_REFINE_DIR, "package.json")
const EVAL_REFINE_FRONT = join(EVAL_REFINE_DIR, "front", "index.tsx")

const EVAL_CROSS_DIR = join(WORKSPACE_PKG_ROOT, ".pi", "extensions", "eval-cross")
const EVAL_CROSS_PACKAGE = join(EVAL_CROSS_DIR, "package.json")

describeIf("package plugin creation + reload eval (live LLM) [$provider/$id]", (EVAL_MODEL) => {
  let app: FastifyInstance

  const cleanupDirs = [
    EVAL_PLUGIN_DIR,
    EVAL_CSV_PLUGIN_DIR,
    EVAL_MIN_PLUGIN_DIR,
    EVAL_SPLIT_DIR,
    EVAL_REFINE_DIR,
    EVAL_CROSS_DIR,
  ]

  beforeAll(async () => {
    for (const dir of cleanupDirs) rmSync(dir, { recursive: true, force: true })
    app = await createWorkspaceAgentServer({
      workspaceRoot: WORKSPACE_PKG_ROOT,
      mode: "direct",
      logger: false,
      provisionWorkspace: false,
    })
  }, 30_000)

  afterAll(async () => {
    if (app) await app.close()
    for (const dir of cleanupDirs) rmSync(dir, { recursive: true, force: true })
  })

  test(
    "agent creates a package plugin, /reload discovers it, and later front/agent metadata changes reload",
    async () => {
      const result = await evalAgentPrompt({
        app,
        prompt: [
          "Build me a task-list plugin. Call it `eval-task-list`. I want a",
          "panel labeled \"Eval Task List\" and a Pi agent tool I can call",
          "from chat to check my task-list status.",
          "",
          "When you're done, ask me to run /reload.",
        ].join("\n"),
        // Outcome-based: the prompt suggests reading docs, but with the
        // bundled boring-plugin-authoring skill the agent may go straight
        // to writing. The post-write assertions below verify correctness
        // of the produced files, which is what actually matters.
        // Outcome-based: with the scaffold-plugin CLI available, the
        // agent may create the initial files via `bash` instead of
        // direct `write` calls. The file-on-disk assertions below are
        // the real check.
        expect: [],
        model: EVAL_MODEL,
        retries: 1,
        timeoutMs: 300_000,
      })

      expect(result.ok, formatFailure(result)).toBe(true)
      expect(existsSync(EVAL_PLUGIN_PACKAGE), "agent did not produce a package.json").toBe(true)

      // /reload discovers the plugin — the headline test point.
      const reloadOne = await app.inject({ method: "POST", url: "/api/v1/agent/reload", payload: {} })
      expect(reloadOne.statusCode).toBe(200)
      const pluginOne = (await app.inject({ method: "GET", url: "/api/agent-plugins" }))
        .json()
        .find((plugin: { id: string }) => plugin.id === "eval-task-list")
      expect(pluginOne, "plugin not discovered after /reload").toBeTruthy()
      expect(pluginOne.revision).toEqual(expect.any(Number))
      expect(pluginOne.frontUrl).toContain("/@fs/")

      // Scenario A: front behavior changes via a direct disk write that
      // perturbs content (don't rely on the agent having used any specific
      // marker text). Resolve the front file from the manifest the agent
      // declared, then append → mtime+content both change → revision bumps.
      const frontPath = pluginOne.boring?.front
        ? join(EVAL_PLUGIN_DIR, pluginOne.boring.front)
        : EVAL_PLUGIN_FRONT
      const frontBefore = readFileSync(frontPath, "utf8")
      writeFileSync(frontPath, `${frontBefore}\n// eval scenario A: front edit\n`, "utf8")
      const reloadFront = await app.inject({ method: "POST", url: "/api/v1/agent/reload", payload: {} })
      expect(reloadFront.statusCode).toBe(200)
      const pluginAfterFront = (await app.inject({ method: "GET", url: "/api/agent-plugins" }))
        .json()
        .find((plugin: { id: string }) => plugin.id === "eval-task-list")
      expect(pluginAfterFront.revision).toBeGreaterThan(pluginOne.revision)

      // Scenario B: package metadata change reflects through /reload.
      // We overwrite systemPrompt with a known marker — independent of
      // whatever the agent chose to put there originally.
      const packageJson = JSON.parse(readFileSync(EVAL_PLUGIN_PACKAGE, "utf8"))
      packageJson.pi = packageJson.pi ?? {}
      packageJson.pi.systemPrompt = "EVAL-SCENARIO-B-MARKER: metadata edit reload check"
      writeFileSync(EVAL_PLUGIN_PACKAGE, JSON.stringify(packageJson, null, 2), "utf8")
      const reloadAgent = await app.inject({ method: "POST", url: "/api/v1/agent/reload", payload: {} })
      expect(reloadAgent.statusCode).toBe(200)
      const pluginAfterAgent = (await app.inject({ method: "GET", url: "/api/agent-plugins" }))
        .json()
        .find((plugin: { id: string }) => plugin.id === "eval-task-list")
      expect(pluginAfterAgent.pi?.systemPrompt).toContain("EVAL-SCENARIO-B-MARKER")
      expect(pluginAfterAgent.revision).toBeGreaterThan(pluginAfterFront.revision)
    },
    600_000,
  )

  test(
    "agent creates a CSV visualizer plugin with a table and chart that reloads cleanly",
    async () => {
      const result = await evalAgentPrompt({
        app,
        prompt: [
          "Make a CSV viewer plugin. Call it `eval-csv-viz`. When I open a",
          ".csv file from the file tree, open it in a panel that fetches the",
          "file contents, parses the rows, and shows them in a real HTML",
          "<table> with a small <svg> chart below. No chart libraries —",
          "I want plain SVG.",
          "",
          "When you're done, ask me to run /reload.",
        ].join("\n"),
        // Outcome-based: agents may use bash (scaffold-plugin) instead of
        // direct write tool calls. The file-on-disk assertions below are
        // the real check.
        expect: [],
        model: EVAL_MODEL,
        retries: 1,
        timeoutMs: 600_000,
      })

      expect(result.ok, formatFailure(result)).toBe(true)
      expect(existsSync(EVAL_CSV_PLUGIN_PACKAGE), "agent did not produce a package.json").toBe(true)

      const packageJson = JSON.parse(readFileSync(EVAL_CSV_PLUGIN_PACKAGE, "utf8"))
      expect(packageJson.name).toBe("eval-csv-viz")

      // Locate the front file from the manifest the agent declared, or
      // fall back to the conventional layout.
      const declaredFront: string | undefined = packageJson.boring?.front
      const candidateFronts = declaredFront
        ? [declaredFront]
        : ["front/index.tsx", "front/index.ts", "src/front/index.tsx", "src/front/index.ts"]
      const frontPath = candidateFronts.map((p) => join(EVAL_CSV_PLUGIN_DIR, p)).find((p) => existsSync(p))
      expect(frontPath, `no front entry found (tried: ${candidateFronts.join(", ")})`).toBeTruthy()
      const frontSource = readFileSync(frontPath!, "utf8")

      // User-observable: table renders the CSV rows.
      // Accept JSX (`<table>`), member-access (`React.createElement("table"...)`),
      // and the named-import form (`createElement("table"...)`).
      expect(
        frontSource,
        "user asked for a table; no <table> rendering found",
      ).toMatch(/<table|createElement\(["']table["']/)
      // User-observable: SVG chart (NOT a chart library).
      expect(frontSource, "user asked for a chart; no <svg> found").toMatch(/<svg|createElement\(["']svg["']/)
      // User explicitly said "no chart libraries" — verify.
      expect(frontSource).not.toContain("recharts")
      expect(frontSource).not.toContain('from "d3"')
      expect(frontSource).not.toContain("from 'd3'")

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
      // /reload. Per DESIGN.md §4.5 the agent route (/api/v1/agent/reload)
      // tolerates per-plugin failures (returns 200; the diagnostic is
      // surfaced via SSE error events + the .error file). The
      // workspace-owned route (/api/boring.reload) returns 422 with the
      // structured diagnostic the agent can act on.
      writeFileSync(pkgPath, "{ not json at all", "utf8")
      const agentReload = await app.inject({ method: "POST", url: "/api/v1/agent/reload", payload: {} })
      expect(agentReload.statusCode).toBe(200)
      const boringReload = await app.inject({ method: "POST", url: "/api/boring.reload", payload: {} })
      expect(boringReload.statusCode).toBe(422)
      const failedBody = boringReload.json() as { errors?: Array<{ message: string }> }
      const errorMessage = (failedBody.errors ?? []).map((e) => e.message).join("\n")
      expect(errorMessage).toMatch(/INVALID_PACKAGE_JSON|eval-recover/i)

      // Ask the agent to fix it.
      const result = await evalAgentPrompt({
        app,
        prompt: `
The plugin at .pi/extensions/eval-recover/package.json is malformed.
/reload returned this error:

  ${errorMessage}

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

      // Reload after the fix succeeds on BOTH routes.
      const recovered = await app.inject({ method: "POST", url: "/api/boring.reload", payload: {} })
      expect(recovered.statusCode).toBe(200)

      rmSync(pluginDir, { recursive: true, force: true })
    },
    600_000,
  )

  // Eval #1 from the roadmap: skill-only path. The prompt deliberately
  // contains NO skeleton, NO file shape, NO type names — only the user
  // intent. If the bundled boring-plugin-authoring skill is self-
  // sufficient, the agent should read it and produce a working plugin.
  // If this fails, the skill needs to be strengthened.
  test(
    "minimal prompt + bundled skill is enough to produce a working plugin",
    async () => {
      const result = await evalAgentPrompt({
        app,
        prompt: [
          "Create a hot-reloadable boring-ui plugin under",
          "`.pi/extensions/eval-min-tasks/` (use that exact unscoped package",
          "name in package.json — no leading @scope) that opens a panel",
          "showing a simple todo list (a static <ul> with 3 hard-coded items",
          "is fine for v1).",
          "",
          "After writing the files, tell me to run /reload.",
        ].join("\n"),
        // Skill-only path: outcome > mechanism. We don't care whether
        // the agent uses write/bash/sed — only whether the files exist
        // and reload succeeds. expect=[] disables tool-shape assertion.
        expect: [],
        model: EVAL_MODEL,
        retries: 1,
        timeoutMs: 300_000,
      })

      // Diagnostic: log the tool call sequence so we can verify the agent
      // actually loaded the boring-plugin-authoring skill (which is the
      // whole premise of the "skill-only" path).
      const toolSequence = result.actual.map((c) => c.tool).join(", ")
      const readCalls = result.actual
        .filter((c) => c.tool === "read")
        .map((c) => String(c.params.path ?? c.params.file_path ?? ""))
      const loadedSkill = readCalls.some((p) => p.includes("boring-plugin-authoring"))
      // eslint-disable-next-line no-console
      console.log(`[minimal-eval diag][${EVAL_MODEL.provider}] tools: ${toolSequence}`)
      // eslint-disable-next-line no-console
      console.log(`[minimal-eval diag][${EVAL_MODEL.provider}] read paths: ${JSON.stringify(readCalls)}`)
      // eslint-disable-next-line no-console
      console.log(`[minimal-eval diag][${EVAL_MODEL.provider}] loaded boring-plugin-authoring skill: ${loadedSkill}`)
      // Soft signal — we DON'T hard-assert loadedSkill because the system
      // prompt now inlines the canonical shape, so the agent can succeed
      // without reading the skill. If the metric drops to 0%, that means
      // the skill is dead weight and we should either delete it or
      // strengthen the prompt's pointer to it.
      trackAttempts(EVAL_MODEL.provider, "minimal-prompt", result.attempts)

      // result.ok with expect=[] just means the turn completed; the real
      // assertions are the file-on-disk + /reload checks below.
      expect(result.ok, formatFailure(result)).toBe(true)
      expect(existsSync(EVAL_MIN_PLUGIN_PACKAGE), "agent did not produce eval-min-tasks/package.json").toBe(true)

      const packageJson = JSON.parse(readFileSync(EVAL_MIN_PLUGIN_PACKAGE, "utf8"))
      expect(packageJson.name).toBe("eval-min-tasks")
      const declaredFront: string | undefined = packageJson.boring?.front
      // boring.front in package.json is authoritative. If the agent
      // chose a custom layout (e.g. src/TodoPanel.tsx), accept it as
      // long as the manifest declares it.
      const candidateFronts = declaredFront
        ? [declaredFront]
        : [
            "front/index.tsx", "front/index.ts",
            "src/front/index.tsx", "src/front/index.ts",
            "src/index.tsx", "src/index.ts",
          ]
      const frontPath = candidateFronts
        .map((p) => join(EVAL_MIN_PLUGIN_DIR, p))
        .find((p) => existsSync(p))
      const { readdirSync } = await import("node:fs")
      const dirListing = (): string => {
        try {
          return JSON.stringify(walkSync(EVAL_MIN_PLUGIN_DIR), null, 2)
        } catch (error) {
          return `(unreadable: ${error instanceof Error ? error.message : String(error)})`
        }
      }
      function walkSync(root: string): Record<string, unknown> {
        const out: Record<string, unknown> = {}
        for (const entry of readdirSync(root, { withFileTypes: true })) {
          out[entry.name] = entry.isDirectory() ? walkSync(join(root, entry.name)) : "<file>"
        }
        return out
      }
      expect(frontPath, `no front entry found (tried: ${candidateFronts.join(", ")}); dir contents:\n${dirListing()}`).toBeTruthy()

      const frontSource = readFileSync(frontPath!, "utf8")
      // Two equivalent shapes accepted: declarative definePlugin({panels: [...]})
      // OR definePlugin({ setup: (api) => api.registerPanel(...) }).
      expect(frontSource).toMatch(/definePlugin|BoringFrontFactory/)
      expect(frontSource).toMatch(/registerPanel|panels\s*:/)
      expect(frontSource).not.toContain("defineFrontPlugin")
      // Loosely check the agent rendered a list-like structure.
      // Accept JSX (`<ul>`, `<li>`), member-access (`React.createElement(...)`),
      // and the named-import form (`createElement(...)`) — agents
      // routinely emit any of the three.
      expect(frontSource).toMatch(/<ul|<li|createElement\(["'](ul|li)["']/)

      // /reload discovers it cleanly.
      const reload = await app.inject({ method: "POST", url: "/api/v1/agent/reload", payload: {} })
      expect(reload.statusCode).toBe(200)
      const list = await app.inject({ method: "GET", url: "/api/agent-plugins" })
      const plugin = list.json().find((entry: { id: string }) => entry.id === "eval-min-tasks")
      expect(plugin, "plugin not discovered after /reload").toBeTruthy()
      expect(plugin.frontUrl).toContain("/@fs/")
    },
    600_000,
  )

  // Eval #2: multi-file plugin — agent splits front into a top-level
  // `front/index.tsx` that imports a panel component from a sibling
  // file. Tests that the agent gets relative imports + file layout right.
  test(
    "agent creates a multi-file plugin with front/index.tsx + a sibling component file",
    async () => {
      const result = await evalAgentPrompt({
        app,
        prompt: [
          "Build me a plugin called `eval-split-files`. The panel component",
          "MUST live in its own file (e.g. `Panel.tsx` or",
          "`components/MyPanel.tsx`), and the plugin entry file must IMPORT",
          "the component from that sibling file. I don't want everything",
          "in one file. The panel should just show the text",
          "\"split-files plugin works\".",
          "",
          "When you're done, ask me to run /reload.",
        ].join("\n"),
        expect: [],
        model: EVAL_MODEL,
        retries: 1,
        timeoutMs: 300_000,
      })

      expect(result.ok, formatFailure(result)).toBe(true)
      expect(existsSync(EVAL_SPLIT_PACKAGE)).toBe(true)

      const packageJson = JSON.parse(readFileSync(EVAL_SPLIT_PACKAGE, "utf8"))
      expect(packageJson.name).toBe("eval-split-files")
      const declaredFront: string = packageJson.boring?.front ?? "front/index.tsx"
      const frontPath = join(EVAL_SPLIT_DIR, declaredFront)
      expect(existsSync(frontPath), `front entry missing at ${declaredFront}`).toBe(true)
      const frontSource = readFileSync(frontPath, "utf8")
      // The factory imports the component from a sibling file. Accept
      // default (`import Panel from "./Panel"`), named (`import { Panel }
      // from "./Panel"`), and `* as` namespace forms.
      expect(frontSource).toMatch(/import\s+(?:\w+|\{[^}]+\}|\*\s+as\s+\w+)\s+from\s+["']\.\.?\//)
      // Either declarative (`panels: [...]`) or imperative (`registerPanel(...)`) is fine.
      expect(frontSource).toMatch(/registerPanel|panels\s*:/)

      // The imported sibling file exists somewhere under the plugin dir.
      const { readdirSync, statSync: stat } = await import("node:fs")
      function walk(dir: string): string[] {
        const out: string[] = []
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const full = join(dir, entry.name)
          if (entry.isDirectory()) out.push(...walk(full))
          else out.push(full)
        }
        return out
      }
      const tsxFiles = walk(EVAL_SPLIT_DIR).filter((p) => p.endsWith(".tsx") && p !== frontPath)
      expect(tsxFiles.length, "no sibling .tsx component file found").toBeGreaterThan(0)
      const hasSplitMarker = tsxFiles.some((p) => readFileSync(p, "utf8").includes("split-files plugin works"))
      expect(hasSplitMarker, "no sibling file contains the expected marker text").toBe(true)

      const reload = await app.inject({ method: "POST", url: "/api/v1/agent/reload", payload: {} })
      expect(reload.statusCode).toBe(200)
      const plugin = (await app.inject({ method: "GET", url: "/api/agent-plugins" }))
        .json()
        .find((entry: { id: string }) => entry.id === "eval-split-files")
      expect(plugin, "plugin not discovered after /reload").toBeTruthy()
      expect(stat(frontPath).size).toBeGreaterThan(0)
    },
    600_000,
  )

  // Eval #3: iterative refinement (closed loop) — pre-write a working
  // plugin, then ask the agent to MODIFY it (not rewrite from scratch).
  // Tests the agent's read-then-edit discipline.
  test(
    "agent refines an existing plugin in place — adds a count badge to the panel header",
    async () => {
      // Plant a working plugin.
      const { mkdirSync } = await import("node:fs")
      rmSync(EVAL_REFINE_DIR, { recursive: true, force: true })
      mkdirSync(join(EVAL_REFINE_DIR, "front"), { recursive: true })
      writeFileSync(
        EVAL_REFINE_PACKAGE,
        JSON.stringify(
          {
            name: "eval-refine",
            version: "0.1.0",
            private: true,
            boring: { label: "Eval Refine", front: "front/index.tsx", server: false },
            pi: { systemPrompt: "Eval refine plugin." },
          },
          null,
          2,
        ),
        "utf8",
      )
      const initialFront = [
        `import React from "react"`,
        `import { definePlugin } from "@hachej/boring-workspace/plugin"`,
        ``,
        `const TODOS = ["buy milk", "walk dog", "write code"]`,
        ``,
        `function RefinePane() {`,
        `  return (`,
        `    <div style={{ padding: 16 }}>`,
        `      <h2>Eval Refine — todos</h2>`,
        `      <ul>{TODOS.map((t) => <li key={t}>{t}</li>)}</ul>`,
        `    </div>`,
        `  )`,
        `}`,
        ``,
        `export default definePlugin(`,
        `  "eval-refine",`,
        `  (api) => {`,
        `    api.registerPanel({ id: "eval-refine.panel", label: "Eval Refine", component: RefinePane })`,
        `    api.registerPanelCommand({ id: "eval-refine.open", title: "Open Eval Refine", panelId: "eval-refine.panel" })`,
        `  },`,
        `  { label: "Eval Refine" },`,
        `)`,
        ``,
      ].join("\n")
      writeFileSync(EVAL_REFINE_FRONT, initialFront, "utf8")
      const baseline = await app.inject({ method: "POST", url: "/api/v1/agent/reload", payload: {} })
      expect(baseline.statusCode).toBe(200)
      const baselineRevision = (await app.inject({ method: "GET", url: "/api/agent-plugins" }))
        .json()
        .find((entry: { id: string }) => entry.id === "eval-refine")?.revision
      expect(baselineRevision).toEqual(expect.any(Number))

      // Now ask the agent to refine.
      const result = await evalAgentPrompt({
        app,
        prompt: [
          "The plugin at `.pi/extensions/eval-refine/front/index.tsx` already exists.",
          "Add a small count badge next to the 'Eval Refine — todos' heading",
          "showing the number of items in the TODOS array (e.g. '— todos (3)').",
          "Do NOT rewrite the whole file — read the existing one and apply a",
          "minimal edit. Keep the existing exports, panel id, command id, and",
          "definePlugin call intact.",
          "",
          "After editing, tell me to run /reload.",
        ].join("\n"),
        expect: [],
        model: EVAL_MODEL,
        retries: 1,
        timeoutMs: 300_000,
      })

      expect(result.ok, formatFailure(result)).toBe(true)

      // Agent must have READ the existing file (not just blindly written).
      const readEvalRefine = result.actual
        .filter((c) => c.tool === "read")
        .some((c) => String(c.params.path ?? c.params.file_path ?? "").includes("eval-refine/front/index.tsx"))
      expect(readEvalRefine, "agent did not read the existing front/index.tsx before editing").toBe(true)

      const updatedFront = readFileSync(EVAL_REFINE_FRONT, "utf8")
      // The badge / count must appear in the source.
      expect(updatedFront).toMatch(/TODOS\.length|todos \(3\)|\{TODOS\.length\}/)
      // Existing structure preserved.
      expect(updatedFront).toContain("definePlugin")
      expect(updatedFront).toContain('"eval-refine.panel"')
      expect(updatedFront).toContain('"eval-refine.open"')

      const reload = await app.inject({ method: "POST", url: "/api/v1/agent/reload", payload: {} })
      expect(reload.statusCode).toBe(200)
      const refreshed = (await app.inject({ method: "GET", url: "/api/agent-plugins" }))
        .json()
        .find((entry: { id: string }) => entry.id === "eval-refine")
      expect(refreshed.revision).toBeGreaterThan(baselineRevision)
    },
    600_000,
  )

  // Eval #4: cross-concern — single plugin contributes BOTH a hot-reloadable
  // Pi agent tool AND a front panel. Static `boring.server` tools are valid for
  // boot-time app integration, but they are not activated by `/reload` for
  // `.pi/extensions` user plugins, so this eval requires `pi.extensions`.
  test(
    "agent creates a cross-concern plugin (server tool + front panel) that reloads cleanly",
    async () => {
      const result = await evalAgentPrompt({
        app,
        prompt: [
          "Build me a plugin called `eval-cross` that does two things:",
          "1. shows me a panel with the text \"Eval Cross panel\"",
          "2. adds a hot-reloadable Pi agent tool called `eval_cross_ping`",
          "   declared through package.json#pi.extensions (not boring.server)",
          "   that, when I call it from chat, returns the text \"eval-cross pong\".",
          "",
          "When you're done, ask me to run /reload.",
        ].join("\n"),
        expect: [],
        model: EVAL_MODEL,
        retries: 1,
        timeoutMs: 300_000,
      })

      expect(result.ok, formatFailure(result)).toBe(true)
      expect(existsSync(EVAL_CROSS_PACKAGE), "agent did not produce a package.json").toBe(true)

      const packageJson = JSON.parse(readFileSync(EVAL_CROSS_PACKAGE, "utf8"))
      expect(packageJson.name).toBe("eval-cross")

      // Locate the front file from the manifest (or convention).
      const declaredFront: string | undefined = packageJson.boring?.front
      const candidateFronts = declaredFront
        ? [declaredFront]
        : ["front/index.tsx", "front/index.ts"]
      const frontPath = candidateFronts.map((p) => join(EVAL_CROSS_DIR, p)).find((p) => existsSync(p))
      expect(frontPath, `no front entry found (tried: ${candidateFronts.join(", ")})`).toBeTruthy()
      // User-observable: panel text the user asked for appears verbatim.
      expect(readFileSync(frontPath!, "utf8")).toContain("Eval Cross panel")

      const declaredExtensions = packageJson.pi?.extensions
      expect(
        Array.isArray(declaredExtensions) && declaredExtensions.length > 0,
        "hot-reloadable tools must be declared in package.json#pi.extensions",
      ).toBe(true)
      const extensionPath = (declaredExtensions as string[])
        .map((p) => join(EVAL_CROSS_DIR, p))
        .find((p) => existsSync(p))
      expect(
        extensionPath,
        `no declared Pi extension file found (declared: ${JSON.stringify(declaredExtensions)})`,
      ).toBeTruthy()
      const extensionSource = stripComments(readFileSync(extensionPath!, "utf8"))
      expect(
        extensionSource,
        "declared Pi extension does not register eval_cross_ping as a tool",
      ).toMatch(/registerTool\s*\(\s*{[\s\S]*name\s*:\s*["']eval_cross_ping["']/)
      expect(
        extensionSource,
        "declared eval_cross_ping tool does not return eval-cross pong",
      ).toMatch(/eval_cross_ping[\s\S]*(return|text\s*:)[\s\S]*["']eval-cross pong["']/)

      const reload = await app.inject({ method: "POST", url: "/api/v1/agent/reload", payload: {} })
      expect(reload.statusCode).toBe(200)
      const pluginsList = (await app.inject({ method: "GET", url: "/api/agent-plugins" })).json()
      const plugin = pluginsList.find((entry: { id: string }) => entry.id === "eval-cross")
      expect(
        plugin,
        `plugin not discovered after /reload; ids in registry: ${JSON.stringify(pluginsList.map((p: { id: string }) => p.id))}`,
      ).toBeTruthy()
      expect(stat(frontPath!).size).toBeGreaterThan(0)
    },
    600_000,
  )
})

function formatFailure(result: { ok: boolean; reason?: string; text?: string; actual: Array<{ tool: string }> }): string {
  const tools = result.actual.map((c) => c.tool).join(", ") || "(none)"
  const text = result.text ? `; text: ${result.text.slice(0, 500)}` : ""
  return result.reason ? `${result.reason}${text}` : `tools called: ${tools}${text}`
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
}

/**
 * Flake telemetry: records attempt counts per eval (when evalAgentPrompt
 * retried at least once) and dumps a summary at process exit. Lets us
 * see which evals are intermittently flaky without manually re-running.
 * `attempts > 1` = test passed after a retry; treat as a flake signal.
 */
const FLAKE_LOG: Array<{ provider: string; testName: string; attempts: number }> = []
function trackAttempts(provider: string, testName: string, attempts: number | undefined): void {
  if (typeof attempts !== "number" || attempts <= 1) return
  FLAKE_LOG.push({ provider, testName, attempts })
}
if (typeof process !== "undefined" && typeof process.on === "function") {
  process.on("beforeExit", () => {
    if (FLAKE_LOG.length === 0) return
    // eslint-disable-next-line no-console
    console.log("\n[eval-flake-summary] evals that needed > 1 attempt:")
    for (const entry of FLAKE_LOG) {
      // eslint-disable-next-line no-console
      console.log(`  [${entry.provider}] ${entry.testName} → ${entry.attempts} attempts`)
    }
  })
}
