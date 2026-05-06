#!/usr/bin/env -S tsx
/**
 * CLI for the eval framework. Runs a YAML suite against `createAgentApp`
 * with the agent's standard tool catalog. Hosts that need to eval against
 * a workspace-aware app (`createWorkspaceAgentApp`) or a custom catalog
 * should write their own driver script — this CLI is the agent-package
 * baseline runner.
 *
 * Usage:
 *   pnpm --filter @hachej/boring-agent eval [path/to/suite.yaml]
 *
 * Behavior:
 * - Defaults the suite path to packages/agent/eval/standard-tools.yaml.
 * - Skips with exit 0 + a clear log line when no supported LLM API key is set.
 * - Exits 1 on any prompt failure or suite-level timeout.
 */
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { dirname } from "node:path"
import { runEvalSuite } from "../src/eval"
import { createAgentApp } from "../src/server"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

async function main(): Promise<number> {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY && !process.env.OPENROUTER_API_KEY) {
    console.warn(
      "[eval] Skipping: no LLM API key in env (OPENROUTER_API_KEY / ANTHROPIC_API_KEY / OPENAI_API_KEY).",
    )
    return 0
  }

  const fixturesPath = resolve(
    process.argv[2] ?? `${__dirname}/../eval/standard-tools.yaml`,
  )
  console.log(`[eval] running suite: ${fixturesPath}`)

  const app = await createAgentApp({
    workspaceRoot: process.env.BORING_AGENT_WORKSPACE_ROOT ?? process.cwd(),
    mode: "direct",
    logger: false,
  })

  try {
    const report = await runEvalSuite({ app, fixturesPath })

    console.log(
      `[eval] ${report.passed}/${report.total} passed (${(
        report.passRate * 100
      ).toFixed(1)}%) in ${(report.totalDurationMs / 1000).toFixed(1)}s`,
    )
    if (report.totalUsage.input > 0 || report.totalUsage.output > 0) {
      console.log(
        `[eval] tokens: ${report.totalUsage.input} input + ${report.totalUsage.output} output`,
      )
    }

    if (!report.allPassed) {
      console.error(`\n[eval] ${report.failed} prompt(s) failed:`)
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

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error("[eval] fatal:", err)
    process.exit(2)
  },
)
