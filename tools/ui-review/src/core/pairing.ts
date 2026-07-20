import { copyFile, readFile } from "node:fs/promises"
import { resolve } from "node:path"
import {
  createUiReviewStateId,
  validateUiReviewManifest,
  type UiHardGateResult,
  type UiHardGateReport,
  type UiReviewManifest,
  type UiReviewState,
} from "./contracts"
import { checkpointAppliesToViewport, type UiReviewSpec } from "./reviewSpec"

export async function pairWithLocalBaseline(input: {
  baselineRoot: string
  outputRoot: string
  runId: string
  candidateStates: UiReviewState[]
  spec: UiReviewSpec
}): Promise<{
  states: UiReviewState[]
  statePairs: UiReviewManifest["statePairs"]
  baselineGateResults: UiHardGateResult[]
  baselineRevision?: string
  baselineTreeHash?: string
}> {
  if (resolve(input.baselineRoot) === resolve(input.outputRoot)) throw new Error("UI_REVIEW_BASELINE_OUTPUT_COLLISION")
  const baselineManifest = parseJson<UiReviewManifest>(await readFile(resolve(input.baselineRoot, "manifest.json"), "utf8"), "UI_REVIEW_BASELINE_MANIFEST_INVALID")
  const baselineHardGates = parseJson<UiHardGateReport>(await readFile(resolve(input.baselineRoot, "hard-gates.json"), "utf8"), "UI_REVIEW_BASELINE_HARD_GATES_INVALID")
  await validateUiReviewManifest(input.baselineRoot, baselineManifest, input.spec)
  input.spec.hardGates.validate(baselineHardGates, baselineManifest)
  if (baselineManifest.scenarioId !== input.spec.id) throw new Error("UI_REVIEW_BASELINE_SCENARIO_INVALID")

  const sourceBaseline = strictKnownMatrix(baselineManifest.states.filter((state) => state.role === "candidate"), "baseline", input.spec)
  const candidate = strictKnownMatrix(input.candidateStates.filter((state) => state.role === "candidate"), "candidate", input.spec)
  const sourceGateByState = new Map<string, UiHardGateResult[]>()
  for (const result of baselineHardGates.results) {
    const list = sourceGateByState.get(result.stateId) ?? []
    list.push(result)
    sourceGateByState.set(result.stateId, list)
  }

  const baselines: UiReviewState[] = []
  const statePairs: UiReviewManifest["statePairs"] = []
  const baselineGateResults: UiHardGateResult[] = []
  for (const viewport of input.spec.viewports) {
    for (const checkpointEntry of input.spec.checkpoints) {
      if (!checkpointAppliesToViewport(checkpointEntry, viewport.name)) continue
      const checkpoint = checkpointEntry.id
      const key = `${viewport.name}:${checkpoint}`
      const source = sourceBaseline.get(key)!
      const candidateState = candidate.get(key)!
      const screenshotPath = `selected/${viewport.name}/baseline-${checkpoint}.png`
      await copyFile(resolve(input.baselineRoot, source.screenshotPath), resolve(input.outputRoot, screenshotPath))
      const baselineState: UiReviewState = {
        ...source,
        id: createUiReviewStateId({
          runId: input.runId,
          scenarioId: input.spec.id,
          role: "baseline",
          viewport: source.viewport,
          checkpoint,
          screenshotDigest: source.screenshotDigest,
        }),
        role: "baseline",
        screenshotPath,
        source: undefined,
        normalizedStateSignature: undefined,
        reproducePath: undefined,
        action: undefined,
        categories: undefined,
      }
      baselines.push(baselineState)
      statePairs.push({ baselineStateId: baselineState.id, candidateStateId: candidateState.id })
      const sourceResults = sourceGateByState.get(source.id)
      if (!sourceResults?.length) throw new Error(`UI_REVIEW_BASELINE_HARD_GATES_MISSING:${source.id}`)
      baselineGateResults.push(...sourceResults.map((result) => ({ ...result, stateId: baselineState.id })))
    }
  }

  return {
    states: [...baselines, ...candidate.values()],
    statePairs,
    baselineGateResults,
    ...(baselineManifest.candidateRevision ? { baselineRevision: baselineManifest.candidateRevision } : {}),
    ...(baselineManifest.candidateTreeHash ? { baselineTreeHash: baselineManifest.candidateTreeHash } : {}),
  }
}

function strictKnownMatrix(states: UiReviewState[], label: string, spec: UiReviewSpec): Map<string, UiReviewState> {
  const known = states.filter((state) => state.source !== "bombadil")
  const result = new Map<string, UiReviewState>()
  for (const state of known) {
    const key = `${state.viewport.name}:${state.checkpoint}`
    if (result.has(key)) throw new Error(`UI_REVIEW_PAIR_MATRIX_DUPLICATE:${label}:${key}`)
    result.set(key, state)
  }
  const expected = spec.viewports.flatMap((viewport) => spec.checkpoints
    .filter((checkpoint) => checkpointAppliesToViewport(checkpoint, viewport.name))
    .map((checkpoint) => `${viewport.name}:${checkpoint.id}`))
  const missing = expected.find((key) => !result.has(key))
  if (missing || result.size !== expected.length) throw new Error(`UI_REVIEW_PAIR_MATRIX_INCOMPLETE:${label}:${missing ?? "unexpected"}`)
  return result
}

function parseJson<T>(text: string, code: string): T {
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(code)
  }
}
