/**
 * eval-boot: a generated agent (boring-factory-smoke) composes, and a live
 * host boots with it and answers a trivial session turn.
 *
 * Two checks:
 *  - structural (always runs, no model): composition via the real
 *    `loadConfiguredAgentFleet` loader succeeds and produces an
 *    agentTypeId "boring-factory-smoke" whose instructions come from the
 *    fixture persona.
 *  - live (FACTORY_EVALS_LIVE=1): boot `createWorkspaceAgentServer` with
 *    that composed agent spec and get a real trivial-turn response through
 *    it via the real @hachej/boring-agent/eval framework.
 */
import { createWorkspaceAgentServer } from "@hachej/boring-workspace/app/server"
import { evalAgentPrompt } from "@hachej/boring-agent/eval"
import { composeTempFleet, isConfiguredAgent } from "../lib/fleet"
import { LIVE_ENABLED, LIVE_MODEL, LIVE_TIMEOUT_MS, makeTempWorkspace, cleanupWorkspace } from "../lib/harness"
import type { EvalCheckResult, EvalModuleResult } from "../lib/types"

export const evalId = "eval-boot"
export const title = "generated agent composes + live host boots and answers a trivial turn"

export async function run(): Promise<EvalModuleResult> {
  const checks: EvalCheckResult[] = []
  checks.push(await checkCompose())
  checks.push(await checkLiveBoot())
  return { evalId, title, checks }
}

async function checkCompose(): Promise<EvalCheckResult> {
  const id = `${evalId}.compose`
  const label = "boring-factory-smoke composes via loadConfiguredAgentFleet"
  try {
    const { agents, diagnostics } = await composeTempFleet()
    const smoke = agents.find((a) => a.agentTypeId === "boring-factory-smoke")
    if (!smoke || !isConfiguredAgent(smoke)) {
      return { id, label, status: "fail", live: false, detail: `agent not composed; diagnostics: ${JSON.stringify(diagnostics)}` }
    }
    if (!smoke.definition.instructions.includes("FACTORY_SMOKE_CANARY")) {
      return { id, label, status: "fail", live: false, detail: "composed instructions missing the fixture persona's content" }
    }
    return { id, label, status: "pass", live: false, detail: `agentTypeId=${smoke.agentTypeId}` }
  } catch (err) {
    return { id, label, status: "fail", live: false, detail: describeError(err) }
  }
}

async function checkLiveBoot(): Promise<EvalCheckResult> {
  const id = `${evalId}.live-turn`
  const label = "live host boots with boring-factory-smoke and answers a trivial turn"
  if (!LIVE_ENABLED) return { id, label, status: "skip", live: true, detail: "FACTORY_EVALS_LIVE!=1" }

  const workspaceRoot = makeTempWorkspace("boot")
  let app: Awaited<ReturnType<typeof createWorkspaceAgentServer>> | undefined
  try {
    const { agents } = await composeTempFleet()
    const smoke = agents.find((a) => a.agentTypeId === "boring-factory-smoke")
    if (!smoke) return { id, label, status: "fail", live: true, detail: "compose failed, cannot boot" }

    app = await createWorkspaceAgentServer({
      workspaceRoot,
      mode: "direct",
      logger: false,
      agents: [smoke],
    })

    // NOTE: @hachej/boring-agent/eval's capturePiChatSnapshot (evalPrompt.ts)
    // concatenates text parts from EVERY message in the session, not just
    // the assistant's — so `result.text` starts with this literal prompt
    // string regardless of what the assistant said. Confirmed by direct
    // debugging against the raw /state endpoint: a genuine assistant reply
    // makes `result.text` LONGER than the prompt; an empty/failed assistant
    // turn (which can still report `ok: true` with no tool calls) leaves
    // `result.text` exactly equal to the prompt. Comparing against the
    // prompt's own length is what actually distinguishes "the assistant
    // said something" from "the assistant said nothing" here — a plain
    // non-empty check would spuriously pass on the echoed prompt alone.
    const prompt = "Reply with the single word: pong. No tool calls."
    const result = await evalAgentPrompt({
      app,
      agentTypeId: "boring-factory-smoke",
      prompt,
      expectNoToolCall: true,
      model: LIVE_MODEL,
      timeoutMs: LIVE_TIMEOUT_MS,
      retries: 1,
    })

    if (!result.ok) return { id, label, status: "fail", live: true, detail: result.reason ?? "no reason" }
    if (result.text.trim().length <= prompt.length) {
      return { id, label, status: "fail", live: true, detail: `assistant produced no content beyond the echoed prompt; text="${result.text.trim()}"` }
    }
    return { id, label, status: "pass", live: true, detail: `assistant text="${result.text.trim().slice(prompt.length, prompt.length + 60)}"` }
  } catch (err) {
    return { id, label, status: "fail", live: true, detail: describeError(err) }
  } finally {
    await app?.close()
    cleanupWorkspace(workspaceRoot)
  }
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
