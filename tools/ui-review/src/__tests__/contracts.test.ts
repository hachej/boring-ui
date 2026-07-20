import { mkdtemp, mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  UI_REVIEW_RUBRIC_VERSION,
  UI_REVIEW_SCHEMA_VERSION,
  computeUiPairResult,
  createUiReviewStateId,
  sha256Hex,
  validateUiCriticReport,
  validateUiReviewManifest as validateManifestAgainstSpec,
  type UiCriticPairReport,
  type UiReviewManifest,
  type UiReviewRole,
  type UiReviewState,
  type UiReviewViewport,
} from "../core/contracts"
import { testSpec } from "./fixtures"

const validateUiReviewManifest = (root: string, value: UiReviewManifest) => validateManifestAgainstSpec(root, value, testSpec)

const viewports: UiReviewViewport[] = [
  { name: "desktop", width: 1440, height: 900, deviceScaleFactor: 1 },
  { name: "mobile", width: 390, height: 844, deviceScaleFactor: 1 },
]
const checkpoints = ["closed", "open", "commands"]

async function matrixFixture(roles: UiReviewRole[] = ["candidate"]) {
  const root = await mkdtemp(join(tmpdir(), "ui-review-contracts."))
  const states: UiReviewState[] = []
  for (const role of roles) {
    for (const viewport of viewports) {
      await mkdir(join(root, "selected", viewport.name), { recursive: true })
      for (const checkpoint of checkpoints) {
        const bytes = new TextEncoder().encode(`${role}-${viewport.name}-${checkpoint}-png`)
        const screenshotPath = `selected/${viewport.name}/${role}-${checkpoint}.png`
        await writeFile(join(root, screenshotPath), bytes)
        const screenshotDigest = sha256Hex(bytes)
        states.push({
          id: createUiReviewStateId({ runId: "run", scenarioId: "command-palette", role, viewport, checkpoint, screenshotDigest }),
          scenarioId: "command-palette",
          role,
          checkpoint,
          viewport,
          screenshotPath,
          screenshotDigest,
          screenshotBytes: bytes.byteLength,
        })
      }
    }
  }
  return { root, states }
}

async function singleState(role: UiReviewRole = "candidate") {
  const { root, states } = await matrixFixture([role])
  return { root, state: states[0]! }
}

function manifest(states: UiReviewState[]): UiReviewManifest {
  return {
    schemaVersion: UI_REVIEW_SCHEMA_VERSION,
    runId: "run",
    scenarioId: "command-palette",
    rubricVersion: UI_REVIEW_RUBRIC_VERSION,
    resolvedModel: "fixture",
    states,
    statePairs: [],
  }
}

function score(overall: number) {
  return {
    overall,
    dimensions: {
      hierarchy: overall,
      spacingAlignment: overall,
      typographyColor: overall,
      consistency: overall,
      interactionStates: overall,
      responsiveAccessibility: overall,
    },
  }
}

