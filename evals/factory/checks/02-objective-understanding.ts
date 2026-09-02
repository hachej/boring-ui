/**
 * eval-objective-understanding: given a seeded Objective (via the real
 * objectives FileObjectiveStore), the agent's restatement names the
 * metric, target, and constraints. Live-only — this is fundamentally a
 * comprehension check, so it cannot be made honest without a real model
 * reading the tool result and restating it in its own words.
 */
import { evalAgentPrompt } from "@hachej/boring-agent/eval"
import { bootObjectivesAskUserHost, LIVE_ENABLED, LIVE_MODEL, LIVE_TIMEOUT_MS } from "../lib/harness"
import type { EvalCheckResult, EvalModuleResult } from "../lib/types"

export const evalId = "eval-objective-understanding"
export const title = "agent's restatement of a seeded Objective names metric, target, and constraints"

export async function run(): Promise<EvalModuleResult> {
  const checks: EvalCheckResult[] = [await checkLive()]
  return { evalId, title, checks }
}

async function checkLive(): Promise<EvalCheckResult> {
  const id = `${evalId}.live-restate`
  const label = "restatement names metric+target+constraints"
  if (!LIVE_ENABLED) return { id, label, status: "skip", live: true, detail: "FACTORY_EVALS_LIVE!=1" }

  const host = await bootObjectivesAskUserHost("objective-understanding")
  try {
    const objective = await host.objectiveStore.create({
      title: "Cut cold-start p95",
      objective: "Reduce sandbox cold-start latency so onboarding does not stall.",
      metric: "sandbox_cold_start_p95_ms",
      baseline: 4200,
      target: 1500,
      constraints: ["must not disable the readonly filesystem policy", "no new paid infra"],
      evidenceRefs: [],
    })

    const result = await evalAgentPrompt({
      app: host.app,
      agentTypeId: "default",
      prompt: `Use get_objective to look up objective ${objective.id} and restate it back to me in your own words: what metric it tracks, what the target is, and what constraints bound how it may be pursued.`,
      expectFirst: { tool: "get_objective", params: { id: objective.id } },
      model: LIVE_MODEL,
      timeoutMs: LIVE_TIMEOUT_MS,
      retries: 1,
    })

    if (!result.ok) return { id, label, status: "fail", live: true, detail: result.reason ?? "no reason" }

    const text = result.text.toLowerCase()
    const missing: string[] = []
    if (!text.includes("sandbox_cold_start_p95_ms") && !text.includes("cold-start") && !text.includes("cold start")) missing.push("metric")
    if (!text.includes("1500") && !text.includes("1,500")) missing.push("target")
    if (!text.includes("readonly") && !text.includes("read-only") && !text.includes("read only")) missing.push("constraint#1 (readonly filesystem)")
    if (!text.includes("paid infra") && !text.includes("new infra") && !text.includes("infrastructure")) missing.push("constraint#2 (no new paid infra)")

    if (missing.length > 0) {
      return {
        id,
        label,
        status: "fail",
        live: true,
        detail: `restatement missing: ${missing.join(", ")}; text="${result.text.slice(0, 200)}"`,
      }
    }
    return { id, label, status: "pass", live: true, detail: `objective=${objective.id}` }
  } catch (err) {
    return { id, label, status: "fail", live: true, detail: err instanceof Error ? err.message : String(err) }
  } finally {
    await host.close()
  }
}
