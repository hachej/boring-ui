#!/usr/bin/env -S tsx
/**
 * Workspace eval CLI — boots `createWorkspaceAgentApp` (which adds the
 * exec_ui / get_ui_state tools on top of the bare agent catalog) and
 * replays a YAML fixture suite through @boring/agent/testing.
 *
 * Usage:
 *   pnpm --filter @boring/workspace eval [path/to/suite.yaml]
 *
 * Behavior:
 * - Defaults the suite path to packages/workspace/eval/ui-tools.yaml.
 * - Skips with exit 0 + a clear log line when ANTHROPIC_API_KEY is unset.
 * - Exits 1 on any prompt failure or suite-level timeout.
 *
 * Workspace seed: a tmpdir is created with a few small fixture files
 * (README.md, foo.ts, greeter.ts, package.json) so the LLM has plausible
 * targets when prompts say "open foo.ts". The agent's `read` tool will
 * actually read these files; `exec_ui openFile` just queues a UI command
 * (the in-memory bridge dispatches into a void since there's no frontend).
 */
import { resolve, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { runEvalSuite } from "@boring/agent/testing"
import { createWorkspaceAgentApp } from "../src/server/createWorkspaceAgentApp"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

function seedWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), "workspace-eval-"))
  writeFileSync(join(root, "README.md"), "# workspace eval fixture\n\nHello world.\n")
  writeFileSync(join(root, "foo.ts"), "export const foo = 1\n")
  writeFileSync(join(root, "greeter.ts"), 'export function greet() { return "Hello" }\n')
  writeFileSync(join(root, "package.json"), '{"name":"eval-fixture"}\n')
  // Nested fixture for the file-not-found recovery prompt: the agent's
  // first openFile attempt at "notes.md" must fail, then find_files
  // discovers it under docs/, then openFile retries with that path.
  mkdirSync(join(root, "docs"), { recursive: true })
  writeFileSync(join(root, "docs", "notes.md"), "# nested notes\n")
  return root
}

async function main(): Promise<number> {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY) {
    console.warn(
      "[workspace eval] Skipping: no LLM API key in env (ANTHROPIC_API_KEY / OPENAI_API_KEY).",
    )
    return 0
  }

  const fixturesPath = resolve(
    process.argv[2] ?? `${__dirname}/../eval/ui-tools.yaml`,
  )
  console.log(`[workspace eval] running suite: ${fixturesPath}`)

  const workspaceRoot = seedWorkspace()
  console.log(`[workspace eval] seeded workspace: ${workspaceRoot}`)

  const app = await createWorkspaceAgentApp({
    workspaceRoot,
    mode: "direct",
    logger: false,
  })

  try {
    // Concurrency 2: Anthropic rate-limits at higher fan-out for the
    // workspace catalog (more tools = more thinking tokens per call).
    const report = await runEvalSuite({ app, fixturesPath, concurrency: 2 })

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
          console.error(
            `  text: ${r.text.slice(0, 200)}${r.text.length > 200 ? "…" : ""}`,
          )
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