describe("ui review contracts", () => {
  it("validates the complete candidate matrix and critic state references", async () => {
    const { root, states } = await matrixFixture()
    const run = manifest(states)
    await expect(validateUiReviewManifest(root, run)).resolves.toBeUndefined()
    expect(validateUiCriticReport({
      schemaVersion: 1,
      mode: "candidate",
      confidence: 0.8,
      candidate: score(8),
      visualFindings: [{ stateIds: [states[0]!.id], evidence: "Balanced spacing", severity: "note" }],
      topFixes: [],
    }, run)).toMatchObject({ mode: "candidate", confidence: 0.8 })
  })

  it("rejects incomplete matrices, invalid metadata, digest changes, and hallucinated ids", async () => {
    const { root, states } = await matrixFixture()
    const run = manifest(states)
    await expect(validateUiReviewManifest(root, { ...run, states: states.slice(1) })).rejects.toThrow("UI_REVIEW_SCENARIO_MATRIX_INCOMPLETE")
    await expect(validateUiReviewManifest(root, { ...run, rubricVersion: "other" })).rejects.toThrow("UI_REVIEW_MANIFEST_RUBRIC_INVALID")
    await expect(validateUiReviewManifest(root, { ...run, resolvedModel: "" })).rejects.toThrow("UI_REVIEW_MANIFEST_MODEL_INVALID")
    await writeFile(join(root, states[0]!.screenshotPath), "changed")
    await expect(validateUiReviewManifest(root, run)).rejects.toThrow("UI_REVIEW_SCREENSHOT_DIGEST_MISMATCH")
    expect(() => validateUiCriticReport({
      schemaVersion: 1,
      mode: "candidate",
      confidence: 1,
      candidate: score(8),
      visualFindings: [{ stateIds: ["invented"], evidence: "No evidence", severity: "concern" }],
      topFixes: [],
    }, run)).toThrow("UI_REVIEW_STATE_REFERENCE_INVALID")
  })

  it("rejects unknown critic fields and duplicate cited state ids", async () => {
    const { state } = await singleState()
    const run = manifest([state])
    const valid = {
      schemaVersion: 1,
      mode: "candidate",
      confidence: 1,
      candidate: score(8),
      visualFindings: [{ stateIds: [state.id], evidence: "Evidence", severity: "note" }],
      topFixes: [],
    }
    expect(() => validateUiCriticReport({ ...valid, unexpected: true }, run)).toThrow("UI_REVIEW_CRITIC_SCHEMA_INVALID:report:unknown=unexpected")
    expect(() => validateUiCriticReport({
      ...valid,
      visualFindings: [{ ...valid.visualFindings[0], stateIds: [state.id, state.id] }],
    }, run)).toThrow("UI_REVIEW_STATE_REFERENCE_DUPLICATE")
    expect(() => validateUiCriticReport({
      ...valid,
      candidate: { ...score(8), dimensions: { ...score(8).dimensions, extra: 8 } },
    }, run)).toThrow("UI_REVIEW_CRITIC_SCHEMA_INVALID:candidate.dimensions:unknown=extra")
  })

  it("rejects nondeterministic identity, scenario, viewport, and screenshot ownership", async () => {
    const { root, states } = await matrixFixture()
    const run = manifest(states)
    const state = states[0]!
    const replaceFirst = (replacement: UiReviewState) => [replacement, ...states.slice(1)]
    await expect(validateUiReviewManifest(root, { ...run, states: replaceFirst({ ...state, id: "invented" }) })).rejects.toThrow("UI_REVIEW_STATE_ID_NONDETERMINISTIC")
    await expect(validateUiReviewManifest(root, { ...run, states: replaceFirst({ ...state, scenarioId: "other" }) })).rejects.toThrow("UI_REVIEW_STATE_SCENARIO_INVALID")
    await expect(validateUiReviewManifest(root, { ...run, states: replaceFirst({ ...state, viewport: { ...state.viewport, width: 100 } }) })).rejects.toThrow("UI_REVIEW_VIEWPORT_GEOMETRY_INVALID")
    await expect(validateUiReviewManifest(root, { ...run, states: replaceFirst({ ...state, screenshotPath: "selected/mobile/candidate.png" }) })).rejects.toThrow("UI_REVIEW_SCREENSHOT_OWNERSHIP_INVALID")
    await expect(validateUiReviewManifest(root, { ...run, states: [state, ...states] })).rejects.toThrow("UI_REVIEW_STATE_ID_DUPLICATE")
  })

  it("requires complete baseline/candidate pair ownership and computes signed deltas", async () => {
    const { root, states } = await matrixFixture(["baseline", "candidate"])
    const baselineStates = states.filter((state) => state.role === "baseline")
    const candidateStates = states.filter((state) => state.role === "candidate")
    const statePairs = baselineStates.map((baselineState) => ({
      baselineStateId: baselineState.id,
      candidateStateId: candidateStates.find((candidate) => (
        candidate.viewport.name === baselineState.viewport.name && candidate.checkpoint === baselineState.checkpoint
      ))!.id,
    }))
    const run: UiReviewManifest = { ...manifest(states), statePairs }
    await expect(validateUiReviewManifest(root, run)).resolves.toBeUndefined()
    const report: UiCriticPairReport = {
      schemaVersion: 1,
      mode: "pair",
      confidence: 0.9,
      baseline: score(7),
      candidate: score(8),
      visualFindings: [],
      topFixes: [],
    }
    expect(computeUiPairResult(report, run).signedDelta).toMatchObject({ overall: 1, hierarchy: 1 })
    const reversed = [{ baselineStateId: statePairs[0]!.candidateStateId, candidateStateId: statePairs[0]!.baselineStateId }, ...statePairs.slice(1)]
    await expect(validateUiReviewManifest(root, { ...run, statePairs: reversed })).rejects.toThrow("UI_REVIEW_PAIR_BASELINE_INVALID")
    await expect(validateUiReviewManifest(root, { ...run, statePairs: [...statePairs, statePairs[0]!] })).rejects.toThrow("UI_REVIEW_PAIR_DUPLICATE")
    await expect(validateUiReviewManifest(root, { ...run, statePairs: [] })).rejects.toThrow("UI_REVIEW_PAIRING_INCOMPLETE")
  })
})
