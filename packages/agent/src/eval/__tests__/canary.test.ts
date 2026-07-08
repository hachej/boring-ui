/**
 * Canary eval — runs the eval framework end-to-end against the real
 * Anthropic API to catch regressions in:
 *   - the tool-selection prompt (system prompt, tool descriptions)
 *   - the matcher pipeline (YAML schema → matcher → SSE parser)
 *   - the chat route streaming protocol
 *
 * Gated on ANTHROPIC_API_KEY: skipped silently in dev / CI without secrets,
 * runs in nightly + maintainer-triggered fork-PR runs that have it.
 *
 * Three-prompt budget: covers read (path matcher), bash (regex matcher),
 * and a negative-assertion prompt (no tool call). Bigger suites live in
 * eval/standard-tools.yaml and run via the CLI.
 */
import { describe, test, expect, beforeAll } from "vitest"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { evalAgentPrompt } from "../evalPrompt"
import { EvalRegex } from "../types"
import { createTestAgentApp } from "../../server/__tests__/testRuntimeAdapter"
import type { FastifyInstance } from "fastify"

const HAS_KEY = !!process.env.ANTHROPIC_API_KEY
const describeIf = HAS_KEY ? describe : describe.skip

describeIf("eval canary (live LLM)", () => {
  let app: FastifyInstance
  let workspaceRoot: string

  beforeAll(async () => {
    workspaceRoot = mkdtempSync(join(tmpdir(), "agent-eval-canary-"))
    writeFileSync(join(workspaceRoot, "README.md"), "# canary fixture\n")
    app = await createTestAgentApp({ workspaceRoot, mode: "direct", logger: false })
    return async () => {
      await app.close()
    }
  }, 30_000)

  test(
    "picks `read` for a read-the-file prompt",
    async () => {
      const result = await evalAgentPrompt({
        app,
        prompt: "read the file README.md and tell me what it says",
        expect: { tool: "read", params: { path: "README.md" } },
        retries: 1,
        timeoutMs: 45_000,
      })
      expect(result.ok, result.reason ?? "").toBe(true)
    },
    90_000,
  )

  test(
    "picks `bash` with an `ls` command",
    async () => {
      const result = await evalAgentPrompt({
        app,
        prompt: "run `ls -la` to see the directory contents",
        expect: { tool: "bash", params: { command: EvalRegex("ls") } },
        retries: 1,
        timeoutMs: 45_000,
      })
      expect(result.ok, result.reason ?? "").toBe(true)
    },
    90_000,
  )

  test(
    "calls no tool for a pure-knowledge question",
    async () => {
      const result = await evalAgentPrompt({
        app,
        prompt: "what is 2 + 2? answer briefly with no tool calls",
        expectNoToolCall: true,
        retries: 1,
        timeoutMs: 45_000,
      })
      expect(result.ok, result.reason ?? "").toBe(true)
    },
    90_000,
  )
})

if (!HAS_KEY) {
  // Surface the skip in test output so people don't silently lose coverage.
  // eslint-disable-next-line no-console
  console.warn(
    "[eval canary] skipped: ANTHROPIC_API_KEY not set. Set it to run live LLM regression checks.",
  )
}
