/**
 * Batch runner for YAML eval fixtures. Reads the file, fans prompts out
 * across a small worker pool, and aggregates a SuiteReport.
 *
 * Strict 100% pass: any failed prompt fails the suite. Per-prompt
 * `retries` handles stochastic noise; suite-wide threshold is
 * deliberately not a knob (per AGENT_EVAL_FRAMEWORK.md design rationale).
 */
import { readFile } from "node:fs/promises"
import { evalAgentPrompt } from "./evalPrompt"
import { parseFixtureYaml } from "./yamlSchema"
import {
  DEFAULT_CONCURRENCY,
  DEFAULT_SUITE_TIMEOUT_MS,
  DEFAULT_TIMEOUT_MS,
} from "./evalConfig"
import type {
  EvalResult,
  SuiteFixture,
  SuiteFixturePrompt,
  SuiteOptions,
  SuiteReport,
} from "./types"

export async function runEvalSuite(opts: SuiteOptions): Promise<SuiteReport> {
  const fixtureText = await readFile(opts.fixturesPath, "utf8")
  const fixture = parseFixtureYaml(fixtureText)
  const concurrency = opts.concurrency ?? DEFAULT_CONCURRENCY
  const suiteTimeoutMs = opts.suiteTimeoutMs ?? DEFAULT_SUITE_TIMEOUT_MS

  const start = Date.now()
  const deadline = start + suiteTimeoutMs

  const queue: SuiteFixturePrompt[] = [...fixture.prompts]
  const results: SuiteReport["results"] = []
  let bailed = false

  async function worker(): Promise<void> {
    while (queue.length > 0 && !bailed) {
      if (Date.now() > deadline) return
      const prompt = queue.shift()
      if (!prompt) return
      const result = await runOnePrompt(opts, fixture, prompt)
      results.push({
        ...result,
        prompt: prompt.prompt,
        expected: prompt,
      })
      if (!result.ok && opts.bail) {
        bailed = true
        return
      }
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker())
  await Promise.race([
    Promise.all(workers),
    new Promise<void>((_, reject) =>
      setTimeout(
        () => reject(new Error(`suite exceeded ${suiteTimeoutMs}ms`)),
        suiteTimeoutMs,
      ),
    ),
  ]).catch((err) => {
    // Append a synthetic failure for visibility, then continue to the
    // aggregation step so we still emit a SuiteReport.
    results.push({
      ok: false,
      actual: [],
      text: "",
      attempts: 0,
      reason: err instanceof Error ? err.message : String(err),
      prompt: "(suite-level timeout)",
      expected: { prompt: "(suite-level timeout)" },
    })
  })

  const totalUsage = results.reduce(
    (acc, r) => ({
      input: acc.input + (r.usage?.input ?? 0),
      output: acc.output + (r.usage?.output ?? 0),
    }),
    { input: 0, output: 0 },
  )

  const passed = results.filter((r) => r.ok).length
  const total = results.length
  const passRate = total === 0 ? 0 : passed / total

  return {
    total,
    passed,
    failed: total - passed,
    passRate,
    results,
    totalUsage,
    totalDurationMs: Date.now() - start,
    allPassed: total > 0 && passed === total,
  }
}

async function runOnePrompt(
  opts: SuiteOptions,
  fixture: SuiteFixture,
  p: SuiteFixturePrompt,
): Promise<EvalResult> {
  // Per-prompt overrides win over suite defaults; suite-level model wins
  // over agent-package default (see DEFAULT_EVAL_MODEL); CLI --model
  // override (opts.model) wins over both for ad-hoc runs.
  const model = opts.model ?? p.model ?? fixture.defaults?.model ?? fixture.model
  const retries = p.retries ?? fixture.defaults?.retries ?? 0
  const timeoutMs =
    p.timeoutMs ?? fixture.defaults?.timeoutMs ?? DEFAULT_TIMEOUT_MS

  return evalAgentPrompt({
    app: opts.app,
    prompt: p.prompt,
    expect: p.expect,
    expectFirst: p.expectFirst,
    expectNoToolCall: p.expectNoToolCall,
    systemPrompt: fixture.systemPrompt,
    model,
    retries,
    timeoutMs,
  })
}
