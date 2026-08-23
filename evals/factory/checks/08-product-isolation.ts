/**
 * eval-product-isolation: two seated agents — the REAL repository fleet
 * (`.agents/factory/fleet.yaml`) and a TEMP fleet seating a second,
 * unrelated product persona ("creator-growth") — must not bleed
 * instructions/knowledge into each other, and must get separate session
 * namespaces.
 *
 * No "creator-growth" plugin exists in this repository (checked; grep over
 * plugins/ turned up nothing). This eval uses a fixture persona under
 * evals/factory/fixtures/personas/creator-growth/ as an honest stand-in for
 * "a second, unrelated product" — the isolation boundary under test
 * (disjoint discoveredPackages / fleet configs feeding
 * `loadConfiguredAgentFleet`, and disjoint agentTypeId session routing) is
 * identical whether the second product is a real plugin or a fixture; only
 * its content differs.
 *
 * Entirely structural — composition and session-route wiring, no model
 * call anywhere in this file.
 */
import { createWorkspaceAgentServer } from "@hachej/boring-workspace/app/server"
import { composeRealFleet, composeTempFleet, isConfiguredAgent } from "../lib/fleet"
import { makeTempWorkspace, cleanupWorkspace } from "../lib/harness"
import type { EvalCheckResult, EvalModuleResult } from "../lib/types"

export const evalId = "eval-product-isolation"
export const title = "real fleet + temp fleet: no instruction/knowledge bleed, separate session namespaces"

export async function run(): Promise<EvalModuleResult> {
  const checks: EvalCheckResult[] = []
  checks.push(await checkNoContentBleed())
  checks.push(await checkSeparateSessionNamespaces())
  checks.push(checkCredentialSeparationDocumented())
  return { evalId, title, checks }
}

async function checkNoContentBleed(): Promise<EvalCheckResult> {
  const id = `${evalId}.no-content-bleed`
  const label = "composed instructions contain only their own package's content"
  try {
    const [real, temp] = await Promise.all([composeRealFleet(), composeTempFleet()])
    const realAgents = real.agents.filter(isConfiguredAgent)
    const tempAgents = temp.agents.filter(isConfiguredAgent)

    const creatorGrowth = tempAgents.find((a) => a.agentTypeId === "boring-creator-growth")
    const factorySmoke = tempAgents.find((a) => a.agentTypeId === "boring-factory-smoke")
    if (!creatorGrowth || !factorySmoke) {
      return { id, label, status: "fail", live: false, detail: `temp fleet missing expected seats; got ${tempAgents.map((a) => a.agentTypeId).join(", ")}` }
    }
    if (realAgents.length === 0) {
      return { id, label, status: "fail", live: false, detail: "real fleet composed zero seats — cannot assert isolation against nothing" }
    }

    // Fingerprints: the first line of each real seat's instructions.md is
    // distinctive enough to detect accidental concatenation/leakage without
    // being confused by the fixture's own "never say X" guard text (which
    // deliberately mentions real seat names as part of what it forbids).
    const realFingerprints = realAgents.map((a) => ({
      agentTypeId: a.agentTypeId,
      firstLine: a.definition.instructions.split("\n").find((l) => l.trim().length > 0) ?? "",
    }))

    const problems: string[] = []

    // 1. Real fleet must never contain the temp fleet's canaries.
    for (const agent of realAgents) {
      if (agent.definition.instructions.includes("CREATOR_GROWTH_CANARY")) {
        problems.push(`real seat ${agent.agentTypeId} leaked CREATOR_GROWTH_CANARY`)
      }
      if (agent.definition.instructions.includes("FACTORY_SMOKE_CANARY")) {
        problems.push(`real seat ${agent.agentTypeId} leaked FACTORY_SMOKE_CANARY`)
      }
    }

    // 2. creator-growth must never contain any real seat's fingerprint line,
    //    nor factory-smoke's canary.
    for (const fp of realFingerprints) {
      if (fp.firstLine && creatorGrowth.definition.instructions.includes(fp.firstLine)) {
        problems.push(`creator-growth leaked real seat ${fp.agentTypeId}'s instructions ("${fp.firstLine}")`)
      }
    }
    if (creatorGrowth.definition.instructions.includes("FACTORY_SMOKE_CANARY")) {
      problems.push("creator-growth leaked FACTORY_SMOKE_CANARY (factory-smoke's own persona content)")
    }

    // 3. factory-smoke must never contain real fleet content or the other
    //    temp seat's canary.
    for (const fp of realFingerprints) {
      if (fp.firstLine && factorySmoke.definition.instructions.includes(fp.firstLine)) {
        problems.push(`factory-smoke leaked real seat ${fp.agentTypeId}'s instructions ("${fp.firstLine}")`)
      }
    }
    if (factorySmoke.definition.instructions.includes("CREATOR_GROWTH_CANARY")) {
      problems.push("factory-smoke leaked CREATOR_GROWTH_CANARY (creator-growth's own persona content)")
    }

    if (problems.length > 0) {
      return { id, label, status: "fail", live: false, detail: problems.join("; ") }
    }
    return {
      id,
      label,
      status: "pass",
      live: false,
      detail: `checked ${realAgents.length} real seat(s) against 2 temp seat(s), 0 bleed`,
    }
  } catch (err) {
    return { id, label, status: "fail", live: false, detail: err instanceof Error ? err.message : String(err) }
  }
}

