#!/usr/bin/env -S tsx
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { runEvalSuite } from "@boring/agent/eval"
import { createWorkspaceAgentApp } from "../src/app"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const PACKAGE_ROOT = resolve(__dirname, "..")

function seedWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), "workspace-eval-"))
  mkdirSync(join(root, "docs"), { recursive: true })
  writeFileSync(join(root, "README.md"), "# Workspace eval\n\nSmall fixture.\n", "utf8")
  writeFileSync(join(root, "foo.ts"), "export const foo = 1\n", "utf8")
  writeFileSync(join(root, "greeter.ts"), "export function greet(name: string) { return `hi ${name}` }\n", "utf8")
  writeFileSync(join(root, "package.json"), "{\"name\":\"workspace-eval\"}\n", "utf8")
  writeFileSync(join(root, "docs", "notes.md"), "# Notes\n", "utf8")
  return root
}

async function main(): Promise<number> {
  const fixturesPath = resolve(
    process.argv[2] ?? join(PACKAGE_ROOT, "eval", "ui-tools.yaml"),
  )
  const model = process.env.EVAL_MODEL || undefined
  console.log(`[workspace eval] running suite: ${fixturesPath}`)
  if (model) console.log(`[workspace eval] model override: ${model}`)

  const workspaceRoot = seedWorkspace()
  const app = await createWorkspaceAgentApp({
    workspaceRoot,
    mode: "local",
    logger: false,
  })

  await app.inject({
    method: "PUT",
    url: "/api/v1/ui/state",
    payload: {
      state: {
        workbenchOpen: true,
        drawerOpen: false,
        openTabs: [],
        activeTab: null,
        activeFile: null,
        availablePanels: ["code-editor", "markdown-editor", "csv-viewer", "chart-canvas"],
      },
      causedBy: "restore",
    },
  })

  try {
    const report = await runEvalSuite({
      app,
      fixturesPath,
      concurrency: 1,
      model,
    })
    console.log(
      `[workspace eval] ${report.passed}/${report.total} passed (${(
        report.passRate * 100
      ).toFixed(1)}%) in ${(report.totalDurationMs / 1000).toFixed(1)}s`,
    )

    if (!report.allPassed) {
      console.error(`\n[workspace eval] ${report.failed} prompt(s) failed:`)
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
    console.error("[workspace eval] fatal:", err)
    process.exit(2)
  },
)
