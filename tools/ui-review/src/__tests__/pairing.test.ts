import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  createUiReviewReproducePath,
  createUiReviewStateId,
  sha256Hex,
  type UiHardGateResult,
  type UiReviewManifest,
  type UiReviewState,
  type UiReviewViewport,
} from "../core/contracts"
import { pairWithLocalBaseline as pairWithSpec } from "../core/pairing"
import { testSpec } from "./fixtures"

const pairWithLocalBaseline = (input: Omit<Parameters<typeof pairWithSpec>[0], "spec">) => pairWithSpec({ ...input, spec: testSpec })

const viewports: UiReviewViewport[] = [
  { name: "desktop", width: 1440, height: 900, deviceScaleFactor: 1 },
  { name: "mobile", width: 390, height: 844, deviceScaleFactor: 1 },
]
const checkpoints = ["closed", "open", "commands"]
const alwaysGateIds = [
  "console-errors",
  "page-errors",
  "request-failures",
  "axe-serious-critical",
  "http-errors",
  "horizontal-overflow",
  "modal-viewport-bounds",
  "modal-blocker-count",
  "focused-control-visible",
  "command-palette-visibility",
  "mobile-touch-targets",
]

async function statesFor(root: string, runId: string): Promise<UiReviewState[]> {
  const states: UiReviewState[] = []
  for (const viewport of viewports) {
    await mkdir(join(root, "selected", viewport.name), { recursive: true })
    for (const checkpoint of checkpoints) {
      const bytes = new TextEncoder().encode(`${runId}-${viewport.name}-${checkpoint}`)
      const screenshotPath = `selected/${viewport.name}/${checkpoint}.png`
      await writeFile(join(root, screenshotPath), bytes)
      const screenshotDigest = sha256Hex(bytes)
      states.push({
        id: createUiReviewStateId({ runId, scenarioId: "command-palette", role: "candidate", viewport, checkpoint, screenshotDigest }),
        scenarioId: "command-palette",
        role: "candidate",
        checkpoint,
        viewport,
        screenshotPath,
        screenshotDigest,
        screenshotBytes: bytes.byteLength,
      })
    }
  }
  return states
}

function gates(states: UiReviewState[]): UiHardGateResult[] {
  return states.flatMap((state) => {
    if (state.source === "bombadil") return [{ id: "bombadil-properties", stateId: state.id, passed: true, evidence: "pass" }]
    const ids = [...alwaysGateIds]
    if (state.checkpoint !== "closed") {
      ids.push("command-palette-input-divider", "command-palette-keyboard-hints", "command-palette-command-mode")
      if (state.viewport.name === "desktop") ids.push("command-palette-desktop-width")
    }
    return ids.map((id) => ({ id, stateId: state.id, passed: true, evidence: "pass" }))
  })
}

describe("local UI review baseline pairing", () => {
  it("pairs exactly six known checkpoints and excludes unmatched Bombadil states", async () => {
    const baselineRoot = await mkdtemp(join(tmpdir(), "ui-baseline."))
    const outputRoot = await mkdtemp(join(tmpdir(), "ui-candidate."))
    for (const viewport of viewports) await mkdir(join(outputRoot, "selected", viewport.name), { recursive: true })
    const baselineStates = await statesFor(baselineRoot, "before")
    const explorationBytes = new TextEncoder().encode("bombadil")
    const explorationPath = "selected/desktop/explore.png"
    await writeFile(join(baselineRoot, explorationPath), explorationBytes)
    const explorationDigest = sha256Hex(explorationBytes)
    const exploration: UiReviewState = {
      id: createUiReviewStateId({ runId: "before", scenarioId: "command-palette", role: "candidate", viewport: viewports[0]!, checkpoint: "explore-0001-layout", screenshotDigest: explorationDigest }),
      scenarioId: "command-palette",
      role: "candidate",
      checkpoint: "explore-0001-layout",
      viewport: viewports[0]!,
      screenshotPath: explorationPath,
      screenshotDigest: explorationDigest,
      screenshotBytes: explorationBytes.byteLength,
      source: "bombadil",
      normalizedStateSignature: "c".repeat(64),
      reproducePath: "placeholder",
    }
    exploration.reproducePath = createUiReviewReproducePath(exploration.id)
    const baselineManifest: UiReviewManifest = {
      schemaVersion: 1,
      runId: "before",
      scenarioId: "command-palette",
      rubricVersion: "impeccable-v1",
      resolvedModel: "fixture",
      candidateRevision: "a".repeat(40),
      candidateTreeHash: "9".repeat(64),
      states: [...baselineStates, exploration],
      statePairs: [],
    }
    await writeFile(join(baselineRoot, "manifest.json"), JSON.stringify(baselineManifest), "utf8")
    await writeFile(join(baselineRoot, "hard-gates.json"), JSON.stringify({ schemaVersion: 1, contractVersion: "command-palette-v2", results: gates(baselineManifest.states) }), "utf8")

    const candidateStates = await statesFor(outputRoot, "after")
    candidateStates.push({ ...exploration, id: "unmatched-candidate-bombadil", role: "candidate" })
    const result = await pairWithLocalBaseline({ baselineRoot, outputRoot, runId: "after", candidateStates })

    expect(result.states).toHaveLength(12)
    expect(result.statePairs).toHaveLength(6)
    expect(result.states.some((state) => state.source === "bombadil")).toBe(false)
    expect(result.baselineGateResults.length).toBeGreaterThan(6)
    expect(result.baselineRevision).toBe("a".repeat(40))
    expect(result.baselineTreeHash).toBe("9".repeat(64))
    expect(result.statePairs.every((pair) => pair.baselineStateId.includes(":baseline:") && pair.candidateStateId.includes(":candidate:"))).toBe(true)
  })

  it("rejects using the output directory as its own baseline", async () => {
    const root = await mkdtemp(join(tmpdir(), "ui-baseline-collision."))
    await expect(pairWithLocalBaseline({ baselineRoot: root, outputRoot: root, runId: "after", candidateStates: [] })).rejects.toThrow("UI_REVIEW_BASELINE_OUTPUT_COLLISION")
  })
})
