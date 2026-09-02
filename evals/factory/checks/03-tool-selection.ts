/**
 * eval-tool-selection: for a simple investigation prompt, the agent calls
 * list_objectives/get_objective before mutating anything (create_objective /
 * update_objective). Live-only — tool ordering under a real model's own
 * judgment is exactly what this checks; a scripted transcript would prove
 * nothing about tool-selection behavior.
 */
import { evalAgentPrompt } from "@hachej/boring-agent/eval"
import { bootObjectivesAskUserHost, LIVE_ENABLED, LIVE_MODEL, LIVE_TIMEOUT_MS } from "../lib/harness"
import type { EvalCheckResult, EvalModuleResult } from "../lib/types"

export const evalId = "eval-tool-selection"
export const title = "investigation prompt calls list_objectives/get_objective before any mutation"

const READ_TOOLS = new Set(["list_objectives", "get_objective"])
const MUTATE_TOOLS = new Set(["create_objective", "update_objective"])

export async function run(): Promise<EvalModuleResult> {
  const checks: EvalCheckResult[] = [await checkLive()]
  return { evalId, title, checks }
}

async function checkLive(): Promise<EvalCheckResult> {
  const id = `${evalId}.live-order`
  const label = "read tool precedes any mutating tool"
  if (!LIVE_ENABLED) return { id, label, status: "skip", live: true, detail: "FACTORY_EVALS_LIVE!=1" }

  const host = await bootObjectivesAskUserHost("tool-selection")
  try {
    await host.objectiveStore.create({
      title: "Ship the S1 migration",
      objective: "Move all remaining callers off the legacy session store.",
      metric: "legacy_session_store_callers",
      baseline: 12,
      target: 0,
      constraints: [],
      evidenceRefs: [],
    })

    // Use the matcher's expectFirst as a soft transport-level expectation
    // (validateMutuallyExclusive requires exactly one), then judge the real
    // assertion from `result.actual` directly below regardless of whether
    // the matcher itself said ok — the matcher only checks ONE tool name,
    // but this eval accepts either read tool.
    const result = await evalAgentPrompt({
      app: host.app,
      agentTypeId: "default",
      prompt: "Before doing anything else, investigate what Objectives currently exist and check on their status. Do not create or change any objective yet.",
      expectFirst: { tool: "list_objectives" },
      model: LIVE_MODEL,
      timeoutMs: LIVE_TIMEOUT_MS,
      retries: 1,
    })

    if (result.actual.length === 0) {
      return { id, label, status: "fail", live: true, detail: `no tool calls at all; text="${result.text.slice(0, 200)}"` }
    }

    const firstReadIndex = result.actual.findIndex((c) => READ_TOOLS.has(c.tool))
    const firstMutateIndex = result.actual.findIndex((c) => MUTATE_TOOLS.has(c.tool))

    if (firstReadIndex === -1) {
      return { id, label, status: "fail", live: true, detail: `no read tool called; actual=${JSON.stringify(result.actual)}` }
    }
    if (firstMutateIndex !== -1 && firstMutateIndex < firstReadIndex) {
      return {
        id,
        label,
        status: "fail",
        live: true,
        detail: `mutated (${result.actual[firstMutateIndex]!.tool}) before investigating; actual=${JSON.stringify(result.actual)}`,
      }
    }
    return { id, label, status: "pass", live: true, detail: `first call=${result.actual[0]!.tool}` }
  } catch (err) {
    return { id, label, status: "fail", live: true, detail: err instanceof Error ? err.message : String(err) }
  } finally {
    await host.close()
  }
}
