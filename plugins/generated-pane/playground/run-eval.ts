#!/usr/bin/env -S tsx
import { cpSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { runEvalSuite, type SuiteReport } from "@hachej/boring-agent/eval"
import { createWorkspaceAgentServer } from "@hachej/boring-workspace/app/server"
import { parseGeneratedPaneSpec } from "../src/shared/index"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const PLUGIN_ROOT = resolve(__dirname, "..")
const EXAMPLE_ROOT = resolve(PLUGIN_ROOT, "example")
const DEFAULT_EVAL = resolve(EXAMPLE_ROOT, "eval/generated-pane.yaml")

function seedWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), "generated-pane-playground-"))
  cpSync(EXAMPLE_ROOT, root, { recursive: true })
  return root
}

async function main(): Promise<number> {
  const fixturesPath = resolve(process.argv[2] ?? DEFAULT_EVAL)
  const workspaceRoot = seedWorkspace()
  console.log(`[generated-pane playground] running suite: ${fixturesPath}`)
  console.log(`[generated-pane playground] seeded workspace: ${workspaceRoot}`)

  const app = await createWorkspaceAgentServer({
    workspaceRoot,
    appRoot: PLUGIN_ROOT,
    mode: "local",
    logger: false,
    defaultPluginPackages: ["@hachej/boring-generated-pane"],
  })

  try {
    const report = await runEvalSuite({ app, fixturesPath, concurrency: 1 })
    console.log(
      `[generated-pane playground] ${report.passed}/${report.total} passed (${(report.passRate * 100).toFixed(1)}%) in ${(report.totalDurationMs / 1000).toFixed(1)}s`,
    )

    const validationErrors = validateWrittenPanes(report)
    if (validationErrors.length > 0) {
      console.error("\n[generated-pane playground] generated pane validation failed:")
      for (const error of validationErrors) console.error(`  - ${error}`)
      return 1
    }

    if (!report.allPassed) {
      console.error(`\n[generated-pane playground] ${report.failed} prompt(s) failed:`)
      for (const r of report.results) {
        if (r.ok) continue
        console.error(`\n  prompt: ${r.prompt}`)
        console.error(`  reason: ${r.reason ?? "(no reason)"}`)
        if (r.actual.length > 0) {
          console.error(`  actual calls: ${JSON.stringify(r.actual, null, 2).replace(/\n/g, "\n  ")}`)
        }
        if (r.text) {
          console.error(`  text: ${r.text.slice(0, 200)}${r.text.length > 200 ? "…" : ""}`)
        }
      }
      return 1
    }

    return 0
  } finally {
    await app.close()
  }
}

function validateWrittenPanes(report: SuiteReport): string[] {
  const errors: string[] = []
  for (const result of report.results) {
    for (const call of result.actual) {
      if (call.tool !== "write") continue
      const path = typeof call.params.path === "string" ? call.params.path : ""
      if (!/\.pane\.json$/i.test(path)) continue
      if (typeof call.params.content !== "string") {
        errors.push(`${path || "pane write"}: content is not a string`)
        continue
      }
      try {
        const parsed = parseGeneratedPaneSpec(JSON.parse(call.params.content))
        if (!parsed.spec) errors.push(`${path}: ${parsed.errors.join("; ")}`)
      } catch (error) {
        errors.push(`${path}: invalid JSON (${error instanceof Error ? error.message : String(error)})`)
      }
    }
  }
  return errors
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error("[generated-pane playground] fatal:", err)
    process.exit(2)
  },
)
