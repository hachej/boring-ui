#!/usr/bin/env -S tsx
import { cpSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { runEvalSuite, type SuiteReport } from "@hachej/boring-agent/eval"
import { createWorkspaceAgentServer } from "@hachej/boring-workspace/app/server"
import { parseDashboardSpec } from "../src/shared/validation"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const PLUGIN_ROOT = resolve(__dirname, "..")
const EXAMPLE_ROOT = resolve(PLUGIN_ROOT, "example")
const DEFAULT_EVAL = resolve(EXAMPLE_ROOT, "eval/bi-dashboard.yaml")

function seedWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), "bi-dashboard-playground-"))
  cpSync(EXAMPLE_ROOT, root, { recursive: true })
  return root
}

async function main(): Promise<number> {
  const fixturesPath = resolve(process.argv[2] ?? DEFAULT_EVAL)
  const workspaceRoot = seedWorkspace()
  console.log(`[bi-dashboard playground] running suite: ${fixturesPath}`)
  console.log(`[bi-dashboard playground] seeded workspace: ${workspaceRoot}`)

  const app = await createWorkspaceAgentServer({
    workspaceRoot,
    appRoot: PLUGIN_ROOT,
    mode: "local",
    logger: false,
    defaultPluginPackages: ["@hachej/data-bridge", "@hachej/boring-bi-dashboard"],
    workspaceBridge: { allowInsecureLocalCliBrowserAuth: true },
  })

  try {
    const report = await runEvalSuite({ app, fixturesPath, concurrency: 1 })
    console.log(
      `[bi-dashboard playground] ${report.passed}/${report.total} passed (${(report.passRate * 100).toFixed(1)}%) in ${(report.totalDurationMs / 1000).toFixed(1)}s`,
    )

    const validationErrors = validateWrittenDashboards(report)
    if (validationErrors.length > 0) {
      console.error("\n[bi-dashboard playground] generated dashboard validation failed:")
      for (const error of validationErrors) console.error(`  - ${error}`)
      return 1
    }

    if (!report.allPassed) {
      console.error(`\n[bi-dashboard playground] ${report.failed} prompt(s) failed:`)
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

function validateWrittenDashboards(report: SuiteReport): string[] {
  const errors: string[] = []
  for (const result of report.results) {
    for (const call of result.actual) {
      if (call.tool !== "write") continue
      const path = typeof call.params.path === "string" ? call.params.path : ""
      if (!/\.dashboard\.json$/i.test(path)) continue
      if (typeof call.params.content !== "string") {
        errors.push(`${path || "dashboard write"}: content is not a string`)
        continue
      }
      try {
        const parsed = parseDashboardSpec(JSON.parse(call.params.content))
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
    console.error("[bi-dashboard playground] fatal:", err)
    process.exit(2)
  },
)
