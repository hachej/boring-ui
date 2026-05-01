#!/usr/bin/env -S tsx
import { cpSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { runEvalSuite } from "@boring/agent/eval"
import { createWorkspaceAgentServer } from "../../../packages/workspace/src/app/server"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const APP_ROOT = resolve(__dirname, "..")
const FIXTURES_ROOT = resolve(APP_ROOT, "src/fixtures")
const TEMPLATE_ROOT = resolve(APP_ROOT, "workspace-template")

function seedWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), "workspace-playground-eval-"))
  cpSync(FIXTURES_ROOT, root, { recursive: true })
  return root
}

async function main(): Promise<number> {
  const fixturesPath = resolve(
    process.argv[2] ?? join(APP_ROOT, "eval", "woreplace-skill.yaml"),
  )
  console.log(`[workspace-playground eval] running suite: ${fixturesPath}`)

  const workspaceRoot = seedWorkspace()
  console.log(`[workspace-playground eval] seeded workspace: ${workspaceRoot}`)

  const app = await createWorkspaceAgentServer({
    workspaceRoot,
    templatePath: TEMPLATE_ROOT,
    mode: "local",
    logger: false,
  })

  try {
    const report = await runEvalSuite({ app, fixturesPath, concurrency: 1 })
    console.log(
      `[workspace-playground eval] ${report.passed}/${report.total} passed (${(
        report.passRate * 100
      ).toFixed(1)}%) in ${(report.totalDurationMs / 1000).toFixed(1)}s`,
    )

    if (!report.allPassed) {
      console.error(`\n[workspace-playground eval] ${report.failed} prompt(s) failed:`)
      for (const r of report.results) {
        if (r.ok) continue
        console.error(`\n  prompt: ${r.prompt}`)
        console.error(`  reason: ${r.reason ?? "(no reason)"}`)
        if (r.actual.length > 0) {
          console.error(
            `  actual calls: ${JSON.stringify(r.actual, null, 2).replace(/\n/g, "\n  ")}`,
          )
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

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error("[workspace-playground eval] fatal:", err)
    process.exit(2)
  },
)
