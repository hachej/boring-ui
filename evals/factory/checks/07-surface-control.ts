/**
 * eval-surface-control: told to open the objective surface, the agent
 * issues `exec_ui` with `{kind:'openSurface', params:{kind:'objective', ...}}`
 * and verification succeeds (uiTools's isVerified path).
 *
 * Two checks:
 *  - structural (always runs, no model): calls the real `exec_ui` tool
 *    factory (`createExecUiTool` from @hachej/boring-workspace/server)
 *    directly against a real in-memory WorkspaceBridge — no LLM in the
 *    loop — and asserts the dispatched UiCommand and the isVerified path
 *    both come back clean.
 *  - live (FACTORY_EVALS_LIVE=1): a real model, told to open an objective's
 *    surface, actually chooses to call exec_ui with the right params.
 */
import { createExecUiTool, createInMemoryBridge } from "@hachej/boring-workspace/server"
import { evalAgentPrompt } from "@hachej/boring-agent/eval"
import { bootObjectivesAskUserHost, LIVE_ENABLED, LIVE_MODEL, LIVE_TIMEOUT_MS } from "../lib/harness"
import type { EvalCheckResult, EvalModuleResult } from "../lib/types"

export const evalId = "eval-surface-control"
export const title = "exec_ui openSurface(kind:'objective') dispatches and verifies"

export async function run(): Promise<EvalModuleResult> {
  const checks: EvalCheckResult[] = []
  checks.push(await checkStructuralDispatch())
  checks.push(await checkLive())
  return { evalId, title, checks }
}

async function checkStructuralDispatch(): Promise<EvalCheckResult> {
  const id = `${evalId}.dispatch`
  const label = "exec_ui openSurface(kind:'objective') dispatches + isVerified, no model"
  try {
    const bridge = createInMemoryBridge()
    const tool = createExecUiTool(bridge)
    const targetId = "obj-structural-eval"

    const result = await (tool.execute as (input: Record<string, unknown>) => Promise<{
      isError?: boolean
      details?: { seq?: number; status?: string; uiState?: unknown }
    }>)({ kind: "openSurface", params: { kind: "objective", target: targetId } })

    if (result.isError) {
      return { id, label, status: "fail", live: false, detail: `exec_ui returned an error: ${JSON.stringify(result)}` }
    }
    if (result.details?.status !== "ok" || typeof result.details.seq !== "number") {
      return { id, label, status: "fail", live: false, detail: `unexpected result shape: ${JSON.stringify(result)}` }
    }

    const drained = await bridge.drainCommands()
    const command = drained.find((c) => c.kind === "openSurface")
    if (!command) {
      return { id, label, status: "fail", live: false, detail: `no openSurface command reached the bridge; drained=${JSON.stringify(drained)}` }
    }
    const params = command.params as { kind?: string; target?: string } | undefined
    if (params?.kind !== "objective" || params.target !== targetId) {
      return { id, label, status: "fail", live: false, detail: `dispatched command params mismatch: ${JSON.stringify(params)}` }
    }

    return { id, label, status: "pass", live: false, detail: `seq=${result.details.seq}, isVerified path returned status "ok"` }
  } catch (err) {
    return { id, label, status: "fail", live: false, detail: err instanceof Error ? err.message : String(err) }
  }
}

async function checkLive(): Promise<EvalCheckResult> {
  const id = `${evalId}.live-agent-opens-surface`
  const label = "agent calls exec_ui openSurface(kind:'objective') for a real objective"
  if (!LIVE_ENABLED) return { id, label, status: "skip", live: true, detail: "FACTORY_EVALS_LIVE!=1" }

  const host = await bootObjectivesAskUserHost("surface-control")
  try {
    const objective = await host.objectiveStore.create({
      title: "Reduce onboarding drop-off",
      objective: "Fewer new users abandon setup before their first session.",
      metric: "onboarding_completion_rate",
      baseline: 0.42,
      target: 0.7,
      constraints: [],
      evidenceRefs: [],
    })

    const result = await evalAgentPrompt({
      app: host.app,
      agentTypeId: "default",
      prompt: `Open the Objective surface for objective ${objective.id} so I can look at it.`,
      expect: {
        tool: "exec_ui",
        params: { kind: "openSurface", params: { kind: "objective", target: objective.id } },
      },
      model: LIVE_MODEL,
      timeoutMs: LIVE_TIMEOUT_MS,
      retries: 1,
    })

    if (!result.ok) return { id, label, status: "fail", live: true, detail: result.reason ?? "no reason" }
    return { id, label, status: "pass", live: true, detail: `objective=${objective.id}` }
  } catch (err) {
    return { id, label, status: "fail", live: true, detail: err instanceof Error ? err.message : String(err) }
  } finally {
    await host.close()
  }
}