async function checkSeparateSessionNamespaces(): Promise<EvalCheckResult> {
  const id = `${evalId}.separate-session-namespaces`
  const label = "sessions for the real seat and creator-growth are independently addressed and never cross-listed"
  const workspaceRoot = makeTempWorkspace("product-isolation")
  let app: Awaited<ReturnType<typeof createWorkspaceAgentServer>> | undefined
  try {
    const [real, temp] = await Promise.all([composeRealFleet(), composeTempFleet()])
    const worker = real.agents.filter(isConfiguredAgent).find((a) => a.agentTypeId === "boring-worker")
    const creatorGrowth = temp.agents.filter(isConfiguredAgent).find((a) => a.agentTypeId === "boring-creator-growth")
    if (!worker || !creatorGrowth) {
      return { id, label, status: "fail", live: false, detail: `missing composed seat(s): worker=${!!worker}, creator-growth=${!!creatorGrowth}` }
    }

    app = await createWorkspaceAgentServer({
      workspaceRoot,
      mode: "direct",
      logger: false,
      agents: [worker, creatorGrowth],
    })

    const createSession = async (agentTypeId: string) => {
      const res = await app!.inject({
        method: "POST",
        url: `/api/v1/agents/${encodeURIComponent(agentTypeId)}/sessions`,
        payload: { requestId: `isolation-${agentTypeId}`, title: agentTypeId },
      })
      if (res.statusCode !== 201) throw new Error(`session create for ${agentTypeId} returned ${res.statusCode}: ${res.body.slice(0, 200)}`)
      return (res.json() as { sessionId: string }).sessionId
    }

    const workerSessionId = await createSession("boring-worker")
    const creatorGrowthSessionId = await createSession("boring-creator-growth")

    if (workerSessionId === creatorGrowthSessionId) {
      return { id, label, status: "fail", live: false, detail: "both agentTypeIds were issued the SAME sessionId" }
    }

    // Cross-check: the worker's session must not be visible/addressable
    // under the creator-growth agentTypeId route, and vice versa.
    const crossA = await app.inject({
      method: "GET",
      url: `/api/v1/agents/boring-creator-growth/sessions/${encodeURIComponent(workerSessionId)}/state`,
    })
    const crossB = await app.inject({
      method: "GET",
      url: `/api/v1/agents/boring-worker/sessions/${encodeURIComponent(creatorGrowthSessionId)}/state`,
    })
    if (crossA.statusCode === 200 || crossB.statusCode === 200) {
      return {
        id,
        label,
        status: "fail",
        live: false,
        detail: `a session created under one agentTypeId was addressable under the other (crossA=${crossA.statusCode}, crossB=${crossB.statusCode})`,
      }
    }

    return { id, label, status: "pass", live: false, detail: `distinct sessionIds, cross-agentTypeId lookups both rejected (${crossA.statusCode}/${crossB.statusCode})` }
  } catch (err) {
    return { id, label, status: "fail", live: false, detail: err instanceof Error ? err.message : String(err) }
  } finally {
    await app?.close().catch(() => undefined)
    cleanupWorkspace(workspaceRoot)
  }
}

function checkCredentialSeparationDocumented(): EvalCheckResult {
  return {
    id: `${evalId}.credential-separation`,
    label: "credential separation — documented, not structurally assertable here",
    status: "skip",
    live: false,
    detail:
      "Both fleets are composed in-process against one process.env in this harness, so there is no second credential boundary to assert against here. " +
      "Real credential separation is enforced one layer down, at deployment: each seat's model tier (.agents/factory/policy.yaml -> fleet.yaml models.tiers) " +
      "picks a provider candidate gated on its own envVar (e.g. ANTHROPIC_API_KEY, CODEX_SOL_ENABLED), and a real second product would run as its own " +
      "deployment/process with its own secret store, not as a second `agents[]` entry sharing this process's env. Composition-time evidence: each " +
      "AgentHostAgentSpec's `.model.preferred` is resolved independently per seat from its own tier candidates (see loadConfiguredAgentFleet.test.ts:91) — " +
      "the mechanism exists — but proving actual key isolation needs two real deployments, out of scope for an in-process eval harness.",
  }
}
