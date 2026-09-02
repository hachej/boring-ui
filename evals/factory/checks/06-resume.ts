/**
 * eval-resume: interrupt a session mid-turn and assert it resumes with
 * prior context and any pending ask_user question still ready (the #1348
 * semantics: gh-1348 "Pending owner gates are marked abandoned when the hub
 * restarts").
 *
 * This harness is in-process (no separate OS process per host), so the
 * strongest interruption it can honestly simulate is: close the Fastify
 * app instance mid-turn (before the ask_user question is answered) and
 * boot a brand-new `createWorkspaceAgentServer` app pointed at the SAME
 * on-disk workspace root — a fresh process picking up the same durable
 * stores, which is exactly the boundary #1348 is about (pending questions
 * tied to session/process liveness vs. the durable store).
 *
 * Two assertions against the real stores, both gh-1348's stated contract:
 *   1. session context: the Pi session transcript for the interrupted
 *      session is still readable after "restart" (this part is expected to
 *      already work — Pi sessions are file-backed).
 *   2. pending question: the ask_user question that was `ready` before the
 *      restart is STILL `ready` after — never silently `abandoned` just
 *      because the process bounced. As of this branch (weekend/
 *      objectives-plugin stacked eval branch) this is expected to
 *      genuinely FAIL — `AskUserRuntime.abandonOrphanedPending` runs on
 *      every plugin boot and abandons any pending question with no live
 *      in-memory waiter, which is precisely the bug gh-1348 reports. The
 *      fix lives on `weekend/approvals-hardening` (not yet merged into this
 *      branch's ancestry); once that branch's fix lands here, this
 *      assertion should flip to PASS with no code change on this side —
 *      the assertion is written for the correct desired behavior, not
 *      weakened to match today's bug. That failure is reported honestly
 *      below, not hidden or weakened.
 */
import { randomUUID } from "node:crypto"
import { bootObjectivesAskUserHost, cleanupSharedWorkspace, makeTempWorkspace, pollUntil, LIVE_ENABLED, LIVE_MODEL, LIVE_TIMEOUT_MS } from "../lib/harness"
import type { EvalCheckResult, EvalModuleResult } from "../lib/types"

export const evalId = "eval-resume"
export const title = "interrupted session resumes with prior context and pending ask_user stays ready"

export async function run(): Promise<EvalModuleResult> {
  const checks: EvalCheckResult[] = [await checkLive()]
  return { evalId, title, checks }
}

async function checkLive(): Promise<EvalCheckResult> {
  const id = `${evalId}.live-restart`
  const label = "session context + pending ask_user survive a simulated host restart"
  if (!LIVE_ENABLED) return { id, label, status: "skip", live: true, detail: "FACTORY_EVALS_LIVE!=1" }

  const workspaceRoot = makeTempWorkspace("resume")
  const hostA = await bootObjectivesAskUserHost(workspaceRoot, { reuseWorkspaceRoot: true })
  let hostB: Awaited<ReturnType<typeof bootObjectivesAskUserHost>> | undefined
  try {
    const created = await hostA.app.inject({
      method: "POST",
      url: "/api/v1/agents/default/sessions",
      payload: { requestId: `eval-resume-create-${randomUUID()}`, title: "resume-eval" },
    })
    if (created.statusCode !== 201) {
      return { id, label, status: "fail", live: true, detail: `session create returned ${created.statusCode}` }
    }
    const sessionId = (created.json() as { sessionId: string }).sessionId

    const promptRes = await hostA.app.inject({
      method: "POST",
      url: `/api/v1/agents/default/sessions/${sessionId}/prompt`,
      payload: {
        requestId: `eval-resume-prompt-${randomUUID()}`,
        content: "This is a consequential decision: before doing anything else, call ask_user to confirm with me whether we should proceed. Wait for my answer.",
        clientNonce: `eval-resume-${randomUUID()}`,
        model: LIVE_MODEL,
      },
    })
    if (promptRes.statusCode !== 202 && promptRes.statusCode !== 200) {
      return { id, label, status: "fail", live: true, detail: `prompt returned ${promptRes.statusCode}: ${promptRes.body.slice(0, 200)}` }
    }

    const pendingBefore = await pollUntil(async () => {
      const list = await hostA.askUserStore.listPending()
      return list.find((q) => q.sessionId === sessionId) ?? null
    }, { timeoutMs: LIVE_TIMEOUT_MS })

    if (!pendingBefore) {
      return { id, label, status: "fail", live: true, detail: "agent never reached a pending ask_user question within the timeout; cannot exercise the restart path" }
    }
    if (pendingBefore.status !== "ready") {
      return { id, label, status: "fail", live: true, detail: `pending question status before restart was "${pendingBefore.status}", expected "ready"` }
    }

    // Simulated interruption: close host A WITHOUT answering the question,
    // then boot a fresh host B on the same on-disk root.
    await hostA.app.close()
    hostB = await bootObjectivesAskUserHost(workspaceRoot, { reuseWorkspaceRoot: true })

    const stateRes = await hostB.app.inject({
      method: "GET",
      url: `/api/v1/agents/default/sessions/${sessionId}/state`,
    })
    const sessionSurvived = stateRes.statusCode === 200
    let hasPriorContext = false
    if (sessionSurvived) {
      const envelope = JSON.parse(stateRes.body) as { state?: { messages?: unknown[] } }
      hasPriorContext = Array.isArray(envelope.state?.messages) && envelope.state.messages.length > 0
    }

    const pendingAfter = await hostB.askUserStore.getByQuestionId(pendingBefore.questionId)
    const stillReady = pendingAfter?.status === "ready"

    const failures: string[] = []
    if (!sessionSurvived) failures.push(`session state unreadable after restart (HTTP ${stateRes.statusCode})`)
    else if (!hasPriorContext) failures.push("session state readable but has no prior messages")
    if (!stillReady) failures.push(`pending ask_user question status after restart was "${pendingAfter?.status ?? "MISSING"}", expected "ready" (gh-1348)`)

    if (failures.length > 0) {
      return { id, label, status: "fail", live: true, detail: failures.join("; ") }
    }
    return { id, label, status: "pass", live: true, detail: "session context and pending ask_user both survived the simulated restart" }
  } catch (err) {
    return { id, label, status: "fail", live: true, detail: err instanceof Error ? err.message : String(err) }
  } finally {
    await hostB?.app.close().catch(() => undefined)
    cleanupSharedWorkspace(workspaceRoot)
  }
}
