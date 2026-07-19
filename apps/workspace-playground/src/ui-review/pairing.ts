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
import { validateCommandPaletteHardGateReport } from "./hardGates"

const KNOWN_CHECKPOINTS = ["closed", "open", "commands"] as const
const VIEWPORTS = ["desktop", "mobile"] as const

export async function pairWithLocalBaseline(input: {
  baselineRoot: string
  outputRoot: string
  runId: string
  candidateStates: UiReviewState[]
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
  await validateUiReviewManifest(input.baselineRoot, baselineManifest)
  validateCommandPaletteHardGateReport(baselineHardGates, baselineManifest)
  if (baselineManifest.scenarioId !== "command-palette") throw new Error("UI_REVIEW_BASELINE_SCENARIO_INVALID")

  const sourceBaseline = strictKnownMatrix(baselineManifest.states.filter((state) => state.role === "candidate"), "baseline")
  const candidate = strictKnownMatrix(input.candidateStates.filter((state) => state.role === "candidate"), "candidate")
  const sourceGateByState = new Map<string, UiHardGateResult[]>()
  for (const result of baselineHardGates.results) {
    const list = sourceGateByState.get(result.stateId) ?? []
    list.push(result)
    sourceGateByState.set(result.stateId, list)
  }

  const baselines: UiReviewState[] = []
  const statePairs: UiReviewManifest["statePairs"] = []
  const baselineGateResults: UiHardGateResult[] = []
  for (const viewport of VIEWPORTS) {
    for (const checkpoint of KNOWN_CHECKPOINTS) {
      const key = `${viewport}:${checkpoint}`
      const source = sourceBaseline.get(key)!
      const candidateState = candidate.get(key)!
      const screenshotPath = `selected/${viewport}/baseline-${checkpoint}.png`
      await copyFile(resolve(input.baselineRoot, source.screenshotPath), resolve(input.outputRoot, screenshotPath))
      const baselineState: UiReviewState = {
        ...source,
        id: createUiReviewStateId({
          runId: input.runId,
          scenarioId: "command-palette",
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

function strictKnownMatrix(states: UiReviewState[], label: string): Map<string, UiReviewState> {
  const known = states.filter((state) => state.source !== "bombadil")
  const result = new Map<string, UiReviewState>()
  for (const state of known) {
    const key = `${state.viewport.name}:${state.checkpoint}`
    if (result.has(key)) throw new Error(`UI_REVIEW_PAIR_MATRIX_DUPLICATE:${label}:${key}`)
    result.set(key, state)
  }
  const expected = VIEWPORTS.flatMap((viewport) => KNOWN_CHECKPOINTS.map((checkpoint) => `${viewport}:${checkpoint}`))
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
